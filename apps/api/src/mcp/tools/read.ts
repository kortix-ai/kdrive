// Tool 3: read_files — metadata, folder entries and bounded text pages.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { basename, mimeFor } from '@volumes/shared';
import type { z } from 'zod';
import { principalWorkspace, type AgentPrincipal } from '../../agents/principal';
import { compareUrl, driveCompareUrl, driveUrl, PUBLIC_ORIGIN } from '../../agents/urls';
import { sortEntries } from '../../services/files-ops';
import { listDir } from '../../services/tree';
import type { WorkspaceCtx } from '../../types';
import { READ_FILES_DESCRIPTION } from '../descriptions';
import { utf8Window } from '../output';
import { ok, withTool, type Link, type ToolCtx } from '../result';
import { ReadFilesInput, ReadFilesOutput } from '../schemas';
import { badRequest, commitIdOf, entryKind, headCommit, isTextFile, plural, readAll, safeStat, toPaths } from './util';

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;
const MAX_DIR_ENTRIES = 500;
/** Folder entries per call, across every folder read. */
export const MAX_LIST_ENTRIES = 1000;
/** Bytes of entry names and paths per call, across every folder read (a path can be 4 KiB). */
export const MAX_LIST_BYTES = 256 * 1024;
const utf8Len = (x: string) => Buffer.byteLength(x, 'utf8');
const dec = new TextDecoder('utf-8', { fatal: false });

type Args = { workspace_id?: string; paths: string[]; at?: string; offset: number; max_bytes: number; encoding: 'auto' | 'base64' };
type Out = z.infer<z.ZodObject<typeof ReadFilesOutput>>;
type FileOut = Out['files'][number];

export function downloadUrl(wsId: string, path: string, at?: string): string {
  const q = new URLSearchParams({ path, download: '1', ...(at ? { at } : {}) });
  return `${PUBLIC_ORIGIN}/api/w/${encodeURIComponent(wsId)}/files/content?${q.toString()}`;
}

export async function readFiles(ws: WorkspaceCtx, args: Args): Promise<Out> {
  const paths = toPaths(args.paths);
  if (args.offset > 0 && paths.length !== 1) throw badRequest('offset works with exactly one path.');
  const head = await headCommit(ws);
  const commit = args.at ? await commitIdOf(ws, args.at) : head;
  const past = commit !== head;
  let budget = args.max_bytes;
  let listEntries = MAX_LIST_ENTRIES;
  let listBytes = MAX_LIST_BYTES;
  let exhausted = false;
  const files: FileOut[] = [];

  for (const path of paths) {
    const st = await safeStat(ws, path, commit);
    if (!st) {
      files.push({ path, exists: false, type: null, size: null, mtime: null, version: null, mime: null, url: null, download_url: null });
      continue;
    }
    const type = entryKind(st.type);
    const isFile = type === 'file';
    const out: FileOut = {
      path,
      exists: true,
      type,
      size: st.size,
      mtime: st.mtime,
      version: st.version,
      mime: isFile ? mimeFor(basename(path)) : null,
      url: past
        ? isFile
          ? compareUrl(ws.id, path, commit, head)
          : driveCompareUrl(ws.id, commit, head)
        : driveUrl(ws.id, path, type === 'dir' ? 'dir' : 'file'),
      download_url: isFile ? downloadUrl(ws.id, path, past ? commit : undefined) : null,
    };
    if (type === 'dir') {
      // Listings share one budget per call: entries and the bytes of their names and paths.
      const { entries } = await listDir(ws, path, commit);
      const sorted = sortEntries(entries);
      const start = Math.min(args.offset, sorted.length);
      const shown: NonNullable<FileOut['entries']> = [];
      for (let i = start; i < sorted.length && shown.length < MAX_DIR_ENTRIES && listEntries > 0; i++) {
        const e = sorted[i];
        const name = e.name || basename(e.path);
        const cost = utf8Len(name) + utf8Len(e.path) + 64;
        if (cost > listBytes) break;
        listBytes -= cost;
        listEntries--;
        shown.push({ name, path: e.path, type: entryKind(e.type), size: e.size });
      }
      const next = start + shown.length;
      out.entries = shown;
      out.entries_truncated = next < sorted.length;
      out.offset = start;
      out.next_offset = next < sorted.length ? next : null;
      // Cut by the per-call budget rather than the per-folder cap: the rest needs another call.
      if (next < sorted.length && shown.length < MAX_DIR_ENTRIES) exhausted = true;
    } else if (isFile) {
      if (budget <= 0) {
        exhausted = true;
      } else if (args.encoding === 'base64') {
        const raw = Math.floor((budget * 3) / 4);
        if (raw <= 0) exhausted = true;
        else {
          const start = Math.min(args.offset, st.size);
          const end = Math.min(st.size, start + raw);
          const bytes = end > start ? await readAll(ws, path, commit, `bytes=${start}-${end - 1}`) : new Uint8Array(0);
          const content = Buffer.from(bytes).toString('base64');
          budget -= content.length;
          Object.assign(out, {
            content,
            encoding: 'base64' as const,
            offset: start,
            shown_bytes: bytes.length,
            truncated: start + bytes.length < st.size,
            next_offset: start + bytes.length < st.size ? start + bytes.length : null,
          });
        }
      } else if (!(await isTextFile(ws, { ...st, path }, commit))) {
        out.binary = true;
      } else if (st.size === 0 || args.offset >= st.size) {
        Object.assign(out, { content: '', encoding: 'utf8' as const, offset: Math.min(args.offset, st.size), shown_bytes: 0, truncated: false, next_offset: null });
      } else {
        const last = Math.min(st.size - 1, args.offset + budget + 2);
        const bytes = await readAll(ws, path, commit, `bytes=${args.offset}-${last}`);
        const w = utf8Window(bytes, 0, budget);
        let end = w.end;
        if (end === w.start && w.start < bytes.length) {
          // The budget is smaller than one character: show that one character.
          end = w.start + 1;
          while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end++;
        }
        const shown = end - w.start;
        const next = args.offset + end;
        budget -= shown;
        Object.assign(out, {
          content: dec.decode(bytes.subarray(w.start, end)),
          encoding: 'utf8' as const,
          offset: args.offset + w.start,
          shown_bytes: shown,
          truncated: next < st.size,
          next_offset: next < st.size ? next : null,
        });
      }
    }
    files.push(out);
  }
  return { commit_id: commit, files, budget_exhausted: exhausted };
}

export function readSummary(data: Out): string {
  const nFiles = data.files.filter((f) => f.type === 'file').length;
  const nDirs = data.files.filter((f) => f.type === 'dir').length;
  const missing = data.files.filter((f) => !f.exists).length;
  const parts = [`Read ${plural(nFiles, 'file')}`];
  if (nDirs) parts.push(plural(nDirs, 'folder'));
  if (missing) parts.push(`${missing.toLocaleString('en-US')} missing`);
  const cut = data.files.find((f) => f.truncated && f.next_offset != null);
  const more = data.files.find((f) => f.entries_truncated && f.next_offset != null);
  if (cut) parts.push(`truncated, call again with offset=${cut.next_offset}`);
  else if (more) parts.push(`more entries, read ${more.path} alone with offset=${more.next_offset}`);
  else if (data.budget_exhausted) parts.push('budget used up, read the rest in another call');
  return parts.join(' · ');
}

export function registerReadTool(server: McpServer, p: AgentPrincipal, ctx: ToolCtx): void {
  server.registerTool(
    'read_files',
    {
      title: 'Read files',
      description: READ_FILES_DESCRIPTION,
      inputSchema: ReadFilesInput,
      outputSchema: ReadFilesOutput,
      annotations: READ_ONLY,
    },
    withTool(
      'read_files',
      p,
      async (args: Args) => {
        const ws = await principalWorkspace(p, args.workspace_id);
        const data = await readFiles(ws, args);
        const links: Link[] = data.files
          .filter((f) => f.exists && f.url)
          .map((f) => ({ uri: f.url!, name: basename(f.path) || f.path, title: f.path, ...(f.mime ? { mimeType: f.mime } : {}) }));
        return ok({ summary: readSummary(data), links, data });
      },
      ctx,
    ),
  );
}

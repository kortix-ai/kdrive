// Tool 7: diff — what changed between two points, with small text diffs.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { basename, isWithin, type DriveChange } from '@volumes/shared';
import { createTwoFilesPatch } from 'diff';
import type { z } from 'zod';
import { principalWorkspace, type AgentPrincipal } from '../../agents/principal';
import { compareUrl, driveCompareUrl, driveUrl } from '../../agents/urls';
import { ApiError } from '../../lib/http';
import { allCheckpointRows } from '../../services/checkpoints';
import { compareDrive } from '../../services/drive-compare';
import { listTree } from '../../services/tree';
import type { WorkspaceCtx } from '../../types';
import { DIFF_DESCRIPTION } from '../descriptions';
import { DIFF_CARD_URI } from '../diff-card';
import { utf8Bytes } from '../output';
import { ok, withTool, type Link, type ToolCtx } from '../result';
import { DiffInput, DiffOutput } from '../schemas';
import { commitIdOf, headCommit, looksLikeText, readAll, safeStat, toPaths } from './util';

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;
const MAX_CHANGES = 500;
const MAX_TEXT_FILES = 20;
const MAX_SIDE_BYTES = 256 * 1024;
const MAX_DIFF_TEXT = 64 * 1024;

type Args = { workspace_id?: string; from: string; to: string; paths?: string[]; include_text: boolean; context_lines: number };
type Out = z.infer<z.ZodObject<typeof DiffOutput>>;
type Change = Out['changes'][number];

/** now → head; latest_checkpoint → the newest checkpoint's commit; else a commit id or tag. */
export async function resolvePoint(ws: WorkspaceCtx, ref: string, head: string): Promise<string> {
  if (ref === 'now' || ref === 'head') return head;
  if (ref === 'latest_checkpoint') {
    const rows = await allCheckpointRows(ws.id);
    const last = rows[rows.length - 1];
    if (!last) throw new ApiError(404, 'not_found', 'This workspace has no checkpoints yet.');
    return last.commitId;
  }
  return commitIdOf(ws, ref);
}

/** The text of a file at a commit, or why there is none. */
async function textAt(ws: WorkspaceCtx, path: string, at: string): Promise<{ text: string } | { reason: 'binary' | 'too_large' }> {
  const st = await safeStat(ws, path, at);
  if (!st || st.type !== 'file') return { text: '' };
  if (st.size > MAX_SIDE_BYTES) return { reason: 'too_large' };
  const bytes = st.size ? await readAll(ws, path, at) : new Uint8Array(0);
  if (!looksLikeText(bytes, true)) return { reason: 'binary' };
  return { text: new TextDecoder('utf-8').decode(bytes) };
}

export async function diffWorkspace(ws: WorkspaceCtx, args: Args): Promise<Out & { toIsHead: boolean }> {
  const head = await headCommit(ws);
  const [a, b] = await Promise.all([resolvePoint(ws, args.from, head), resolvePoint(ws, args.to, head)]);
  const r = await compareDrive(ws, a, b);
  const filter = args.paths?.length ? toPaths(args.paths) : null;
  const within = (p: string) => !filter || filter.some((f) => isWithin(f, p));
  // A folder added or removed as a whole also lists the files inside it (bounded), so each can carry its diff.
  const expanded: DriveChange[] = [];
  for (const c of r.changes) {
    if (expanded.length > MAX_CHANGES) break;
    if (within(c.path) || (!!c.fromPath && within(c.fromPath))) expanded.push(c);
    if (c.type !== 'dir' || (c.op !== 'added' && c.op !== 'removed')) continue;
    const at = c.op === 'added' ? r.b.commitId : r.a.commitId;
    const { entries } = await listTree(ws, c.path, at);
    for (const e of entries) {
      if (e.path === c.path || !within(e.path)) continue;
      if (expanded.length > MAX_CHANGES) break;
      const type = e.type === 'dir' ? 'dir' : 'file';
      expanded.push(c.op === 'added' ? { op: 'added', path: e.path, type, sizeB: e.size } : { op: 'removed', path: e.path, type, sizeA: e.size });
    }
  }
  const kept = expanded;
  const changes: Change[] = kept.slice(0, MAX_CHANGES).map((c) => ({
    op: c.op,
    path: c.path,
    from_path: c.fromPath ?? null,
    type: c.type,
    size_from: c.sizeA ?? null,
    size_to: c.sizeB ?? null,
    diff: null,
    diff_omitted_reason: null,
    compare_url: c.type === 'file' ? compareUrl(ws.id, c.path, r.a.commitId, r.b.commitId) : null,
  }));

  let files = 0;
  let spent = 0;
  for (const c of changes) {
    if (c.type !== 'file' || c.op === 'moved') continue;
    if (!args.include_text) {
      c.diff_omitted_reason = 'not_requested';
      continue;
    }
    if (files >= MAX_TEXT_FILES || spent >= MAX_DIFF_TEXT) {
      c.diff_omitted_reason = 'budget';
      continue;
    }
    const [x, y] = await Promise.all([
      c.op === 'added' ? Promise.resolve({ text: '' }) : textAt(ws, c.path, r.a.commitId),
      c.op === 'removed' ? Promise.resolve({ text: '' }) : textAt(ws, c.path, r.b.commitId),
    ]);
    if (!('text' in x) || !('text' in y)) {
      c.diff_omitted_reason = !('text' in x) ? x.reason : (y as { reason: 'binary' | 'too_large' }).reason;
      continue;
    }
    const patch = createTwoFilesPatch(`a${c.path}`, `b${c.path}`, x.text, y.text, '', '', { context: args.context_lines });
    const size = utf8Bytes(patch);
    if (spent + size > MAX_DIFF_TEXT) {
      c.diff_omitted_reason = 'budget';
      continue;
    }
    spent += size;
    files++;
    c.diff = patch;
  }

  const counts = { added: 0, removed: 0, changed: 0, moved: 0 };
  for (const c of kept) counts[c.op]++;
  return {
    from: { commit_id: r.a.commitId, created_at: r.a.createdAt },
    to: { commit_id: r.b.commitId, created_at: r.b.createdAt },
    changes,
    counts,
    truncated: kept.length > changes.length,
    source: r.source,
    drive_compare_url: driveCompareUrl(ws.id, r.a.commitId, r.b.commitId),
    toIsHead: r.b.commitId === head,
  };
}

export function registerDiffTool(server: McpServer, p: AgentPrincipal, ctx: ToolCtx): void {
  server.registerTool(
    'diff',
    {
      title: 'Compare versions',
      description: DIFF_DESCRIPTION,
      inputSchema: DiffInput,
      outputSchema: DiffOutput,
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: DIFF_CARD_URI } },
    },
    withTool(
      'diff',
      p,
      async (args: Args) => {
        const ws = await principalWorkspace(p, args.workspace_id);
        const { toIsHead, ...data } = await diffWorkspace(ws, args);
        const total = data.counts.added + data.counts.removed + data.counts.changed + data.counts.moved;
        const to = toIsHead ? 'now' : data.to.commit_id;
        const tally = [`+${data.counts.added}`, `~${data.counts.changed}`, `−${data.counts.removed}`];
        if (data.counts.moved) tally.push(`↪${data.counts.moved}`);
        const links: Link[] = [{ uri: data.drive_compare_url, name: 'Compare', title: 'Compare in Volumes' }];
        if (toIsHead) {
          for (const c of data.changes) {
            if (c.op === 'removed') continue;
            links.push({ uri: driveUrl(ws.id, c.path, c.type), name: basename(c.path) || c.path, title: c.path });
          }
        }
        return ok({
          summary: `${total.toLocaleString('en-US')} ${total === 1 ? 'change' : 'changes'} from ${data.from.commit_id} to ${to} · ${tally.join(' ')}${data.truncated ? ' · truncated' : ''}`,
          links,
          data,
        });
      },
      ctx,
    ),
  );
}

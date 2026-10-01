// Small helpers shared by the tool handlers.
import { basename, isTextLike, normalizePath } from '@volumes/shared';
import type { z } from 'zod';
import type { AgentPrincipal } from '../../agents/principal';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { checkpoints } from '../../db/schema';
import { ApiError } from '../../lib/http';
import { getStore } from '../../storage';
import { isStoreError, type FileStat } from '../../storage/types';
import { statOrNull } from '../../services/tree';
import type { WorkspaceCtx } from '../../types';
import type { AccessShape } from '../schemas';

/** A drive path from a tool argument: a missing leading `/` is added, then normalised. */
export function toPath(p: string): string {
  return normalizePath(p.startsWith('/') ? p : `/${p}`);
}

/** Paths from arguments, normalised and deduplicated (first occurrence wins). */
export function toPaths(ps: readonly string[]): string[] {
  return [...new Set(ps.map(toPath))];
}

export function accessOf(p: AgentPrincipal): z.infer<typeof AccessShape> {
  return { scope: p.scope, mode: p.scope === 'drive:read' ? null : p.mode, restricted_to: p.workspaceId };
}

export const entryKind = (t: string): 'file' | 'dir' | 'other' => (t === 'file' ? 'file' : t === 'dir' ? 'dir' : 'other');

/** stat that also treats "a parent is a file" as absent. */
export async function safeStat(ws: Pick<WorkspaceCtx, 'volumeId'>, path: string, at?: string): Promise<FileStat | null> {
  try {
    return await statOrNull(ws, path, at);
  } catch (e) {
    if (isStoreError(e, 'not_a_directory')) return null;
    throw e;
  }
}

export async function headCommit(ws: Pick<WorkspaceCtx, 'volumeId'>): Promise<string> {
  return (await getStore().getVolume(ws.volumeId)).headCommitId;
}

const COMMIT_REF = /^vc_[0-9A-Za-z]{26}$/;
/** What the store may be asked to resolve itself (never a free-form name). */
const STORE_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const unknownVersion = (ref: string) =>
  new ApiError(404, 'not_found', `No version called ${JSON.stringify(ref.slice(0, 80))} in this workspace. Use a commit_id from get_history or a checkpoint name.`, {
    ref: ref.slice(0, 128),
  });

/**
 * Resolves a version reference to its commit id: a commit id (vc_…), "head",
 * or one of the workspace's checkpoints by id or by name (the newest of that
 * name). An unknown name is 404 `not_found`; a commit id that is no longer kept
 * is 410 `version_gone`.
 */
export async function commitIdOf(ws: Pick<WorkspaceCtx, 'id' | 'volumeId'>, ref: string): Promise<string> {
  const r = ref.trim();
  if (!r) throw unknownVersion(ref);
  if (COMMIT_REF.test(r) || r === 'head') return (await getStore().getCommit(ws.volumeId, r)).id;
  const [cp] = await db
    .select({ commitId: checkpoints.commitId })
    .from(checkpoints)
    .where(and(eq(checkpoints.workspaceId, ws.id), or(eq(checkpoints.id, r), eq(checkpoints.name, r))))
    .orderBy(sql`${checkpoints.id} = ${r} DESC`, desc(checkpoints.createdAt))
    .limit(1);
  if (cp) return (await getStore().getCommit(ws.volumeId, cp.commitId)).id;
  if (!STORE_REF.test(r)) throw unknownVersion(ref);
  try {
    return (await getStore().getCommit(ws.volumeId, r)).id;
  } catch (e) {
    if (isStoreError(e, 'not_found')) throw unknownVersion(ref);
    throw e;
  }
}

/** Reads a whole small file at a commit. */
export async function readAll(ws: Pick<WorkspaceCtx, 'volumeId'>, path: string, at: string, range?: string): Promise<Uint8Array> {
  const r = await getStore().read(ws.volumeId, path, { at, ...(range ? { range } : {}) });
  return new Uint8Array(await new Response(r.body).arrayBuffer());
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

/** True when `bytes` (a prefix of a file; `whole` when it is the entire file) look like UTF-8 text. */
export function looksLikeText(bytes: Uint8Array, whole: boolean): boolean {
  if (bytes.includes(0)) return false;
  let end = bytes.length;
  if (!whole) {
    // A prefix may end inside a character: back off to its start.
    let back = 0;
    while (end > 0 && back < 4 && (bytes[end - 1] & 0xc0) === 0x80) {
      end--;
      back++;
    }
    if (end > 0 && bytes[end - 1] >= 0xc0) end--;
  }
  try {
    strictUtf8.decode(bytes.subarray(0, end));
    return true;
  } catch {
    return false;
  }
}

/** Text by name, else by sniffing the first 8 KiB. */
export async function isTextFile(ws: Pick<WorkspaceCtx, 'volumeId'>, st: FileStat, at: string): Promise<boolean> {
  if (isTextLike(basename(st.path) || st.name)) return true;
  if (st.size === 0) return true;
  const n = Math.min(st.size, 8192);
  const head = await readAll(ws, st.path, at, `bytes=0-${n - 1}`);
  return looksLikeText(head, n === st.size);
}

export function badRequest(message: string, details?: Record<string, unknown>): ApiError {
  return new ApiError(400, 'bad_request', message, details);
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

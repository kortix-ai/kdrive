// Small helpers shared by the versioning services (timeline, versions,
// restore, drive compare, recently deleted). Owner: API-versioning.

import { createHash } from 'node:crypto';
import { BLOCK_SIZE } from '@volumes/shared';
import { getStore } from '../storage';
import { isStoreError, type Commit } from '../storage/types';

/** Runs `fn` over `items` with at most `n` in flight; keeps the input order. */
export async function mapLimit<T, R>(items: readonly T[], n: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, n), items.length) }, worker));
  return out;
}

/**
 * Commit ids are `vc_` + ULID, so plain string order is creation order
 * (the same order history uses). Negative when `a` is older than `b`.
 */
export function cmpCommitId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Orders two commits by (createdAt, id), oldest first. */
export function cmpCommit(a: Pick<Commit, 'id' | 'createdAt'>, b: Pick<Commit, 'id' | 'createdAt'>): number {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  if (ta !== tb) return ta - tb;
  return cmpCommitId(a.id, b.id);
}

/**
 * Visible (non-expired) history, newest first, paging until `stopAt` returns
 * true for a commit (that commit is included) or the history ends.
 * `complete` is false when `maxPages` ran out first.
 */
export async function visibleHistory(
  volumeId: string,
  opts: { stopAt?: (c: Commit) => boolean; maxPages?: number } = {},
): Promise<{ commits: Commit[]; complete: boolean }> {
  const store = getStore();
  const commits: Commit[] = [];
  let before: string | undefined;
  const maxPages = opts.maxPages ?? 25;
  for (let page = 0; page < maxPages; page++) {
    const r = await store.history(volumeId, { limit: 200, before });
    for (const c of r.commits) {
      commits.push(c);
      if (opts.stopAt?.(c)) return { commits, complete: true };
    }
    if (!r.nextCursor) return { commits, complete: true };
    before = r.nextCursor;
  }
  return { commits, complete: false };
}

/** "14 Sep 2026, 16:40 UTC" — server-rendered text has no viewer time zone, so it says UTC. */
export function formatUtc(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** Keeps only the top-most paths (drops any path inside another one in the list). Sorted. */
export function topMost(paths: Iterable<string>): string[] {
  const sorted = [...new Set(paths)].sort();
  const out: string[] = [];
  for (const p of sorted) {
    if (out.some((r) => r === '/' || p === r || p.startsWith(r + '/'))) continue;
    out.push(p);
  }
  return out;
}

/** Every ancestor of `p` (excluding `/` and `p`), nearest last. */
export function ancestorsOf(p: string): string[] {
  const segs = p.split('/').filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i < segs.length; i++) out.push('/' + segs.slice(0, i).join('/'));
  return out;
}

export function isUnder(root: string, p: string): boolean {
  return root === '/' ? p !== '/' : p.startsWith(root + '/');
}

/** Same-origin content URL for a file at a commit (mirrors apps/web/lib/urls.ts `contentUrl`). */
export function contentUrlFor(wsId: string, path: string, at: string, download = false): string {
  const q = new URLSearchParams({ path, at });
  if (download) q.set('download', '1');
  return `/api/w/${encodeURIComponent(wsId)}/files/content?${q.toString()}`;
}

/** stat that also treats an unreadable (purged) commit as "absent". */
export async function statIfReadable(volumeId: string, path: string, at: string) {
  try {
    return await getStore().stat(volumeId, path, { at });
  } catch (e) {
    if (isStoreError(e, 'path_not_found') || isStoreError(e, 'not_found')) return null;
    throw e;
  }
}

/** sha256 hex of every 1 MiB block of a stream (the last block is short, never padded). */
export async function hashBlocks(body: ReadableStream<Uint8Array>): Promise<{ blocks: string[]; size: number }> {
  const blocks: string[] = [];
  const buf = new Uint8Array(BLOCK_SIZE);
  let fill = 0;
  let size = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let off = 0;
    size += value.length;
    while (off < value.length) {
      const n = Math.min(BLOCK_SIZE - fill, value.length - off);
      buf.set(value.subarray(off, off + n), fill);
      fill += n;
      off += n;
      if (fill === BLOCK_SIZE) {
        blocks.push(createHash('sha256').update(buf).digest('hex'));
        fill = 0;
      }
    }
  }
  if (fill > 0) blocks.push(createHash('sha256').update(buf.subarray(0, fill)).digest('hex'));
  return { blocks, size };
}

/** Reads a whole (small) stream into memory. */
export async function readStream(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = body.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

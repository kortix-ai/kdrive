import { getStore } from '../storage';
import { isStoreError, type FileEntry, type FileStat, type Ref } from '../storage/types';
import type { WorkspaceCtx } from '../types';

type Ws = Pick<WorkspaceCtx, 'volumeId'>;

const COMMIT_ID = /^vc_[0-9A-HJKMNP-TV-Z]{26}$/;

/** Every entry of one directory (all pages) plus the commit it was read at. */
export async function listDir(ws: Ws, path: string, at?: Ref): Promise<{ commitId: string; entries: FileEntry[] }> {
  const store = getStore();
  const entries: FileEntry[] = [];
  let cursor: string | undefined;
  let commitId = '';
  // Pin later pages to the commit of the first page so a concurrent change can't mix versions.
  let pinned = at;
  for (;;) {
    const page = await store.list(ws.volumeId, path, { at: pinned, limit: 10_000, cursor });
    commitId = page.commitId;
    pinned = page.commitId || pinned;
    entries.push(...page.entries);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return { commitId, entries };
}

// Small LRU of recursive listings keyed by volumeId:commitId:root (commits are immutable).
const LRU_MAX = 64;
const lru = new Map<string, { commitId: string; entries: FileEntry[] }>();

function lruGet(key: string) {
  const v = lru.get(key);
  if (v) {
    lru.delete(key);
    lru.set(key, v);
  }
  return v;
}
function lruSet(key: string, v: { commitId: string; entries: FileEntry[] }) {
  lru.set(key, v);
  while (lru.size > LRU_MAX) lru.delete(lru.keys().next().value!);
}

export function clearTreeCache(): void {
  lru.clear();
}

/** Every descendant of `root` (recursive, all pages), cached per commit. */
export async function listTree(ws: Ws, root: string, at?: Ref): Promise<{ commitId: string; entries: FileEntry[] }> {
  const store = getStore();
  let commitId: string;
  if (at && COMMIT_ID.test(at)) commitId = at;
  else if (!at || at === 'head') commitId = (await store.getVolume(ws.volumeId)).headCommitId;
  else commitId = (await store.getCommit(ws.volumeId, at)).id; // tag
  const key = `${ws.volumeId}:${commitId}:${root}`;
  const hit = lruGet(key);
  if (hit) return hit;
  const entries: FileEntry[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await store.list(ws.volumeId, root, { at: commitId, recursive: true, limit: 10_000, cursor });
    entries.push(...page.entries);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  const v = { commitId, entries };
  lruSet(key, v);
  return v;
}

/** stat, or null when the path does not exist at that version. */
export async function statOrNull(ws: Ws, path: string, at?: Ref): Promise<FileStat | null> {
  try {
    return await getStore().stat(ws.volumeId, path, { at });
  } catch (e) {
    if (isStoreError(e, 'path_not_found')) return null;
    throw e;
  }
}

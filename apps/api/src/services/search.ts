import type { SearchResponse } from '@volumes/shared';
import type { FileEntry } from '../storage/types';
import type { WorkspaceCtx } from '../types';
import { listTree } from './tree';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Case-insensitive basename search over listTree(ws, '/', at), prefix matches first. */
export async function searchFiles(ws: WorkspaceCtx, q: string, at: string | undefined, limit: number): Promise<SearchResponse> {
  const needle = q.trim().normalize('NFC').toLocaleLowerCase();
  const tree = await listTree(ws, '/', at);
  if (!needle) return { commitId: tree.commitId, results: [], truncated: false };

  const hits: { e: FileEntry; rank: number; depth: number }[] = [];
  for (const e of tree.entries) {
    if (e.type !== 'file' && e.type !== 'dir') continue;
    const name = (e.name || e.path.slice(e.path.lastIndexOf('/') + 1)).toLocaleLowerCase();
    const i = name.indexOf(needle);
    if (i < 0) continue;
    // 0 exact, 1 prefix, 2 word start (after space, dot, dash, underscore), 3 anywhere.
    const rank = name === needle ? 0 : i === 0 ? 1 : /[\s._\-()[\]]/.test(name[i - 1]) ? 2 : 3;
    hits.push({ e, rank, depth: e.path.split('/').length });
  }
  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.e.type === 'dir' ? 0 : 1) - (b.e.type === 'dir' ? 0 : 1) ||
      a.depth - b.depth ||
      collator.compare(a.e.name, b.e.name) ||
      (a.e.path < b.e.path ? -1 : a.e.path > b.e.path ? 1 : 0),
  );
  const results = hits.slice(0, limit).map(({ e }) => ({
    path: e.path,
    name: e.name || e.path.slice(e.path.lastIndexOf('/') + 1),
    type: e.type,
    size: e.size,
    mtime: e.mtime,
  }));
  return { commitId: tree.commitId, results, truncated: hits.length > limit };
}

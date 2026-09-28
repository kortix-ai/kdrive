// Optimistic listing edits (rename / move / delete / new folder) over the swr
// cache key ['ls', ws, path, null] that useListing reads at "now", plus a tiny
// module store of rows in flight (pending hairline, collapsing, dragging).
import { mutate } from 'swr';
import { create } from 'zustand';
import type { FileEntry, ListResponse } from '@volumes/shared';

export const listingKey = (ws: string, path: string, at: string | null = null) => ['ls', ws, path, at] as const;

// ── pure transforms ──────────────────────────────────────────────────────────

export function withoutPaths(list: ListResponse, paths: readonly string[]): ListResponse {
  const drop = new Set(paths);
  return { ...list, entries: list.entries.filter((e) => !drop.has(e.path)) };
}

export function withRenamed(list: ListResponse, from: string, to: string): ListResponse {
  const name = to.slice(to.lastIndexOf('/') + 1);
  return { ...list, entries: list.entries.map((e) => (e.path === from ? { ...e, path: to, name } : e)) };
}

export function withAdded(list: ListResponse, entry: FileEntry): ListResponse {
  if (list.entries.some((e) => e.path === entry.path)) return list;
  return { ...list, entries: [...list.entries, entry] };
}

// ── rows in flight ───────────────────────────────────────────────────────────

export type PendingKind = 'rename' | 'move' | 'create' | 'delete';

interface PendingState {
  /** path → what is happening to it (drives the 1 px progress hairline). */
  pending: Record<string, PendingKind>;
  /** paths collapsing out of the list (160 ms) before the optimistic removal. */
  removing: Record<string, true>;
  /** paths being dragged (rendered at 40 %). */
  dragging: string[];
  /** A path to select and scroll to once its folder is listed (search "reveal"). */
  reveal: string | null;
}

export const useDriveRows = create<PendingState>()(() => ({ pending: {}, removing: {}, dragging: [], reveal: null }));

export function markPending(paths: readonly string[], kind: PendingKind): void {
  useDriveRows.setState((s) => {
    const pending = { ...s.pending };
    for (const p of paths) pending[p] = kind;
    return { pending };
  });
}

export function clearPending(paths: readonly string[]): void {
  useDriveRows.setState((s) => {
    const pending = { ...s.pending };
    const removing = { ...s.removing };
    for (const p of paths) {
      delete pending[p];
      delete removing[p];
    }
    return { pending, removing };
  });
}

export function markRemoving(paths: readonly string[]): void {
  useDriveRows.setState((s) => {
    const removing = { ...s.removing };
    for (const p of paths) removing[p] = true;
    return { removing };
  });
}

export function setDragging(paths: string[]): void {
  useDriveRows.setState({ dragging: paths });
}

export function requestReveal(path: string | null): void {
  useDriveRows.setState({ reveal: path });
}

// ── runner ──────────────────────────────────────────────────────────────────

/**
 * Applies `update` to the cached listing(s) immediately, runs `run`, and rolls
 * back (then revalidates) when it throws. Each key is ['ls', ws, dir, null].
 */
export async function optimistic<T>(
  ws: string,
  edits: { dir: string; update: (l: ListResponse) => ListResponse }[],
  run: () => Promise<T>,
): Promise<T> {
  const snapshots: { key: ReturnType<typeof listingKey>; data: ListResponse | undefined }[] = [];
  for (const e of edits) {
    const key = listingKey(ws, e.dir);
    let prev: ListResponse | undefined;
    await mutate<ListResponse>(
      key,
      (cur) => {
        prev = cur;
        return cur ? e.update(cur) : cur;
      },
      { revalidate: false },
    );
    snapshots.push({ key, data: prev });
  }
  try {
    return await run();
  } catch (err) {
    for (const s of snapshots) {
      if (s.data) await mutate(s.key, s.data, { revalidate: true });
      else await mutate(s.key);
    }
    throw err;
  }
}

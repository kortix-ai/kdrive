'use client';

// Stars (per person, private) and Recent: the hooks the drive and the two pages read, the
// star toggle every surface shares (row, card, menu, preview, `s`, selection bar), and the
// open record the preview and downloads send.
import { useMemo } from 'react';
import useSWR, { mutate } from 'swr';
import { basename, dirname, type FileEntry } from '@volumes/shared';
import { ApiError } from '../api/client';
import { api } from '../api/endpoints';
import { friendlyError } from './actions';
import { useVx, vx } from '../store';
import { driveHref } from '../urls';

const quiet = {
  shouldRetryOnError: (err: unknown) => !(err instanceof ApiError && err.status >= 400 && err.status < 500),
  revalidateOnFocus: false,
};

const EMPTY: ReadonlySet<string> = new Set();

/** Starred paths of the current drive. Key ['stars', ws]. */
export function useDriveStars(): ReadonlySet<string> {
  const ws = useVx((s) => s.workspaceId);
  const { data } = useSWR(ws ? (['stars', ws] as const) : null, ([, w]) => api.stars.drive(w), quiet);
  return useMemo(() => (data ? new Set(data.paths) : EMPTY), [data]);
}

/** Everything starred, across drives (the Starred page). */
export function useStarred() {
  return useSWR('starred', () => api.stars.list(), quiet);
}

/** Recently opened or changed files, across drives (the Recent page). */
export function useRecent() {
  return useSWR('recent', () => api.recent.list({ limit: 100 }), quiet);
}

/**
 * Stars `entries`, or unstars them when every one already is (the toggle a row, the menu,
 * the preview, the selection bar and `s` share). The drive's stars update at once.
 */
export async function toggleStars(ws: string, entries: readonly Pick<FileEntry, 'path' | 'name'>[], starred: ReadonlySet<string>): Promise<void> {
  const paths = entries.map((e) => e.path).filter((p) => p !== '/');
  if (!paths.length) return;
  const on = !paths.every((p) => starred.has(p));
  const key = ['stars', ws] as const;
  const next = new Set(starred);
  for (const p of paths) if (on) next.add(p);
  else next.delete(p);
  try {
    await mutate(key, api.stars.set(ws, paths, on), {
      optimisticData: { paths: [...next].sort() },
      rollbackOnError: true,
      populateCache: true,
      revalidate: false,
    });
    void mutate('starred');
    if (paths.length > 1) vx().toast({ kind: 'success', message: on ? `Starred ${paths.length} items` : `Removed ${paths.length} items from Starred` });
  } catch (e) {
    const what = paths.length === 1 ? basename(paths[0]) : `${paths.length} items`;
    vx().toast({ kind: 'error', message: `Couldn't ${on ? 'star' : 'unstar'} ${what}. ${friendlyError(e)}` });
  }
}

/** Stars or unstars one item of any drive (the Starred and Recent pages). False when it failed (with a toast). */
export async function setStarIn(ws: string, path: string, on: boolean): Promise<boolean> {
  try {
    await api.stars.set(ws, [path], on);
    void mutate(['stars', ws]);
    void mutate('starred');
    return true;
  } catch (e) {
    vx().toast({ kind: 'error', message: `Couldn't ${on ? 'star' : 'unstar'} ${basename(path)}. ${friendlyError(e)}` });
    return false;
  }
}

const lastOpen = new Map<string, number>();

/** Records that the user opened a file (preview or download) for Recent. Best effort, at most every 30 s per file. */
export function recordOpen(ws: string, path: string): void {
  const k = `${ws}\u0000${path}`;
  const now = Date.now();
  if (now - (lastOpen.get(k) ?? 0) < 30_000) return;
  lastOpen.set(k, now);
  void api.recent.opened(ws, path).then(
    () => void mutate('recent'),
    () => lastOpen.delete(k),
  );
}

/**
 * Opens an item of any drive the user can open: switches to the drive first, then shows the
 * folder (or the file's folder with the file selected and previewed).
 */
export function openInDrive(push: (href: string) => void, it: { workspaceId: string; path: string; type: 'file' | 'dir' }): void {
  const s = vx();
  if (s.workspaceId !== it.workspaceId) s.setWorkspace(it.workspaceId);
  else if (s.timeTravel) s.exitTimeTravel();
  if (it.type === 'dir') {
    push(driveHref(it.path));
    return;
  }
  const parent = dirname(it.path);
  s.setPath(parent);
  s.select([it.path]);
  s.openPreview(it.path, { at: null });
  push(driveHref(parent));
}

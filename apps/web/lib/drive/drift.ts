// "The diff is the drive" (DESIGN §6.3): compare a past listing with the
// listing now, by path, and say how each past row differs from today.
// Moves show as gone + added (no rename detection in the POC).
import type { FileEntry } from '@volumes/shared';

export type Drift = 'changed' | 'gone';

export interface DriftResult {
  byPath: Map<string, Drift>;
  /** Entries that exist now but not at the viewed version. */
  addedLater: FileEntry[];
}

export function computeDrift(past: readonly FileEntry[], now: readonly FileEntry[] | null | undefined): DriftResult {
  const byPath = new Map<string, Drift>();
  if (!now) return { byPath, addedLater: [] };
  const nowMap = new Map(now.map((e) => [e.path, e]));
  const pastMap = new Map(past.map((e) => [e.path, e]));
  for (const e of past) {
    const n = nowMap.get(e.path);
    if (!n || n.type !== e.type) byPath.set(e.path, 'gone');
    else if (e.type === 'dir' ? n.mtime !== e.mtime : n.size !== e.size || n.mtime !== e.mtime) byPath.set(e.path, 'changed');
  }
  const addedLater = now.filter((e) => {
    const p = pastMap.get(e.path);
    return !p || p.type !== e.type;
  });
  return { byPath, addedLater };
}

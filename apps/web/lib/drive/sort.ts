// Listing order: folders first always, then by the chosen column.
// Names compare naturally and case-insensitively ("file 2" < "file 10").

export type SortKey = 'name' | 'mtime' | 'size';
export type SortDir = 'asc' | 'desc';
export interface SortSpec {
  key: SortKey;
  dir: SortDir;
}

export const DEFAULT_SORT: SortSpec = { key: 'name', dir: 'asc' };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function compareNames(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

interface Sortable {
  name: string;
  type: string;
  size: number;
  mtime: number;
}

export function sortEntries<T extends Sortable>(entries: readonly T[], spec: SortSpec = DEFAULT_SORT): T[] {
  const sign = spec.dir === 'asc' ? 1 : -1;
  return entries.slice().sort((a, b) => {
    const da = a.type === 'dir' ? 0 : 1;
    const db = b.type === 'dir' ? 0 : 1;
    if (da !== db) return da - db;
    let c = 0;
    if (spec.key === 'size' && a.type !== 'dir') c = a.size - b.size;
    else if (spec.key === 'mtime') c = a.mtime - b.mtime;
    if (c === 0) c = spec.key === 'name' ? compareNames(a.name, b.name) : 0;
    if (c === 0) return compareNames(a.name, b.name);
    return c * sign;
  });
}

/** Clicking a column: same column flips; a new column starts asc for name, desc for dates and sizes. */
export function nextSort(cur: SortSpec, key: SortKey): SortSpec {
  if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'name' ? 'asc' : 'desc' };
}

const LS_SORT = 'vx-sort';

export function loadSort(): SortSpec {
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(LS_SORT);
    if (!raw) return DEFAULT_SORT;
    const v = JSON.parse(raw) as Partial<SortSpec>;
    if ((v.key === 'name' || v.key === 'mtime' || v.key === 'size') && (v.dir === 'asc' || v.dir === 'desc')) return { key: v.key, dir: v.dir };
  } catch {
    /* ignore */
  }
  return DEFAULT_SORT;
}

export function saveSort(spec: SortSpec): void {
  try {
    window.localStorage.setItem(LS_SORT, JSON.stringify(spec));
  } catch {
    /* private mode */
  }
}

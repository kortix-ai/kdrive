/** `quarterly-rep…final.pdf`: middle-truncates a file name to `max` chars, keeping the extension. */
export function middleTruncate(name: string, max = 40): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
  const stem = ext ? name.slice(0, dot) : name;
  const room = Math.max(4, max - ext.length - 1);
  const head = Math.ceil(room * 0.6);
  const tail = room - head;
  return `${stem.slice(0, head)}…${tail > 0 ? stem.slice(stem.length - tail) : ''}${ext}`;
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Folders first, then by name (natural, case-insensitive): the drive's default order. */
export function compareEntries(a: { name: string; type: string }, b: { name: string; type: string }): number {
  const da = a.type === 'dir' ? 0 : 1;
  const db = b.type === 'dir' ? 0 : 1;
  if (da !== db) return da - db;
  return collator.compare(a.name, b.name);
}

/** The file before / after `path` among `siblings` (already sorted), or null at the ends. */
export function stepSibling(siblings: string[], path: string, dir: 1 | -1): string | null {
  const i = siblings.indexOf(path);
  if (i < 0) return null;
  return siblings[i + dir] ?? null;
}

/** "PNG", "MARKDOWN" … a short type label from the extension. */
export function typeLabel(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'FILE';
  return name.slice(dot + 1).toUpperCase().slice(0, 8);
}

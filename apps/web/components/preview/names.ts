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

const EXT_WORD: Record<string, string> = { image: 'image', video: 'video', audio: 'audio' };
/** Friendly names for common source files ("TypeScript", not "TS file"). */
const CODE_NAME: Record<string, string> = {
  TS: 'TypeScript', TSX: 'TypeScript', MTS: 'TypeScript', CTS: 'TypeScript', JS: 'JavaScript', JSX: 'JavaScript', MJS: 'JavaScript', CJS: 'JavaScript',
  PY: 'Python', RB: 'Ruby', GO: 'Go', RS: 'Rust', JAVA: 'Java', KT: 'Kotlin', SWIFT: 'Swift', C: 'C', H: 'C header', CPP: 'C++', CS: 'C#',
  PHP: 'PHP', SH: 'Shell script', BASH: 'Shell script', ZSH: 'Shell script', SQL: 'SQL', CSS: 'CSS', SCSS: 'SCSS', HTML: 'HTML', HTM: 'HTML',
  XML: 'XML', SVG: 'SVG', YAML: 'YAML', YML: 'YAML', TOML: 'TOML',
};

/** "Markdown", "PNG image", "PDF", "TypeScript": a friendly type label for meta lines. */
export function kindLabel(name: string, kind: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toUpperCase().slice(0, 8) : '';
  switch (kind) {
    case 'markdown':
      return 'Markdown';
    case 'pdf':
      return 'PDF';
    case 'json':
      return 'JSON';
    case 'csv':
      return ext || 'CSV';
    case 'text':
      return CODE_NAME[ext] ?? (ext && ext !== 'TXT' ? `${ext} text` : 'Text');
    case 'image':
    case 'video':
    case 'audio':
      return ext ? `${ext} ${EXT_WORD[kind]}` : EXT_WORD[kind][0].toUpperCase() + EXT_WORD[kind].slice(1);
    default:
      return CODE_NAME[ext] ?? (ext ? `${ext} file` : 'File');
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Friendly relative time: `just now`, `4 min ago`, `2 hours ago`, `Today 09:12`, `Yesterday, 18:02`,
 * `Tue 16:40`, then `14 Sep` (another year adds it: `14 Sep 2025`).
 */
export function formatWhen(d: string | number | Date, now: Date = new Date()): string {
  const date = d instanceof Date ? d : new Date(d);
  const diff = now.getTime() - date.getTime();
  const hm = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (diff >= -60_000 && diff < 45_000) return 'just now';
  if (diff > 0 && diff < 60 * 60_000) return `${Math.max(1, Math.round(diff / 60_000))} min ago`;
  if (diff > 0 && diff < 6 * 3_600_000) {
    const h = Math.round(diff / 3_600_000);
    return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  }
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days === 0) return `Today ${hm}`;
  if (days === 1) return `Yesterday, ${hm}`;
  if (days > 1 && days < 7) return `${DAYS[date.getDay()]} ${hm}`;
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

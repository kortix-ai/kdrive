import { MAX_PATH_BYTES } from './constants';
import { utf8Length, validateName } from './names';

/** Thrown by path helpers for input that cannot be a valid drive path. */
export class PathError extends Error {
  readonly code = 'invalid_path' as const;
  constructor(message: string, readonly path?: string) {
    super(message);
    this.name = 'PathError';
  }
}

/**
 * Normalises a drive path: absolute POSIX, `/` is the root, no trailing slash,
 * NFC, `.` and empty segments dropped, `..` collapsed (never above the root).
 * Every segment must pass `validateName` (so a backslash is an invalid name,
 * never a separator). Throws `PathError`.
 */
export function normalizePath(input: string): string {
  if (typeof input !== 'string') throw new PathError('Path must be a string.');
  if (input.includes('\0')) throw new PathError('Path cannot contain NUL.', input);
  const raw = input.normalize('NFC');
  const out: string[] = [];
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) throw new PathError('Path climbs above the root.', input);
      out.pop();
      continue;
    }
    const err = validateName(seg);
    if (err) throw new PathError(err, input);
    out.push(seg);
  }
  const p = '/' + out.join('/');
  if (utf8Length(p) > MAX_PATH_BYTES) throw new PathError('Path is too long.', input);
  return p;
}

/** Like normalizePath but returns null instead of throwing. */
export function tryNormalizePath(input: string): string | null {
  try {
    return normalizePath(input);
  } catch {
    return null;
  }
}

export function isRoot(p: string): boolean {
  return p === '/';
}

/** Joins segments / paths and normalises the result. */
export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter((p) => p !== '').join('/'));
}

export function splitPath(p: string): string[] {
  return p.split('/').filter(Boolean);
}

export function dirname(p: string): string {
  const segs = splitPath(p);
  segs.pop();
  return '/' + segs.join('/');
}

export function basename(p: string): string {
  const segs = splitPath(p);
  return segs.length ? segs[segs.length - 1] : '';
}

/** Last extension including the dot, lowercased (`"a.tar.GZ"` → `".gz"`). Dotfiles have none. */
export function extname(name: string): string {
  const base = name.includes('/') ? basename(name) : name;
  const i = base.lastIndexOf('.');
  if (i <= 0) return '';
  return base.slice(i).toLowerCase();
}

/** True when `p` is `root` or inside it. Both must be normalised. */
export function isWithin(root: string, p: string): boolean {
  if (root === '/') return p.startsWith('/');
  return p === root || p.startsWith(root + '/');
}

/** Path of `p` relative to `root`, as an absolute path rooted at `/`. */
export function relativeTo(root: string, p: string): string {
  if (!isWithin(root, p)) throw new PathError('Path is outside the root.', p);
  if (root === '/') return p;
  const rest = p.slice(root.length);
  return rest === '' ? '/' : rest;
}

/** `/a b/c` → `a%20b/c` (each segment encoded; used in /drive URLs). */
export function encodePathForUrl(p: string): string {
  return splitPath(p).map(encodeURIComponent).join('/');
}

/** Route segments (already split, maybe still encoded) → normalised path. */
export function decodePathFromUrl(segments: string[] | string | undefined | null): string {
  if (!segments) return '/';
  const list = Array.isArray(segments) ? segments : [segments];
  const decoded = list.map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  return normalizePath('/' + decoded.join('/'));
}

const COMPOUND_EXT = /\.tar\.(gz|bz2|xz|zst|lz|lz4|z)$/i;

/**
 * Keep-both rename: `a.txt` → `a (1).txt`, `a` → `a (1)`, `a.tar.gz` → `a (1).tar.gz`.
 * Only the last extension is kept aside, except well-known compound archive
 * extensions (`.tar.gz` and friends). Dotfiles keep the whole name as the stem.
 */
export function keepBothName(name: string, n: number): string {
  const compound = COMPOUND_EXT.exec(name);
  if (compound && compound.index > 0) {
    return `${name.slice(0, compound.index)} (${n})${name.slice(compound.index)}`;
  }
  const i = name.lastIndexOf('.');
  if (i <= 0) return `${name} (${n})`;
  return `${name.slice(0, i)} (${n})${name.slice(i)}`;
}

/** Picks the first keep-both name not in `taken` (a set of names in the same folder). */
export function nextFreeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let n = 1; n < 100_000; n++) {
    const candidate = keepBothName(name, n);
    if (!taken.has(candidate)) return candidate;
  }
  throw new PathError('Could not find a free name.', name);
}

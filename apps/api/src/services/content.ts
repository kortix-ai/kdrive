// Content responses: single files (Range, ETag, security headers) and folder
// zips (streamed, lazily read). Reused by the public share routes.
// See architecture §6.4.
import type { Context } from 'hono';
import { downloadZip, predictLength } from 'client-zip';
import { basename, dirname, isActiveContent, isWithin, mimeFor, relativeTo as relTo } from '@volumes/shared';
import { ApiError } from '../lib/http';
import { getStore } from '../storage';
import type { FileStat } from '../storage/types';
import { listTree } from './tree';

const COMMIT_ID = /^vc_[0-9A-HJKMNP-TV-Z]{26}$/i;

/** Every content response carries this CSP (the document is sandboxed: no scripts, no forms, no same-origin). */
export const CONTENT_CSP =
  "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox";
/** Browsers refuse to render a PDF inside a sandboxed document, so PDFs drop `sandbox` (scripts stay blocked by default-src). */
export const CONTENT_CSP_PDF = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'";

/** RFC 5987 value for `filename*`. */
function rfc5987(v: string): string {
  return encodeURIComponent(v).replace(/['()*]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
}

/** `attachment; filename="ascii"; filename*=UTF-8''utf8` (the ASCII fallback never carries quotes or control chars). */
export function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'download';
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${rfc5987(name || 'download')}`;
}

type RangeCheck = { start: number; end: number } | 'ignore' | 'unsatisfiable';

/**
 * One `Range` header against a known size. Malformed or multi-range headers are
 * ignored (a full 200 is always a valid answer); unsatisfiable ones are 416.
 */
export function checkRange(header: string, size: number): RangeCheck {
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m) return 'ignore';
  const [, a, b] = m;
  if (a === '' && b === '') return 'ignore';
  if (size === 0) return 'ignore';
  if (a === '') {
    const n = Number(b);
    if (!Number.isSafeInteger(n)) return 'ignore';
    if (n === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  if (!Number.isSafeInteger(start)) return 'ignore';
  if (start >= size) return 'unsatisfiable';
  let end = b === '' ? size - 1 : Number(b);
  if (!Number.isSafeInteger(end)) return 'ignore';
  if (end < start) return 'ignore';
  if (end > size - 1) end = size - 1;
  return { start, end };
}

function etagMatches(header: string | undefined, etag: string | null): boolean {
  if (!header || !etag) return false;
  return header
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === '*' || t === etag);
}

function cacheControl(at: string | undefined): string {
  return at && COMMIT_ID.test(at) ? 'private, max-age=31536000, immutable' : 'no-store';
}

function baseContentHeaders(h: Headers, at: string | undefined, csp: string): void {
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Content-Security-Policy', csp);
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  h.set('Cache-Control', cacheControl(at));
}

/**
 * Streams one file (Range passthrough, ETag, nosniff, CSP; attachment for
 * downloads and active content). See architecture §6.4.
 */
export async function streamFile(
  c: Context,
  ws: { volumeId: string },
  path: string,
  opts: { at?: string; download?: boolean },
): Promise<Response> {
  const store = getStore();
  const st = await store.stat(ws.volumeId, path, { at: opts.at });
  if (st.type !== 'file') {
    throw new ApiError(409, st.type === 'dir' ? 'not_a_file' : 'bad_request', 'That is a folder, not a file.', { path });
  }
  const name = st.name || basename(path) || 'download';
  const active = isActiveContent(name);
  const download = !!opts.download;
  const mime = mimeFor(name);
  const etag = st.version ? `"${st.version}"` : null;

  const h = new Headers();
  // Active content (HTML, SVG, XML, JS) is never rendered on the app origin:
  // always an attachment, and shown as plain text when asked for inline.
  h.set('Content-Type', active && !download ? 'text/plain; charset=utf-8' : mime);
  h.set('Content-Disposition', contentDisposition(download || active ? 'attachment' : 'inline', name));
  baseContentHeaders(h, opts.at, mime === 'application/pdf' && !active ? CONTENT_CSP_PDF : CONTENT_CSP);
  h.set('Accept-Ranges', 'bytes');
  h.set('Last-Modified', new Date(st.mtime).toUTCString());
  if (etag) h.set('ETag', etag);

  if (etagMatches(c.req.header('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers: h });
  }

  let range: string | undefined;
  const rangeHeader = c.req.header('range');
  const ifRange = c.req.header('if-range');
  const rangeAllowed = !ifRange || (etag !== null && ifRange.trim() === etag);
  if (rangeHeader && rangeAllowed && st.size > 0) {
    const r = checkRange(rangeHeader, st.size);
    if (r === 'unsatisfiable') {
      const eh = new Headers({ 'Content-Type': 'application/json', 'Content-Range': `bytes */${st.size}` });
      baseContentHeaders(eh, undefined, CONTENT_CSP);
      return new Response(
        JSON.stringify({ error: { code: 'range_not_satisfiable', message: 'Requested range not satisfiable.' } }),
        { status: 416, headers: eh },
      );
    }
    if (r !== 'ignore') range = `bytes=${r.start}-${r.end}`;
  }

  if (c.req.raw.method === 'HEAD') {
    h.set('Content-Length', String(st.size));
    return new Response(null, { status: 200, headers: h });
  }

  // Pin the read to the commit the stat resolved, so headers and bytes agree.
  const r = await store.read(ws.volumeId, path, { at: st.commitId || opts.at, range, signal: c.req.raw.signal });
  // Never announce a length the body does not have: a wrong Content-Length corrupts the
  // connection for whatever proxy sits in front of us.
  const length = r.contentLength ?? (r.status === 200 ? st.size : rangeLength(r.contentRange));
  if (length !== null) h.set('Content-Length', String(length));
  if (r.status === 206 && r.contentRange) h.set('Content-Range', r.contentRange);
  if (r.etag) h.set('ETag', r.etag);
  return new Response(r.body, { status: r.status, headers: h });
}

/** Bytes covered by a `Content-Range: bytes a-b/total` header, or null. */
function rangeLength(contentRange: string | null): number | null {
  const m = contentRange ? /^bytes (\d+)-(\d+)\//.exec(contentRange) : null;
  return m ? Number(m[2]) - Number(m[1]) + 1 : null;
}

/** Deepest common ancestor directory of normalised paths. */
function commonDir(paths: string[]): string {
  if (!paths.length) return '/';
  let common = paths[0].split('/').filter(Boolean);
  for (const p of paths.slice(1)) {
    const segs = p.split('/').filter(Boolean);
    let i = 0;
    while (i < common.length && i < segs.length && common[i] === segs[i]) i++;
    common = common.slice(0, i);
  }
  return '/' + common.join('/');
}

/** Drops roots that sit inside another root (the parent already includes them). */
function topLevel(roots: string[]): string[] {
  const uniq = [...new Set(roots)].sort();
  const out: string[] = [];
  for (const r of uniq) if (!out.some((o) => isWithin(o, r))) out.push(r);
  return out;
}

interface ZipItem {
  name: string;
  lastModified: Date;
  kind: 'file' | 'dir';
  path: string;
  size: number;
}

/** Zip-safe `.zip` base name (no separators or control chars). */
export function zipBaseName(name: string): string {
  const cleaned = name
    .replace(/\.zip$/i, '')
    .replace(/[\x00-\x1f\x7f/\\]/g, '_')
    .trim();
  return cleaned || 'volumes';
}

/**
 * Streams a zip of `roots` (recursive, empty dirs as `name/`). See architecture §6.4.
 * Entry names are relative to `opts.relativeTo`; by default that is the folder
 * itself for a single folder root (so `Docs.zip` holds `a.txt`, `sub/`), and
 * the common parent folder otherwise (so the roots keep their own names).
 * Every read is pinned to one commit, so the archive is a consistent snapshot.
 */
export async function streamZip(
  c: Context,
  ws: { volumeId: string },
  roots: string[],
  opts: { at?: string; zipName: string; relativeTo?: string },
): Promise<Response> {
  const store = getStore();
  const tops = topLevel(roots);
  if (!tops.length) throw new ApiError(400, 'bad_request', 'Nothing to download.');

  // Resolve the version once, then stat every root at that exact commit.
  let pinned = opts.at;
  const stats: FileStat[] = [];
  for (const root of tops) {
    const st = await store.stat(ws.volumeId, root, { at: pinned });
    pinned = st.commitId || pinned;
    stats.push(st);
  }

  const base =
    opts.relativeTo ?? (tops.length === 1 && stats[0].type === 'dir' ? tops[0] : commonDir(tops.map((r) => dirname(r))));
  const nameOf = (p: string) => relTo(base, p).replace(/^\/+/, '');

  const items: ZipItem[] = [];
  for (let i = 0; i < tops.length; i++) {
    const root = tops[i];
    const st = stats[i];
    if (!isWithin(base, root)) throw new ApiError(400, 'bad_request', 'Path is outside the download root.');
    if (st.type === 'file') {
      items.push({ name: nameOf(root), kind: 'file', path: root, size: st.size, lastModified: new Date(st.mtime) });
      continue;
    }
    if (st.type !== 'dir') continue;
    if (root !== base) items.push({ name: nameOf(root) + '/', kind: 'dir', path: root, size: 0, lastModified: new Date(st.mtime) });
    const tree = await listTree(ws, root, pinned);
    for (const e of tree.entries) {
      if (e.type === 'dir') items.push({ name: nameOf(e.path) + '/', kind: 'dir', path: e.path, size: 0, lastModified: new Date(e.mtime) });
      else if (e.type === 'file') items.push({ name: nameOf(e.path), kind: 'file', path: e.path, size: e.size, lastModified: new Date(e.mtime) });
    }
  }

  const signal = c.req.raw.signal;
  const at = pinned;
  async function* entries() {
    for (const it of items) {
      if (signal?.aborted) return;
      if (it.kind === 'dir') {
        yield { name: it.name, lastModified: it.lastModified };
        continue;
      }
      const r = await store.read(ws.volumeId, it.path, { at, signal });
      yield { name: it.name, lastModified: it.lastModified, size: it.size, input: r.body };
    }
  }

  let length: bigint | undefined;
  try {
    length = predictLength(
      items.map((it) => (it.kind === 'dir' ? { name: it.name, lastModified: it.lastModified } : { name: it.name, size: it.size, lastModified: it.lastModified })),
    );
  } catch {
    length = undefined;
  }
  const zip = downloadZip(entries(), length !== undefined ? { length } : undefined);

  const h = new Headers();
  h.set('Content-Type', 'application/zip');
  h.set('Content-Disposition', contentDisposition('attachment', `${zipBaseName(opts.zipName)}.zip`));
  if (length !== undefined) h.set('Content-Length', String(length));
  baseContentHeaders(h, opts.at, CONTENT_CSP);
  return new Response(zip.body, { status: 200, headers: h });
}

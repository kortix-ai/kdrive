import { encodePathForUrl } from '@volumes/shared';
import { qs } from './api/client';

/** Bytes of a file (inline preview, or attachment with `download`). */
export function contentUrl(ws: string, path: string, opts: { at?: string | null; download?: boolean } = {}): string {
  return `/api/w/${encodeURIComponent(ws)}/files/content${qs({ path, at: opts.at, download: opts.download ? '1' : undefined })}`;
}

export function zipUrl(ws: string, paths: string[], at?: string | null, name?: string): string {
  return `/api/w/${encodeURIComponent(ws)}/files/zip${qs({ paths, at, name })}`;
}

export function publicContentUrl(token: string, path: string, opts: { download?: boolean } = {}): string {
  return `/api/public/s/${encodeURIComponent(token)}/content${qs({ path, download: opts.download ? '1' : undefined })}`;
}

export function publicZipUrl(token: string, path: string): string {
  return `/api/public/s/${encodeURIComponent(token)}/zip${qs({ path })}`;
}

/** `/drive/My%20Docs/sub` for `/My Docs/sub`; `/drive` for the root. */
export function driveHref(path: string): string {
  const enc = encodePathForUrl(path);
  return enc ? `/drive/${enc}` : '/drive';
}

export function compareHref(path: string, a: string, b: string): string {
  return `/compare${qs({ path, a, b })}`;
}

export function driveCompareHref(a: string, b: string): string {
  return `/compare/drive${qs({ a, b })}`;
}

export function publicShareHref(token: string, relPath = '/'): string {
  const enc = encodePathForUrl(relPath);
  return enc ? `/s/${encodeURIComponent(token)}/${enc}` : `/s/${encodeURIComponent(token)}`;
}

/** The review page of one proposal (in the current workspace). */
export function proposalHref(id: string): string {
  return `/proposals/${encodeURIComponent(id)}`;
}

/** Staged bytes of one proposed write (inline preview, or attachment with `download`). */
export function proposalContentUrl(ws: string, id: string, seq: number, download?: boolean): string {
  return `/api/w/${encodeURIComponent(ws)}/proposals/${encodeURIComponent(id)}/files/${seq}/content${qs({ download: download ? '1' : undefined })}`;
}

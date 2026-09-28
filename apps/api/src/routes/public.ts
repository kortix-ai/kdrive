import type { Context } from 'hono';
import { Hono } from 'hono';
import {
  basename,
  FlagSchema,
  isWithin,
  joinPath,
  mimeFor,
  PublicListResponse,
  PublicShareMeta,
  relativeTo,
  tryNormalizePath,
  type FileEntry,
} from '@volumes/shared';
import { ApiError, ok } from '../lib/http';
import { checkRateLimit, clientIp, limits } from '../middleware/rate-limit';
import { streamFile, streamZip } from '../services/content';
import { linkDisplayName, recordLinkOpen, resolvePublicLinkFull, type PublicLink } from '../services/links';
import { listDir, statOrNull } from '../services/tree';
import { getStore } from '../storage';
import type { AppEnv } from '../types';

/**
 * Public share routes (mounted at /api/public, no session needed). Every read
 * is confined to the link root and to the link's version (pinned commit or
 * head). The owner's workspace and volume ids never appear in a response.
 */
export const publicRoutes = new Hono<AppEnv>();

/** Every public request, whatever the token: bounds token guessing from one address. */
const PUBLIC_IP = { name: 'public-ip', capacity: 1200, refillPerSec: 20 } as const;
publicRoutes.use('*', async (c, next) => {
  checkRateLimit({ ...PUBLIC_IP, key: (cc) => clientIp(cc) }, c);
  await next();
});

const notFound = () => new ApiError(404, 'not_found', 'Nothing is shared at this address.');

/** Link opens: 60/min per IP+token and 600/min per token (architecture §6.1). */
function limitOpen(c: Context, token: string): void {
  checkRateLimit({ ...limits.linkOpenIpToken, key: (cc) => `${clientIp(cc)}|${token}` }, c);
  checkRateLimit({ ...limits.linkOpenToken, key: () => token }, c);
}

/**
 * Reads behind an opened link (listing, previews, Range requests while a
 * video seeks, zips): a wider bucket per IP+token so a folder with previews
 * or a seeking video is not throttled, while scraping still is.
 */
const PUBLIC_READ = { name: 'link-read-ip', capacity: 600, refillPerSec: 10 } as const;
const PUBLIC_READ_TOKEN = { name: 'link-read-token', capacity: 6000, refillPerSec: 100 } as const;
function limitRead(c: Context, token: string): void {
  checkRateLimit({ ...PUBLIC_READ, key: (cc) => `${clientIp(cc)}|${token}` }, c);
  checkRateLimit({ ...PUBLIC_READ_TOKEN, key: () => token }, c);
}

/**
 * `rel` (relative to the link root, from the query) → absolute path inside
 * the link. Anything that does not normalise or escapes the root is a 404,
 * so a traversal attempt looks exactly like a missing file.
 */
function resolveInside(pl: PublicLink, rawRel: string | undefined): string {
  if (pl.link.targetType === 'file') return pl.link.path; // a file link ignores `path`
  const rel = tryNormalizePath(rawRel && rawRel !== '' ? rawRel : '/');
  if (rel === null) throw notFound();
  let abs: string;
  try {
    abs = joinPath(pl.link.path, rel);
  } catch {
    throw notFound();
  }
  if (!isWithin(pl.link.path, abs)) throw notFound();
  return abs;
}

function flag(c: Context, name: string): boolean {
  const v = FlagSchema.safeParse(c.req.query(name));
  return v.success && (v.data === '1' || v.data === 'true');
}

publicRoutes.get('/s/:token', async (c) => {
  const token = c.req.param('token');
  limitOpen(c, token);
  const pl = await resolvePublicLinkFull(token);
  const st = await statOrNull(pl.ws, pl.link.path, pl.at);
  // A live link whose item was deleted, moved or replaced by another type is gone.
  if (!st || st.type !== pl.link.targetType) throw notFound();
  let pinnedAt: string | null = null;
  if (pl.at) pinnedAt = (await getStore().getCommit(pl.ws.volumeId, pl.at)).createdAt;
  await recordLinkOpen(pl.link.id);
  const name = linkDisplayName(pl.link, pl.workspaceName);
  return ok(c, PublicShareMeta, {
    name,
    targetType: pl.link.targetType,
    mode: pl.link.mode,
    pinnedAt,
    commitId: pl.at ?? null,
    expiresAt: pl.link.expiresAt ? pl.link.expiresAt.toISOString() : null,
    ownerName: pl.ownerName,
    ...(st.type === 'file' ? { size: st.size, mime: mimeFor(basename(pl.link.path)) } : {}),
  });
});

publicRoutes.get('/s/:token/files', async (c) => {
  const token = c.req.param('token');
  limitRead(c, token);
  const pl = await resolvePublicLinkFull(token);
  if (pl.link.targetType !== 'dir') throw new ApiError(409, 'not_a_directory', 'This link shares a single file.');
  const abs = resolveInside(pl, c.req.query('path'));
  const st = await statOrNull(pl.ws, abs, pl.at);
  if (!st) throw notFound();
  if (st.type !== 'dir') throw new ApiError(409, 'not_a_directory', 'That is a file, not a folder.');
  const { entries } = await listDir(pl.ws, abs, pl.at);
  const out: FileEntry[] = entries
    .filter((e) => e.type === 'file' || e.type === 'dir')
    .map((e) => ({ path: relativeTo(pl.link.path, e.path), name: e.name || basename(e.path), type: e.type, size: e.size, mtime: e.mtime }))
    .sort(byTypeThenName);
  return ok(c, PublicListResponse, { path: relativeTo(pl.link.path, abs), entries: out });
});

publicRoutes.get('/s/:token/content', async (c) => {
  const token = c.req.param('token');
  limitRead(c, token);
  const pl = await resolvePublicLinkFull(token);
  const abs = resolveInside(pl, c.req.query('path'));
  const st = await statOrNull(pl.ws, abs, pl.at);
  if (!st) throw notFound();
  if (st.type !== 'file') throw new ApiError(409, 'not_a_file', 'That is a folder, not a file.');
  return streamFile(c, pl.ws, abs, { at: pl.at, download: flag(c, 'download') });
});

publicRoutes.get('/s/:token/zip', async (c) => {
  const token = c.req.param('token');
  limitRead(c, token);
  const pl = await resolvePublicLinkFull(token);
  const abs = resolveInside(pl, c.req.query('path'));
  const st = await statOrNull(pl.ws, abs, pl.at);
  if (!st || (st.type !== 'file' && st.type !== 'dir')) throw notFound();
  const zipName = basename(abs) || linkDisplayName(pl.link, pl.workspaceName) || 'shared';
  return streamZip(c, pl.ws, [abs], { at: pl.at, zipName });
});

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function byTypeThenName(a: FileEntry, b: FileEntry): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : b.type === 'dir' ? 1 : 0;
  return collator.compare(a.name, b.name);
}

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
  PublicUnlockRequest,
  relativeTo,
  tryNormalizePath,
  type FileEntry,
} from '@volumes/shared';
import { ApiError, noContent, ok, parseJson } from '../lib/http';
import { checkRateLimit, clientIp, limits } from '../middleware/rate-limit';
import { streamFile, streamZip } from '../services/content';
import { assertDownloadAllowed, assertLinkAccess, unlockLink } from '../services/link-access';
import { linkDisplayName, recordLinkOpen, resolvePublicLinkFull, type PublicLink } from '../services/links';
import { listDir, statOrNull } from '../services/tree';
import { getStore } from '../storage';
import type { FileStat } from '../storage/types';
import type { AppEnv } from '../types';

/**
 * Public share routes (mounted at /api/public, no session needed). Every read
 * is confined to the link root and to the link's version (pinned commit or
 * head), and passes the link's access gates (people, password; downloads for
 * the download routes). The owner's workspace and volume ids never appear in a response.
 */
export const publicRoutes = new Hono<AppEnv>();

/** Every public request, whatever the token: bounds token guessing from one address. */
const PUBLIC_IP = { name: 'public-ip', capacity: 1200, refillPerSec: 20 } as const;
publicRoutes.use('*', async (c, next) => {
  checkRateLimit({ ...PUBLIC_IP, key: (cc) => clientIp(cc) }, c);
  await next();
});

const notFound = () => new ApiError(404, 'not_found', 'Nothing is shared at this address.');

/**
 * Unknown tokens, counted across every client: forwarding headers can be
 * forged in front of the web app's rewrite, so guessing is also bounded globally.
 */
const TOKEN_MISS_ALL = { name: 'link-miss-all', capacity: 600, refillPerSec: 5 } as const;

async function resolveLink(c: Context, token: string, opts: { gate?: boolean } = {}): Promise<PublicLink> {
  let pl: PublicLink;
  try {
    pl = await resolvePublicLinkFull(token);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) checkRateLimit({ ...TOKEN_MISS_ALL, key: () => 'all' }, c);
    throw e;
  }
  if (opts.gate !== false) await assertLinkAccess(c, pl.link);
  return pl;
}

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

/**
 * The link root at the link's version. It must still be the kind of item that
 * was shared: a file link whose path now holds a folder (or the reverse) is
 * gone, on every route, so nothing that happens to sit there is ever served.
 */
async function linkRoot(pl: PublicLink): Promise<FileStat> {
  const st = await statOrNull(pl.ws, pl.link.path, pl.at);
  if (!st || st.type !== pl.link.targetType) throw notFound();
  return st;
}

function flag(c: Context, name: string): boolean {
  const v = FlagSchema.safeParse(c.req.query(name));
  return v.success && (v.data === '1' || v.data === 'true');
}

publicRoutes.get('/s/:token', async (c) => {
  const token = c.req.param('token');
  limitOpen(c, token);
  const pl = await resolveLink(c, token);
  const st = await linkRoot(pl);
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
    allowDownload: pl.link.allowDownload,
  });
});

/** The password form: a right password sets a short-lived unlock cookie for this link only. */
publicRoutes.post('/s/:token/unlock', async (c) => {
  const token = c.req.param('token');
  limitOpen(c, token);
  const pl = await resolveLink(c, token, { gate: false });
  const req = await parseJson(c, PublicUnlockRequest);
  await unlockLink(c, pl.link, req.password);
  return noContent(c);
});

publicRoutes.get('/s/:token/files', async (c) => {
  const token = c.req.param('token');
  limitRead(c, token);
  const pl = await resolveLink(c, token);
  if (pl.link.targetType !== 'dir') throw new ApiError(409, 'not_a_directory', 'This link shares a single file.');
  await linkRoot(pl);
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
  const pl = await resolveLink(c, token);
  await linkRoot(pl);
  const abs = resolveInside(pl, c.req.query('path'));
  const st = await statOrNull(pl.ws, abs, pl.at);
  if (!st) throw notFound();
  if (st.type !== 'file') throw new ApiError(409, 'not_a_file', 'That is a folder, not a file.');
  const download = flag(c, 'download');
  if (download) assertDownloadAllowed(pl.link);
  return streamFile(c, pl.ws, abs, { at: pl.at, download, viewOnly: !pl.link.allowDownload });
});

publicRoutes.get('/s/:token/zip', async (c) => {
  const token = c.req.param('token');
  limitRead(c, token);
  const pl = await resolveLink(c, token);
  assertDownloadAllowed(pl.link);
  const root = await linkRoot(pl);
  // A file link downloads the file itself; only a folder link zips.
  if (root.type === 'file') return streamFile(c, pl.ws, pl.link.path, { at: pl.at, download: true });
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

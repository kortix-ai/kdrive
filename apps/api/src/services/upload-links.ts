// Upload links: people without an account send files into one folder of a
// drive. They never list or read the folder. Each file is streamed to a temp
// file while it is hashed into 1 MiB blocks, then lands through the server
// upload pipeline as ONE ledger action (kind `upload`) charged to the drive
// owner's quota. A name already taken gets " (1)" and so on: nothing is ever
// overwritten. Errors never name what else is in the folder.
import { createHash } from 'node:crypto';
import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import {
  BLOCK_SIZE,
  UPLOAD_LINK_DAY_BYTES,
  UPLOAD_LINK_DAY_FILES,
  UPLOAD_LINK_FILE_MAX,
  UPLOAD_LINK_MAX_DEPTH,
  UPLOAD_LINK_SENDER_MAX,
  basename,
  dirname,
  joinPath,
  validateName,
} from '@volumes/shared';
import { db } from '../db/client';
import { shareLinks, type ShareLinkRow } from '../db/schema';
import { ApiError } from '../lib/http';
import { isStoreError } from '../storage/types';
import { logicalSize } from './footprint';
import { withPreparedAction } from './ledger';
import type { PublicLink } from './links';
import { assertQuota } from './quota';
import { Hold } from './reservations';
import { serverUpload, type BlockSource } from './server-upload';
import { statOrNull } from './tree';
import { resolveUploadPlan } from './upload-plan';

/** Bytes per file this link accepts: its own limit, never above the server cap. */
export function fileLimit(link: Pick<ShareLinkRow, 'maxFileBytes'>): number {
  return Math.min(link.maxFileBytes ?? UPLOAD_LINK_FILE_MAX, UPLOAD_LINK_FILE_MAX);
}

/** Files the link still accepts, or null when it has no file limit. */
export function remainingFiles(link: Pick<ShareLinkRow, 'maxFiles' | 'uploadCount'>): number | null {
  return link.maxFiles === null ? null : Math.max(0, link.maxFiles - link.uploadCount);
}

const full = () => new ApiError(413, 'folder_full', "This folder can't accept more files right now.");
const badName = (message: string) => new ApiError(400, 'invalid_name', message);

/**
 * The sender's relative path ("report.pdf" or "Trip/day 1/a.jpg") → its
 * segments. Every segment must be a valid name: "..", ".", empty segments,
 * backslashes and control characters are refused, never resolved, so a name
 * can never climb out of the link's folder.
 */
export function senderPath(raw: string | undefined | null): string[] {
  if (!raw) throw badName('The file needs a name.');
  if (raw.length > 4096) throw badName('That name is too long.');
  const segs = raw.split('/');
  if (segs.length > UPLOAD_LINK_MAX_DEPTH) throw badName('That folder is nested too deeply.');
  for (const seg of segs) {
    const err = validateName(seg);
    if (err) throw badName(err);
  }
  return segs;
}

/** The optional "Your name": trimmed, control characters removed, at most 80 characters. */
export function senderName(raw: string | undefined | null): string | null {
  if (!raw) return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, UPLOAD_LINK_SENDER_MAX);
  return s || null;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Claims one file of `size` bytes against the link's limits, atomically: the
 * file limit, and the per-day bytes and files (the day rolls over in UTC).
 * Returns false when the link cannot take it.
 */
async function claim(linkId: string, size: number): Promise<'ok' | 'max_files' | 'day'> {
  const day = today();
  const sameDay = sql`${shareLinks.uploadDay} = ${day}`;
  const rows = await db
    .update(shareLinks)
    .set({
      uploadCount: sql`${shareLinks.uploadCount} + 1`,
      uploadBytes: sql`${shareLinks.uploadBytes} + ${size}`,
      uploadDay: day,
      uploadDayBytes: sql`CASE WHEN ${sameDay} THEN ${shareLinks.uploadDayBytes} + ${size} ELSE ${size} END`,
      uploadDayFiles: sql`CASE WHEN ${sameDay} THEN ${shareLinks.uploadDayFiles} + 1 ELSE 1 END`,
    })
    .where(
      and(
        eq(shareLinks.id, linkId),
        sql`(${shareLinks.maxFiles} IS NULL OR ${shareLinks.uploadCount} < ${shareLinks.maxFiles})`,
        sql`(CASE WHEN ${sameDay} THEN ${shareLinks.uploadDayBytes} ELSE 0 END) + ${size} <= ${UPLOAD_LINK_DAY_BYTES}`,
        sql`(CASE WHEN ${sameDay} THEN ${shareLinks.uploadDayFiles} ELSE 0 END) < ${UPLOAD_LINK_DAY_FILES}`,
      ),
    )
    .returning({ id: shareLinks.id });
  if (rows.length) return 'ok';
  const [row] = await db.select({ maxFiles: shareLinks.maxFiles, n: shareLinks.uploadCount }).from(shareLinks).where(eq(shareLinks.id, linkId));
  return row && row.maxFiles !== null && row.n >= row.maxFiles ? 'max_files' : 'day';
}

/** Gives a claim back (the file did not land). */
async function unclaim(linkId: string, size: number): Promise<void> {
  await db
    .update(shareLinks)
    .set({
      uploadCount: sql`GREATEST(${shareLinks.uploadCount} - 1, 0)`,
      uploadBytes: sql`GREATEST(${shareLinks.uploadBytes} - ${size}, 0)`,
      uploadDayBytes: sql`CASE WHEN ${shareLinks.uploadDay} = ${today()} THEN GREATEST(${shareLinks.uploadDayBytes} - ${size}, 0) ELSE ${shareLinks.uploadDayBytes} END`,
      uploadDayFiles: sql`CASE WHEN ${shareLinks.uploadDay} = ${today()} THEN GREATEST(${shareLinks.uploadDayFiles} - 1, 0) ELSE ${shareLinks.uploadDayFiles} END`,
    })
    .where(eq(shareLinks.id, linkId));
}

interface Spooled {
  size: number;
  blocks: string[];
  source: BlockSource;
  close: () => Promise<void>;
}

/**
 * Writes the request body to a temp file while hashing it into 1 MiB blocks.
 * The body must be exactly `declared` bytes: more is refused as soon as it
 * shows, less once it ends. Blocks are read back from the file on demand.
 */
async function spool(body: ReadableStream<Uint8Array>, declared: number): Promise<Spooled> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kdrive-upload-link-'));
  let fh: FileHandle | null = null;
  const close = async () => {
    await fh?.close().catch(() => {});
    fh = null;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  };
  try {
    fh = await open(path.join(dir, 'body'), 'w+');
    const blocks: string[] = [];
    let hash = createHash('sha256');
    let inBlock = 0;
    let size = 0;
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      size += value.length;
      if (size > declared) {
        await reader.cancel().catch(() => {});
        throw new ApiError(400, 'bad_request', 'The file is larger than it said it was.');
      }
      await fh.write(value);
      let off = 0;
      while (off < value.length) {
        const take = Math.min(BLOCK_SIZE - inBlock, value.length - off);
        hash.update(value.subarray(off, off + take));
        inBlock += take;
        off += take;
        if (inBlock === BLOCK_SIZE) {
          blocks.push(hash.digest('hex'));
          hash = createHash('sha256');
          inBlock = 0;
        }
      }
    }
    if (inBlock > 0) blocks.push(hash.digest('hex'));
    if (size !== declared) throw new ApiError(400, 'bad_request', 'The upload ended early. Try again.');

    const at = new Map<string, number>();
    blocks.forEach((sha, i) => {
      if (!at.has(sha)) at.set(sha, i);
    });
    const handle = fh;
    const source: BlockSource = async (sha) => {
      const i = at.get(sha);
      if (i === undefined) throw new ApiError(500, 'internal', 'A block is missing from the upload.');
      const start = i * BLOCK_SIZE;
      const len = Math.min(BLOCK_SIZE, size - start);
      const buf = new Uint8Array(len);
      const { bytesRead } = await handle.read(buf, 0, len, start);
      if (bytesRead !== len) throw new ApiError(500, 'internal', 'A block could not be read back.');
      return buf;
    };
    return { size, blocks, source, close };
  } catch (e) {
    await close();
    throw e;
  }
}

export interface ReceiveInput {
  /** The sender's relative path ("a.pdf", or "Trip/a.jpg" for a folder upload). */
  name: string;
  sender: string | null;
  declaredSize: number;
  body: ReadableStream<Uint8Array>;
}

/**
 * Receives one file through an upload link. The link root must still be a
 * folder; the file lands at <root>/<name> (its folders created as needed),
 * renamed "name (1).ext" on a clash.
 */
export async function receiveUpload(pl: PublicLink, input: ReceiveInput): Promise<{ name: string; size: number }> {
  const { link, ws } = pl;
  const segs = senderPath(input.name);
  const size = input.declaredSize;
  const limit = fileLimit(link);
  if (size > limit) throw new ApiError(413, 'payload_too_large', 'This file is larger than this link accepts.', { max: limit });

  const root = await statOrNull(ws, link.path);
  if (!root || root.type !== 'dir') throw new ApiError(404, 'not_found', 'Nothing is shared at this address.');
  // Fail fast, before any bytes move; the reservation under the lock is the real check.
  await assertQuota(ws.userId, logicalSize(size)).catch((e: unknown) => {
    throw senderError(e);
  });

  const claimed = await claim(link.id, size);
  if (claimed === 'max_files') throw new ApiError(409, 'upload_limit', 'This link has received all the files it accepts.');
  if (claimed === 'day') throw full();

  let landed = false;
  let spooled: Spooled | null = null;
  try {
    spooled = await spool(input.body, size);
    const sp = spooled;
    const dest = joinPath(link.path, segs.join('/'));
    // A folder upload names its folders, so undoing the action takes them away too.
    const dirs: string[] = [];
    for (let d = dirname(dest); d !== link.path && d !== '/'; d = dirname(d)) dirs.unshift(d);
    const who = input.sender ?? 'Someone';
    await using hold = new Hold(ws.userId, 'upload-link');
    await withPreparedAction(
      { ws, userId: link.userId },
      async () => {
        const r = await resolveUploadPlan(ws, {
          files: [{ path: dest, size: sp.size, blocks: sp.blocks, mtime: Date.now() }],
          dirs,
          conflict: 'keep-both',
        });
        await hold.reserve({ bytes: r.addedBytes });
        const final = r.plan.files[0]!.path;
        const into = dirname(final);
        return {
          spec: {
            kind: 'upload' as const,
            summary: `Upload link · ${who} sent ${basename(final)}${into === '/' ? '' : ` to ${into}`}`.slice(0, 500),
            paths: r.changes,
            meta: { uploadLinkId: link.id, sender: input.sender, renamed: r.renamed.length > 0 },
          },
          data: r,
        };
      },
      async (rec, r) => {
        await serverUpload(ws, r.plan.files, r.plan.dirs, sp.source, rec, { overwrite: false });
      },
    );
    landed = true;
    return { name: segs.join('/'), size };
  } catch (e) {
    throw senderError(e);
  } finally {
    await spooled?.close();
    if (!landed) await unclaim(link.id, size).catch(() => {});
  }
}

/** What a sender may learn from a failure: never a path in the drive, nor the owner's quota. */
function senderError(e: unknown): unknown {
  if (isStoreError(e, 'quota_exceeded')) return full();
  if (!(e instanceof ApiError)) return e;
  if (e.code === 'quota_exceeded' || e.code === 'storage_limit') return full();
  if (e.code === 'not_a_directory' || e.code === 'not_a_file' || e.code === 'conflict' || e.code === 'path_exists') {
    return new ApiError(409, 'conflict', "This file can't be added to the folder. Try a different name.");
  }
  if (e.code === 'path_not_found') return new ApiError(404, 'not_found', 'Nothing is shared at this address.');
  return e;
}

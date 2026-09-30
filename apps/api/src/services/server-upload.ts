// Uploads the server itself performs (restores, agent writes, accepted
// proposals): plan the files, send only the blocks the store lacks from a
// block source, commit. Every block is re-hashed before it is sent, so a
// source can never smuggle in bytes that do not match the planned hash.
import { BLOCK_SIZE, MAX_PLAN_BLOCKS, MAX_PLAN_FILES } from '@volumes/shared';
import { ApiError } from '../lib/http';
import { getStore } from '../storage';
import { isStoreError, type CommitResult } from '../storage/types';
import type { WorkspaceCtx } from '../types';
import { contentHashOf, type ActionRecorder } from './ledger';
import { sha256Hex } from './proven-blocks';
import { mapLimit, readStream } from './versioning-util';

export interface ServerFile {
  path: string;
  size: number;
  /** 1 MiB block sha256 list ([] for an empty file). */
  blocks: string[];
  mtime?: number;
  mode?: number;
}

/** The bytes of one block, by its sha256. */
export type BlockSource = (sha: string) => Promise<Uint8Array>;

function batches<F extends ServerFile>(files: F[]): F[][] {
  const out: F[][] = [];
  let cur: F[] = [];
  let blocks = 0;
  for (const f of files) {
    if (cur.length && (cur.length >= MAX_PLAN_FILES || blocks + f.blocks.length > MAX_PLAN_BLOCKS)) {
      out.push(cur);
      cur = [];
      blocks = 0;
    }
    cur.push(f);
    blocks += f.blocks.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Plans, sends only the blocks the store lacks (from `source`), commits; one
 * commit per batch of files (the first batch also creates `dirs`). Retries
 * once when the commit reports missing blocks. Releases the upload slot on
 * failure. Calls rec.commit for each commit.
 */
export async function serverUpload(
  ws: WorkspaceCtx,
  files: ServerFile[],
  dirs: string[],
  source: BlockSource,
  rec: ActionRecorder,
  opts: { overwrite?: boolean } = {},
): Promise<void> {
  const store = getStore();
  const send = async (uploadId: string, shas: string[]) => {
    await mapLimit([...new Set(shas)], 4, async (sha) => {
      const bytes = await source(sha);
      if (sha256Hex(bytes) !== sha) throw new ApiError(500, 'internal', 'A block did not match its hash.');
      await store.putBlock(ws.volumeId, uploadId, sha, bytes);
    });
  };

  const groups = batches(files);
  if (!groups.length && dirs.length) groups.push([]);
  for (let i = 0; i < groups.length; i++) {
    const batch = groups[i];
    const plan = await store.planUpload(ws.volumeId, {
      files: batch.map((f) => ({
        path: f.path,
        size: f.size,
        blocks: f.blocks,
        ...(f.mtime !== undefined ? { mtime: f.mtime } : {}),
        ...(f.mode !== undefined ? { mode: f.mode } : {}),
      })),
      dirs: i === 0 ? dirs : [],
      overwrite: opts.overwrite ?? true,
    });
    let result: CommitResult;
    try {
      if (plan.missing.length) await send(plan.uploadId, plan.missing);
      try {
        result = await store.commitUpload(ws.volumeId, plan.uploadId);
      } catch (e) {
        if (!isStoreError(e, 'bad_request') || !e.extra.missing?.length) throw e;
        await send(plan.uploadId, e.extra.missing);
        result = await store.commitUpload(ws.volumeId, plan.uploadId);
      }
    } catch (e) {
      store.releaseUpload(plan.uploadId);
      throw e;
    }
    await rec.commit(result);
  }
}

/**
 * Reads each block back from the drive as of commit `at` with a Range request
 * (restore's source). `sourcePath` is where the bytes live at `at` when that
 * differs from `path` (a file renamed since).
 */
export function blockSourceAt(ws: WorkspaceCtx, files: (ServerFile & { sourcePath?: string })[], at: string): BlockSource {
  const where = new Map<string, { path: string; start: number; end: number }>();
  for (const f of files) {
    f.blocks.forEach((sha, i) => {
      if (where.has(sha)) return;
      const start = i * BLOCK_SIZE;
      where.set(sha, { path: f.sourcePath ?? f.path, start, end: Math.min(start + BLOCK_SIZE, f.size) - 1 });
    });
  }
  return async (sha) => {
    const src = where.get(sha);
    if (!src) throw new ApiError(500, 'internal', 'Restore could not locate a block.');
    const r = await getStore().read(ws.volumeId, src.path, { at, range: `bytes=${src.start}-${src.end}` });
    return readStream(r.body);
  };
}

/** Blocks the server already holds in memory (agent writes, accepted proposals). */
export function blockSourceFromMemory(blocks: Map<string, Uint8Array>): BlockSource {
  return async (sha) => {
    const b = blocks.get(sha);
    if (!b) throw new ApiError(500, 'internal', 'A block is missing from the upload.');
    return b;
  };
}

/** Splits bytes into 1 MiB blocks: their hashes in order, the content hash, and each distinct chunk. */
export function hashBlocks(bytes: Uint8Array): { blocks: string[]; contentHash: string; chunks: Map<string, Uint8Array> } {
  const blocks: string[] = [];
  const chunks = new Map<string, Uint8Array>();
  for (let off = 0; off < bytes.length; off += BLOCK_SIZE) {
    const chunk = bytes.subarray(off, Math.min(off + BLOCK_SIZE, bytes.length));
    const sha = sha256Hex(chunk);
    blocks.push(sha);
    if (!chunks.has(sha)) chunks.set(sha, chunk);
  }
  return { blocks, contentHash: contentHashOf(blocks), chunks };
}

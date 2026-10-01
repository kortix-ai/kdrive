// Whether a commit holds an action's recorded changes. Used when an action's
// response was lost and the ledger has to decide, from storage alone, which
// commit (if any) is that action's. A commit is only attributed when storage
// shows every sampled change of the action in it: the right entries gone or
// present, written by that commit, and, where the ledger knows the exact block
// list, the same bytes. Size (or "some commit happened") is never proof.
import { createHash } from 'node:crypto';
import { BLOCK_SIZE } from '@volumes/shared';
import type { ActionPathRow } from '../db/schema';
import { getStore } from '../storage';
import type { Commit, FileStat } from '../storage/types';

/** Changes checked against a candidate commit (all of them when fewer). */
const SAMPLE = 20;

export function sample<T>(list: T[], n = SAMPLE): T[] {
  if (list.length <= n) return list;
  const step = list.length / n;
  return Array.from({ length: n }, (_, i) => list[Math.floor(i * step)]);
}

export const statAt = (volumeId: string, path: string, at: string): Promise<FileStat | null> =>
  getStore()
    .stat(volumeId, path, { at })
    .catch(() => null);

/**
 * Whether the file at `path` in commit `at` is exactly `blocks` (1 MiB sha256
 * block list) of `size` bytes. Reads block by block and stops at the first
 * block that differs; any read failure is "not proven".
 */
export async function blocksMatchAt(volumeId: string, path: string, at: string, blocks: string[], size: number): Promise<boolean> {
  if (blocks.length !== Math.ceil(size / BLOCK_SIZE)) return false;
  if (size === 0) return true;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    reader = (await getStore().read(volumeId, path, { at })).body.getReader();
    const buf = new Uint8Array(BLOCK_SIZE);
    let fill = 0;
    let idx = 0;
    let total = 0;
    const check = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex') === blocks[idx++];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > size) return false;
      let off = 0;
      while (off < value.length) {
        const n = Math.min(BLOCK_SIZE - fill, value.length - off);
        buf.set(value.subarray(off, off + n), fill);
        fill += n;
        off += n;
        if (fill === BLOCK_SIZE) {
          if (!check(buf)) return false;
          fill = 0;
        }
      }
    }
    if (fill > 0 && !check(buf.subarray(0, fill))) return false;
    return total === size && idx === blocks.length;
  } catch {
    return false;
  } finally {
    reader?.cancel().catch(() => {});
  }
}

/** Whether `c` wrote the entry `now` (its version is `c`'s; for a merge, it differs from the entry before). */
export function writtenByCommit(c: Commit, now: FileStat, before: FileStat | null): boolean {
  if (!now.version) return false;
  if (c.kind === 'merge') return !before || before.version !== now.version;
  return `vc_${now.version}` === c.id;
}

type Change = Pick<ActionPathRow, 'op' | 'path' | 'fromPath' | 'entryType' | 'size' | 'blockHashes'>;

/** One recorded change, checked against commit `c` (and its parent). */
async function holdsChange(volumeId: string, ch: Change, c: Commit & { parentId: string }): Promise<boolean> {
  const [now, before] = await Promise.all([statAt(volumeId, ch.path, c.id), statAt(volumeId, ch.path, c.parentId)]);
  const isDir = ch.entryType === 'dir';
  const typeOk = (s: FileStat) => (s.type === 'dir') === isDir;
  switch (ch.op) {
    case 'deleted':
      // Gone in c, there just before: c removed it.
      return !now && !!before;
    case 'moved': {
      if (!now || !typeOk(now)) return false;
      if (!ch.fromPath) return true;
      const [src, srcBefore] = await Promise.all([statAt(volumeId, ch.fromPath, c.id), statAt(volumeId, ch.fromPath, c.parentId)]);
      return !src && !!srcBefore;
    }
    case 'copied':
      if (!now || !typeOk(now)) return false;
      return isDir || ch.size === null || now.size === ch.size;
    case 'added':
    case 'changed':
    case 'restored': {
      if (!now || !typeOk(now)) return false;
      if (isDir) return ch.op === 'restored' || !before || before.type !== 'dir';
      if (ch.size !== null && now.size !== ch.size) return false;
      // A drive restore brings back old versions as they were; anything else is a write of c.
      if (ch.op !== 'restored' && !writtenByCommit(c, now, before)) return false;
      return ch.blockHashes ? blocksMatchAt(volumeId, ch.path, c.id, ch.blockHashes, now.size) : true;
    }
    default:
      return false;
  }
}

/**
 * Whether commit `c` holds the recorded changes of an action: every sampled
 * ledger row is reflected in `c` against its parent. An action with no
 * recorded changes, or a commit without a parent, proves nothing.
 */
export async function holdsChanges(volumeId: string, rows: Change[], c: Commit): Promise<boolean> {
  if (!c.parentId || !rows.length) return false;
  const withParent = c as Commit & { parentId: string };
  for (const ch of sample(rows)) {
    if (!(await holdsChange(volumeId, ch, withParent).catch(() => false))) return false;
  }
  return true;
}

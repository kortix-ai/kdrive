// How much a file mutation grows the volume's logicalBytes (what the quota
// counts): whole 4 KiB pages per file, 4 KiB per folder.
//
// Every operation that puts something at a path creates the folders missing
// above it (Platinum does so for a move, a copy, an upload and a restore), and
// each of those folders is charged. The estimate is made against one pinned
// commit, the head the operation runs on. A request of several copies / moves
// is measured as the sequence it runs: an item sees what the items before it
// created, moved away or overwrote (a copy of a file an earlier item just
// replaced copies the new, bigger content).
//
// Estimates may be too big, never too small: what an item frees is credited
// only when it is known exactly.
import { basename, dirname, isWithin } from '@volumes/shared';
import { isStoreError, type FileEntry } from '../storage/types';
import type { WorkspaceCtx } from '../types';
import { listDir, listTree, statOrNull } from './tree';
import { mapLimit } from './versioning-util';

/** What one folder takes. */
export const DIR_BYTES = 4096;

/** Platinum accounts a file as whole 4 KiB pages. */
export const logicalSize = (size: number) => Math.ceil(size / 4096) * 4096;

type Ws = Pick<WorkspaceCtx, 'volumeId'>;
type Node = Pick<FileEntry, 'type' | 'size'>;

interface Transfer {
  kind: 'move' | 'copy';
  from: string;
  to: string;
  /** Upper bound of what this item put under any folder above `to`: the content it brought and the folders it made. */
  gross: number;
}

/** The ancestors of `p`, shallowest first, the root excluded: /a/b/c → [/a, /a/b]. */
function ancestors(p: string): string[] {
  const out: string[] = [];
  for (let up = dirname(p); up !== '/'; up = dirname(up)) out.push(up);
  return out.reverse();
}

/**
 * The tree at commit `at` plus the operations recorded so far. Folders made by
 * `createDirs` and transfers recorded by `transfer` are not mixed in one
 * projection (a folder made by `createDirs` is not followed through a move).
 */
export class Projection {
  private readonly stats = new Map<string, Promise<Node | null>>();
  private readonly footprints = new Map<string, Promise<number>>();
  private readonly made = new Set<string>();
  private readonly ops: Transfer[] = [];

  constructor(
    private readonly ws: Ws,
    readonly at: string,
  ) {}

  /** The entry at `p` in the pinned commit (cached). A path under a file does not exist. */
  stat(p: string): Promise<Node | null> {
    let s = this.stats.get(p);
    if (!s) {
      s = statOrNull(this.ws, p, this.at).catch((e) => {
        if (isStoreError(e, 'not_a_directory')) return null;
        throw e;
      });
      this.stats.set(p, s);
    }
    return s;
  }

  /** logicalBytes under `p` in the pinned commit (itself included; 0 when missing). */
  private headFootprint(p: string): Promise<number> {
    let f = this.footprints.get(p);
    if (!f) {
      f = (async () => {
        const st = await this.stat(p);
        if (!st) return 0;
        if (st.type !== 'dir') return logicalSize(st.size);
        const { entries } = await listTree(this.ws, p, this.at);
        let n = DIR_BYTES;
        for (const e of entries) if (e.path !== p) n += e.type === 'dir' ? DIR_BYTES : logicalSize(e.size);
        return n;
      })();
      this.footprints.set(p, f);
    }
    return f;
  }

  /** What is at `p` after the first `k` transfers: the pinned entry it comes from, a folder they made, or null. */
  private async nodeAfter(p: string, k: number): Promise<Node | null> {
    for (let i = k - 1; i >= 0; i--) {
      const op = this.ops[i];
      if (isWithin(op.to, p)) {
        p = op.from + p.slice(op.to.length); // what landed there came from the source as it was then
        continue;
      }
      if (op.kind === 'move' && isWithin(op.from, p)) return null; // moved away
      if (isWithin(p, op.to)) return { type: 'dir', size: 0 }; // a folder above `to`: there (or made) since
    }
    if (this.made.has(p)) return { type: 'dir', size: 0 };
    return this.stat(p);
  }

  /** Upper bound of logicalBytes under `p` after the first `k` transfers. */
  private async footprintAfter(p: string, k: number): Promise<number> {
    let extra = 0;
    for (let i = k - 1; i >= 0; i--) {
      const op = this.ops[i];
      if (isWithin(op.to, p)) {
        p = op.from + p.slice(op.to.length);
        continue;
      }
      if (op.kind === 'move' && isWithin(op.from, p)) return extra; // only what arrived later is there
      if (isWithin(p, op.to)) extra += op.gross; // something landed inside `p`
    }
    return extra + (await this.headFootprint(p));
  }

  /** logicalBytes under `p` after the first `k` transfers when known exactly, else 0 (a credit that is never too big). */
  private async exactFootprintAfter(p: string, k: number): Promise<number> {
    for (let i = k - 1; i >= 0; i--) {
      const op = this.ops[i];
      if (isWithin(op.to, p)) {
        p = op.from + p.slice(op.to.length);
        continue;
      }
      if (isWithin(p, op.to)) return 0;
      if (op.kind === 'move' && (isWithin(op.from, p) || isWithin(p, op.from))) return 0;
    }
    return this.headFootprint(p);
  }

  /** The folders of `chain` (a path and its ancestors, shallowest first) missing after the first `k` transfers. */
  private async missingOf(chain: string[], k: number): Promise<string[]> {
    if (!chain.length) return [];
    const exists = async (q: string) => (await this.nodeAfter(q, k)) !== null;
    // Usually the deepest one is there already: one lookup.
    if (await exists(chain[chain.length - 1])) return [];
    // A path exists only below existing folders, so existence along the chain is
    // true then false: binary search the first missing one.
    let lo = 0;
    let hi = chain.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (await exists(chain[mid])) lo = mid + 1;
      else hi = mid;
    }
    return chain.slice(lo);
  }

  /**
   * The folders that putting an entry at `path` creates, shallowest first: its
   * missing ancestors, and `path` itself when `self` (a folder is created
   * there). They exist from then on, so a later call never counts them again.
   */
  async createDirs(path: string, self = false): Promise<string[]> {
    const chain = ancestors(path);
    if (self && path !== '/') chain.push(path);
    const out = await this.missingOf(chain, this.ops.length);
    for (const d of out) this.made.add(d);
    return out;
  }

  /**
   * Records one copy / move, run after the ones recorded before, and returns
   * how much it grows logicalBytes: what it adds (a copy's content, every
   * folder it creates above `to`) minus what it replaces at `to` (only when
   * that is known exactly). Negative when it frees more than it adds.
   */
  async transfer(kind: 'move' | 'copy', from: string, to: string): Promise<number> {
    const k = this.ops.length;
    const dirs = (await this.missingOf(ancestors(to), k)).length * DIR_BYTES;
    const replaced = (await this.nodeAfter(to, k)) ? await this.exactFootprintAfter(to, k) : 0;
    const content = await this.footprintAfter(from, k);
    this.ops.push({ kind, from, to, gross: content + dirs });
    return (kind === 'copy' ? content : 0) + dirs - replaced;
  }
}

/**
 * Bytes to reserve for a sequence of steps with these growths: the highest the
 * running total reaches (a request that fails half way keeps what landed).
 */
export function peakGrowth(steps: number[]): number {
  let total = 0;
  let peak = 0;
  for (const s of steps) {
    total += s;
    peak = Math.max(peak, total);
  }
  return peak;
}

/**
 * Growth of logicalBytes when an upload plan's files and folders land on the
 * tree at `at`: each file's pages minus the file it replaces there, plus every
 * folder it creates (the planned folders and all missing parents). A file
 * planned where a folder now is counts in full.
 *
 * `known`: children listings already read at `at` (folder → entries by name;
 * an empty map for a missing folder), so they are not read again.
 */
export async function planGrowth(
  ws: Ws,
  at: string,
  files: { path: string; size: number }[],
  dirs: string[],
  known?: Map<string, Map<string, FileEntry>>,
): Promise<number> {
  const proj = new Projection(ws, at);
  const parents = [...new Set(files.map((f) => dirname(f.path)))];
  const listed = new Map<string, Map<string, FileEntry>>(known ?? []);
  const toList = parents.filter((p) => !listed.has(p));
  const got = await mapLimit(toList, 8, async (p) => {
    try {
      return new Map((await listDir(ws, p, at)).entries.map((e) => [e.name || basename(e.path), e]));
    } catch (e) {
      if (isStoreError(e, 'path_not_found') || isStoreError(e, 'not_a_directory')) return new Map<string, FileEntry>();
      throw e;
    }
  });
  toList.forEach((p, i) => listed.set(p, got[i]));

  let bytes = 0;
  for (const f of files) {
    const cur = listed.get(dirname(f.path))?.get(basename(f.path));
    bytes += logicalSize(f.size) - (cur && cur.type !== 'dir' ? logicalSize(cur.size) : 0);
  }
  // Every folder once, shallowest first, so shared parents are looked up once.
  const wanted = [...new Set([...parents.filter((p) => p !== '/'), ...dirs])].sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  for (const d of wanted) bytes += (await proj.createDirs(d, true)).length * DIR_BYTES;
  return bytes;
}

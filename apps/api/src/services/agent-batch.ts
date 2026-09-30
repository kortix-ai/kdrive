// The batch engine behind write_changes (direct mode) and proposal Accept:
// one ordered batch of ops = ONE ledger action, under the workspace lock, with
// quota reservation, a guard against stale reads and link bookkeeping.
//
// The agent never names a block: the server hashes every byte it holds into
// 1 MiB blocks, so proof of possession holds by construction. Every op is
// checked against a simulation of the batch over the head (each op sees the
// ones before it) before anything is written.
import { basename, dirname, isWithin, type ActionSummary } from '@volumes/shared';
import { ApiError } from '../lib/http';
import { getStore } from '../storage';
import { isStoreError, type FileStat } from '../storage/types';
import type { WorkspaceCtx } from '../types';
import { footprint, knownBlocks } from './files-ops';
import { DIR_BYTES, logicalSize } from './footprint';
import { withPreparedAction, type ActionCtx, type ActionRecorder, type PathChange } from './ledger';
import { detachLiveLinks, moveLiveLinks } from './links';
import { Hold } from './reservations';
import { changedUnder } from './restore';
import { blockSourceFromMemory, hashBlocks, serverUpload, type ServerFile } from './server-upload';
import { statOrNull } from './tree';
import { mapLimit, readStream } from './versioning-util';

export type BatchOp =
  | { op: 'write'; path: string; bytes: Uint8Array }
  | { op: 'mkdir'; path: string }
  | { op: 'move'; from: string; to: string }
  | { op: 'copy'; from: string; to: string }
  | { op: 'delete'; path: string };

export interface BatchInput {
  /** Normalised paths, validated shapes. */
  ops: BatchOp[];
  /** The guard base (last_seen_commit_id, or the proposal's base). */
  baseCommitId: string;
  /** Accept "anyway": skip the base check and the guard (still validates against head). */
  force?: boolean;
  /**
   * Replaces the default guard (the base must exist; paths the batch touches
   * must not have changed between it and the head). Runs under the workspace
   * lock with the head the batch is checked against.
   */
  guard?: (head: string) => Promise<Conflict[]>;
  /** The refusal text for these conflicts (default: addressed to the agent). */
  conflictMessage?: (conflicts: Conflict[]) => string;
  kind: 'agent.batch' | 'proposal.accept';
  /** Timeline text. */
  summary: string;
  meta: Record<string, unknown>;
}

export interface OpResult {
  index: number;
  op: BatchOp['op'];
  path: string;
  fromPath: string | null;
  result: 'created' | 'replaced' | 'unchanged' | 'moved' | 'copied' | 'deleted' | 'folder';
  size: number | null;
  entryType: 'file' | 'dir';
}

export type GuardOp = { op: BatchOp['op']; path: string; from?: string };

export type Conflict = {
  path: string;
  reason: 'changed' | 'created' | 'deleted' | 'type';
  current: { type: 'file' | 'dir'; size: number; version: string | null } | null;
};

/** The path an op puts something at (write / mkdir / move to / copy to) or removes (delete). */
export const opPath = (o: BatchOp): string => (o.op === 'move' || o.op === 'copy' ? o.to : o.path);
export const opFrom = (o: BatchOp): string | null => (o.op === 'move' || o.op === 'copy' ? o.from : null);
export const toGuardOp = (o: BatchOp): GuardOp => (o.op === 'move' || o.op === 'copy' ? { op: o.op, path: o.to, from: o.from } : { op: o.op, path: o.path });

// ── partial failures ────────────────────────────────────────────────────────

const partial = new WeakMap<object, string>();

/** The action id when `e` was thrown after part of a batch had landed (else null). */
export function partialActionOf(e: unknown): string | null {
  return e && typeof e === 'object' ? (partial.get(e) ?? null) : null;
}

// ── stats ───────────────────────────────────────────────────────────────────

/** stat, or null when absent (a path under a file is absent too). */
export async function statSafe(ws: Pick<WorkspaceCtx, 'volumeId'>, path: string, at: string): Promise<FileStat | null> {
  try {
    return await statOrNull(ws, path, at);
  } catch (e) {
    if (isStoreError(e, 'not_a_directory')) return null;
    throw e;
  }
}

const kindOf = (st: Pick<FileStat, 'type'>): 'file' | 'dir' => (st.type === 'dir' ? 'dir' : 'file');
export const currentOf = (st: FileStat | null): Conflict['current'] => (st ? { type: kindOf(st), size: st.size, version: st.version } : null);

// ── guard ───────────────────────────────────────────────────────────────────

/**
 * Paths the batch touches that changed between `base` and `head`: everything
 * under a deleted / moved / copied source or a written file (recursive), and
 * the existence and type of each destination. Paths the batch does not touch
 * never conflict.
 */
export async function guardConflicts(ws: WorkspaceCtx, base: string, head: string, ops: GuardOp[]): Promise<Conflict[]> {
  if (base === head) return [];
  const deep = new Set<string>();
  const shallow = new Set<string>();
  for (const o of ops) {
    if (o.op === 'delete' || o.op === 'write') deep.add(o.path);
    else if (o.op === 'mkdir') shallow.add(o.path);
    else {
      if (o.from) deep.add(o.from);
      shallow.add(o.path);
    }
  }
  const changed = new Set<string>();
  const deepLists = await mapLimit([...deep], 8, (p) => changedUnder(ws, p, base, head).catch((e) => {
    if (isStoreError(e, 'not_a_directory')) return [p];
    throw e;
  }));
  for (const l of deepLists) for (const p of l) changed.add(p);
  const nodes = await mapLimit([...shallow].filter((p) => !changed.has(p)), 8, async (p) => {
    const [a, b] = await Promise.all([statSafe(ws, p, base), statSafe(ws, p, head)]);
    return !a !== !b || (a && b && kindOf(a) !== kindOf(b)) ? p : null;
  });
  for (const p of nodes) if (p) changed.add(p);
  const list = [...changed].sort();
  return mapLimit(list, 8, async (path): Promise<Conflict> => {
    const [a, b] = await Promise.all([statSafe(ws, path, base), statSafe(ws, path, head)]);
    const reason: Conflict['reason'] = !a ? 'created' : !b ? 'deleted' : kindOf(a) !== kindOf(b) ? 'type' : 'changed';
    return { path, reason, current: currentOf(b) };
  });
}

/**
 * guardConflicts over several stretches of history (the parts of base..head
 * that someone else wrote): a path conflicts when any stretch changed it. The
 * reason is the first stretch's; `current` is what the head holds.
 */
export async function guardRuns(ws: WorkspaceCtx, runs: [string, string][], head: string, ops: GuardOp[]): Promise<Conflict[]> {
  const byPath = new Map<string, Conflict>();
  for (const [a, b] of runs) {
    for (const c of await guardConflicts(ws, a, b, ops)) if (!byPath.has(c.path)) byPath.set(c.path, c);
  }
  const list = [...byPath.values()].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  return mapLimit(list, 8, async (c) => ({ ...c, current: currentOf(await statSafe(ws, c.path, head)) }));
}

/** The 409 `stale_base` refusal. */
export function staleBase(head: string, conflicts: Conflict[], message?: string): ApiError {
  const n = conflicts.length;
  const text =
    message ?? (n === 1 ? '1 of the files you are changing was changed since you read it.' : `${n} of the files you are changing were changed since you read them.`);
  return new ApiError(409, 'stale_base', text, { current_commit_id: head, conflicts: conflicts.slice(0, 100) });
}

/**
 * `base` must be a commit id of this workspace; returns it. A name that
 * resolves to a commit ("head", a checkpoint tag) is refused: it would follow
 * the drive and turn the guard off.
 */
export async function assertBase(ws: WorkspaceCtx, base: string, head: string): Promise<string> {
  let id: string;
  try {
    id = (await getStore().getCommit(ws.volumeId, base)).id;
  } catch (e) {
    if (isStoreError(e) && e.status < 500) {
      throw staleBase(head, [], 'last_seen_commit_id is not a version of this workspace. Call open_workspace.');
    }
    throw e;
  }
  if (id !== base) {
    throw new ApiError(400, 'bad_request', 'last_seen_commit_id must be the commit id you read (vc_…), not a name such as "head".', { current_commit_id: head });
  }
  return id;
}

// ── simulation ──────────────────────────────────────────────────────────────

interface SimNode {
  type: 'file' | 'dir';
  size: number;
  /** The head entry this node is (unchanged content), when it comes from the drive. */
  base: FileStat | null;
  /** Block list of a file written earlier in the batch. */
  blocks?: string[];
}

/**
 * One op as the simulation remembers it. `gross` is an upper bound of what the
 * op put under every folder above its path: the content it wrote, copied or
 * moved there and the folders it made.
 */
type SimOp =
  | { op: 'write'; path: string; size: number; blocks?: string[]; gross: number }
  | { op: 'mkdir'; path: string; gross: number }
  | { op: 'delete'; path: string }
  | { op: 'move' | 'copy'; from: string; to: string; gross: number };

const DIR_NODE: SimNode = { type: 'dir', size: 0, base: null };

/** The tree at `head` plus the ops recorded so far (each op sees the ones before it). */
class BatchSim {
  private readonly stats = new Map<string, Promise<FileStat | null>>();
  private readonly footprints = new Map<string, Promise<{ size: number; logical: number }>>();
  readonly ops: SimOp[] = [];

  constructor(
    private readonly ws: WorkspaceCtx,
    readonly head: string,
  ) {}

  baseStat(p: string): Promise<FileStat | null> {
    let s = this.stats.get(p);
    if (!s) {
      s = statSafe(this.ws, p, this.head);
      this.stats.set(p, s);
    }
    return s;
  }

  /** Bytes and logicalBytes of the entry at `p` in the head (cached; 0 when missing). */
  headFootprint(p: string): Promise<{ size: number; logical: number }> {
    let f = this.footprints.get(p);
    if (!f) {
      f = this.baseStat(p).then((st) => (st ? footprint(this.ws, st) : { size: 0, logical: 0 }));
      this.footprints.set(p, f);
    }
    return f;
  }

  /**
   * Upper bound of logicalBytes under the folder at `p` now: what the head
   * holds at the path it comes from, plus everything an op of the batch put
   * inside it since (followed through copies and moves). What an op removed is
   * never credited. A folder the batch wrote into is still the head folder
   * underneath, so its copy is never priced as an empty one.
   */
  async bound(p: string): Promise<number> {
    let path = p;
    let extra = 0;
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const o = this.ops[i];
      if (o.op === 'delete') {
        if (isWithin(o.path, path)) return extra; // only what arrived later is there
      } else if (o.op === 'write' || o.op === 'mkdir') {
        if (isWithin(path, o.path)) extra += o.gross;
      } else {
        if (isWithin(o.to, path)) {
          path = o.from + path.slice(o.to.length); // what landed there came from the source as it was then
          continue;
        }
        if (o.op === 'move' && isWithin(o.from, path)) return extra;
        if (isWithin(path, o.to)) extra += o.gross;
      }
    }
    return extra + (await this.headFootprint(path)).logical;
  }

  /** What is at `p` now. */
  async node(p: string): Promise<SimNode | null> {
    let path = p;
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const o = this.ops[i];
      if (o.op === 'write') {
        if (path === o.path) return { type: 'file', size: o.size, base: null, blocks: o.blocks };
        if (isWithin(path, o.path)) return DIR_NODE;
      } else if (o.op === 'mkdir') {
        if (isWithin(path, o.path)) return DIR_NODE;
      } else if (o.op === 'delete') {
        if (isWithin(o.path, path)) return null;
      } else {
        if (isWithin(o.to, path)) {
          path = o.from + path.slice(o.to.length); // what landed there came from the source as it was then
          continue;
        }
        if (o.op === 'move' && isWithin(o.from, path)) return null;
        if (isWithin(path, o.to)) return DIR_NODE;
      }
    }
    if (path === '/') return DIR_NODE;
    const st = await this.baseStat(path);
    return st ? { type: kindOf(st), size: st.size, base: st } : null;
  }

  /**
   * The folders putting an entry at `path` creates (its missing ancestors,
   * shallowest first; the ledger records them so an undo removes them too).
   * An ancestor that is a file → 409 `not_a_directory`.
   */
  async missingParents(path: string, index: number): Promise<string[]> {
    const missing: string[] = [];
    for (let up = dirname(path); up !== '/'; up = dirname(up)) {
      const n = await this.node(up);
      if (!n) {
        missing.unshift(up);
        continue;
      }
      if (n.type !== 'dir') {
        throw new ApiError(409, 'not_a_directory', `"${basename(up)}" is a file, so it cannot hold other items.`, { path: up, index });
      }
      break;
    }
    return missing;
  }
}

/** One op as planned: what it does to storage and what the agent is told. */
export interface PlannedStep {
  index: number;
  op: BatchOp['op'];
  path: string;
  fromPath: string | null;
  entryType: 'file' | 'dir';
  result: OpResult['result'];
  size: number | null;
  /** Nothing to send to storage (identical write, existing folder). */
  skip: boolean;
  blocks?: string[];
}

export interface Simulation {
  growth: number;
  rows: PathChange[];
  steps: PlannedStep[];
}

type Hashed = Map<number, { blocks: string[]; contentHash: string }>;

function sameList(a: string[] | undefined, b: string[] | undefined): boolean {
  return !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Whether `blocks` is exactly what the file node holds now. */
async function holdsBlocks(ws: WorkspaceCtx, n: SimNode, blocks: string[], size: number): Promise<boolean> {
  if (n.type !== 'file' || n.size !== size) return false;
  if (n.blocks) return sameList(n.blocks, blocks);
  if (!n.base) return false;
  const known = await knownBlocks(ws, n.base);
  if (known) return sameList(known, blocks);
  const r = await getStore().read(ws.volumeId, n.base.path, { at: n.base.commitId || undefined });
  return sameList(hashBlocks(await readStream(r.body)).blocks, blocks);
}

const fail = (status: number, code: 'path_not_found' | 'path_exists' | 'not_a_file' | 'not_a_directory' | 'bad_request' | 'invalid_path', message: string, details: Record<string, unknown>) =>
  new ApiError(status, code, message, details);

/**
 * Checks every op in order against the tree at `head` and plans it: ledger
 * rows, storage steps and the quota growth (an upper bound: what an op frees
 * is never credited, except a replaced file's pages). Throws the first
 * refusal with `details.index`.
 */
export async function simulate(ws: WorkspaceCtx, head: string, ops: BatchOp[], hashed?: Hashed): Promise<Simulation> {
  const sim = new BatchSim(ws, head);
  const rows: PathChange[] = [];
  const steps: PlannedStep[] = [];
  let growth = 0;
  let peak = 0;
  const grow = (n: number) => {
    growth += n;
    peak = Math.max(peak, growth);
  };
  const now = Date.now();

  for (let index = 0; index < ops.length; index++) {
    const o = ops[index];
    const at = { index };
    if (o.op === 'write') {
      const path = o.path;
      if (path === '/') throw fail(400, 'invalid_path', 'A file cannot be written at the root folder.', { path, ...at });
      const n = await sim.node(path);
      if (n?.type === 'dir') throw fail(409, 'not_a_file', `"${basename(path)}" is a folder, not a file.`, { path, ...at });
      const made = await sim.missingParents(path, index);
      const size = o.bytes.length;
      const blocks = hashed?.get(index)?.blocks;
      const unchanged = !!n && !!blocks && (await holdsBlocks(ws, n, blocks, size));
      const add = unchanged ? 0 : logicalSize(size) + DIR_BYTES * made.length;
      if (!unchanged) {
        for (const d of made) rows.push({ op: 'added', path: d, entryType: 'dir' });
        grow(add - (n ? logicalSize(n.size) : 0));
        rows.push({ op: n ? 'changed' : 'added', path, entryType: 'file', size, prevSize: n?.size, blockHashes: blocks, mtime: now });
      }
      steps.push({ index, op: 'write', path, fromPath: null, entryType: 'file', result: unchanged ? 'unchanged' : n ? 'replaced' : 'created', size, skip: unchanged, blocks });
      sim.ops.push({ op: 'write', path, size, blocks, gross: add });
    } else if (o.op === 'mkdir') {
      const path = o.path;
      if (path === '/') throw fail(400, 'invalid_path', 'The root folder already exists.', { path, ...at });
      const n = await sim.node(path);
      if (n && n.type !== 'dir') throw fail(409, 'not_a_directory', `"${basename(path)}" is a file, not a folder.`, { path, ...at });
      const made = n ? [] : await sim.missingParents(path, index);
      const add = n ? 0 : DIR_BYTES * (made.length + 1);
      if (!n) {
        grow(add);
        for (const d of made) rows.push({ op: 'added', path: d, entryType: 'dir' });
        rows.push({ op: 'added', path, entryType: 'dir' });
      }
      steps.push({ index, op: 'mkdir', path, fromPath: null, entryType: 'dir', result: 'folder', size: null, skip: !!n });
      sim.ops.push({ op: 'mkdir', path, gross: add });
    } else if (o.op === 'move' || o.op === 'copy') {
      const { from, to } = o;
      const verb = o.op === 'move' ? 'moved' : 'copied';
      if (from === '/') throw fail(400, 'bad_request', `The root folder cannot be ${verb}.`, { path: from, ...at });
      if (to === '/') throw fail(400, 'invalid_path', 'The destination must be a file or folder path, not the root.', { path: to, ...at });
      const src = await sim.node(from);
      if (!src) throw fail(404, 'path_not_found', `"${basename(from)}" does not exist.`, { path: from, ...at });
      if (src.type === 'dir' && isWithin(from, to)) {
        throw fail(400, 'bad_request', `A folder cannot be ${verb} into itself.`, { path: to, ...at });
      }
      if (await sim.node(to)) throw fail(409, 'path_exists', `"${basename(to)}" already exists.`, { paths: [to], path: to, ...at });
      const made = await sim.missingParents(to, index);
      let size = src.size;
      let logical = logicalSize(src.size);
      if (src.type === 'dir') {
        // The head folder underneath plus whatever the batch put inside it: a
        // folder copy is charged for everything it duplicates.
        size = src.base ? (await sim.headFootprint(src.base.path)).size : 0;
        logical = Math.max(DIR_BYTES, await sim.bound(from));
      }
      const blocks = src.type === 'file' ? (src.blocks ?? (src.base ? await knownBlocks(ws, src.base) : undefined)) : undefined;
      const dirs = DIR_BYTES * made.length;
      grow((o.op === 'copy' ? logical : 0) + dirs);
      for (const d of made) rows.push({ op: 'added', path: d, entryType: 'dir' });
      rows.push({ op: verb, path: to, fromPath: from, entryType: src.type, size, blockHashes: blocks, mtime: src.base?.mtime });
      steps.push({ index, op: o.op, path: to, fromPath: from, entryType: src.type, result: verb, size: src.type === 'file' ? src.size : null, skip: false, blocks });
      sim.ops.push({ op: o.op, from, to, gross: logical + dirs });
    } else {
      const path = o.path;
      if (path === '/') throw fail(400, 'bad_request', 'The root folder cannot be deleted.', { path, ...at });
      const n = await sim.node(path);
      if (!n) throw fail(404, 'path_not_found', `"${basename(path)}" does not exist.`, { path, ...at });
      const size = n.type === 'dir' ? (n.base ? (await footprint(ws, n.base)).size : 0) : n.size;
      const blocks = n.type === 'file' ? (n.blocks ?? (n.base ? await knownBlocks(ws, n.base) : undefined)) : undefined;
      rows.push({ op: 'deleted', path, entryType: n.type, size, blockHashes: blocks, mtime: n.base?.mtime });
      steps.push({ index, op: 'delete', path, fromPath: null, entryType: n.type, result: 'deleted', size: n.type === 'file' ? n.size : null, skip: false });
      sim.ops.push({ op: 'delete', path });
    }
  }
  return { growth: peak, rows, steps };
}

/** The read-only checks of a batch against `head` (no lock, no quota reservation); returns the growth in bytes. */
export async function validateBatch(ws: WorkspaceCtx, head: string, ops: BatchOp[]): Promise<{ growth: number }> {
  const s = await simulate(ws, head, ops);
  return { growth: s.growth };
}

// ── apply ───────────────────────────────────────────────────────────────────

/** Hashes every write into 1 MiB blocks (outside the lock). */
export function hashWrites(ops: BatchOp[]): { hashed: Hashed; blockBytes: Map<string, Uint8Array> } {
  const hashed: Hashed = new Map();
  const blockBytes = new Map<string, Uint8Array>();
  ops.forEach((o, i) => {
    if (o.op !== 'write') return;
    const h = hashBlocks(o.bytes);
    hashed.set(i, { blocks: h.blocks, contentHash: h.contentHash });
    for (const [sha, chunk] of h.chunks) if (!blockBytes.has(sha)) blockBytes.set(sha, chunk);
  });
  return { hashed, blockBytes };
}

/** Runs the planned steps in order: consecutive writes / new folders go up as one server upload. */
async function runSteps(ws: WorkspaceCtx, steps: PlannedStep[], blockBytes: Map<string, Uint8Array>, rec: ActionRecorder): Promise<void> {
  const store = getStore();
  const source = blockSourceFromMemory(blockBytes);
  let files: ServerFile[] = [];
  let dirs: string[] = [];
  let seen = new Set<string>();
  const flush = async () => {
    if (files.length || dirs.length) await serverUpload(ws, files, dirs, source, rec, { overwrite: true });
    files = [];
    dirs = [];
    seen = new Set();
  };
  for (const s of steps) {
    if (s.skip) continue;
    if (s.op === 'write' || s.op === 'mkdir') {
      if (seen.has(s.path)) await flush(); // one plan never names a path twice
      seen.add(s.path);
      if (s.op === 'write') files.push({ path: s.path, size: s.size ?? 0, blocks: s.blocks ?? [], mtime: Date.now() });
      else dirs.push(s.path);
      continue;
    }
    await flush();
    if (s.op === 'move') {
      await rec.commit(await store.move(ws.volumeId, s.fromPath!, s.path, { overwrite: false }));
      await moveLiveLinks(ws.id, s.fromPath!, s.path);
    } else if (s.op === 'copy') {
      await rec.commit(await store.copy(ws.volumeId, s.fromPath!, s.path, { recursive: s.entryType === 'dir', overwrite: false }));
    } else {
      await rec.commit(await store.remove(ws.volumeId, s.path, { recursive: true }));
      // Whatever is created at this path later is not what was shared.
      await detachLiveLinks(ws.id, s.path, rec.actionId);
    }
  }
  await flush();
}

/**
 * Applies one batch as ONE ledger action: guard against `baseCommitId`
 * (unless `force`), simulate against the head, reserve the quota growth, then
 * run the ops in order. A failure after the first commit leaves the action
 * committed with meta.partial; `partialActionOf(error)` names it.
 */
export async function applyAgentBatch(ctx: ActionCtx, input: BatchInput): Promise<{ action: ActionSummary; results: OpResult[] }> {
  if (!input.ops.length) throw new ApiError(400, 'bad_request', 'Nothing to change.');
  const { hashed, blockBytes } = hashWrites(input.ops);
  const landed = { any: false, actionId: '' };
  await using hold = new Hold(ctx.userId, input.kind);
  try {
    const { data, action } = await withPreparedAction(
      ctx,
      async () => {
        const head = (await getStore().getVolume(ctx.ws.volumeId)).headCommitId;
        if (!input.force) {
          const conflicts = input.guard
            ? await input.guard(head)
            : await guardConflicts(ctx.ws, await assertBase(ctx.ws, input.baseCommitId, head), head, input.ops.map(toGuardOp));
          if (conflicts.length) throw staleBase(head, conflicts, input.conflictMessage?.(conflicts));
        }
        const sim = await simulate(ctx.ws, head, input.ops, hashed);
        await hold.reserve({ bytes: sim.growth });
        return { spec: { kind: input.kind, summary: input.summary.slice(0, 500), paths: sim.rows, meta: input.meta }, data: sim };
      },
      async (rec, sim) => {
        landed.actionId = rec.actionId;
        const tracked: ActionRecorder = {
          actionId: rec.actionId,
          baseCommitId: rec.baseCommitId,
          addPaths: (p) => rec.addPaths(p),
          commit: async (r) => {
            await rec.commit(r);
            if (r.outcome !== 'noop' && r.outcome !== 'queued') landed.any = true;
          },
        };
        await runSteps(ctx.ws, sim.steps, blockBytes, tracked);
      },
    );
    const results: OpResult[] = data.steps.map((s) => ({ index: s.index, op: s.op, path: s.path, fromPath: s.fromPath, result: s.result, size: s.size, entryType: s.entryType }));
    return { action, results };
  } catch (e) {
    if (landed.any && e && typeof e === 'object') partial.set(e, landed.actionId);
    throw e;
  }
}

// ── timeline text ───────────────────────────────────────────────────────────

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const where = (dir: string) => (dir === '/' ? 'the top folder' : dir);

function phrase(kind: BatchOp['op'], ops: BatchOp[]): string {
  const one = ops.length === 1 ? ops[0] : null;
  const dirs = new Set(ops.map((o) => dirname(opPath(o))));
  const into = dirs.size === 1 ? ` to ${where([...dirs][0])}` : '';
  switch (kind) {
    case 'write':
      return one ? `wrote ${basename(opPath(one))}` : `wrote ${count(ops.length, 'file')}${into}`;
    case 'mkdir':
      return one ? `created folder ${basename(opPath(one))}` : `created ${count(ops.length, 'folder')}`;
    case 'move':
      return one && one.op === 'move' ? `moved ${basename(one.from)}${into}` : `moved ${count(ops.length, 'item')}`;
    case 'copy':
      return one && one.op === 'copy' ? `copied ${basename(one.from)}${into}` : `copied ${count(ops.length, 'item')}`;
    case 'delete':
      return one ? `deleted ${basename(opPath(one))}` : `deleted ${count(ops.length, 'item')}`;
  }
}

/** Timeline text for a batch: the agent's message (≤ 120 chars), else a generated summary. */
export function agentBatchSummary(ops: BatchOp[], message: string): string {
  const m = message.replace(/\s+/g, ' ').trim();
  if (m) return m.length > 120 ? `${m.slice(0, 119)}…` : m;
  const order: BatchOp['op'][] = ['write', 'mkdir', 'move', 'copy', 'delete'];
  const groups = order.map((k) => [k, ops.filter((o) => o.op === k)] as const).filter(([, l]) => l.length);
  let text: string;
  if (!groups.length) text = 'Changed nothing';
  else if (groups.length === 1) text = phrase(groups[0][0], groups[0][1]);
  else if (groups.length === 2) text = `${phrase(groups[0][0], groups[0][1])} and ${phrase(groups[1][0], groups[1][1])}`;
  else text = `changed ${count(ops.length, 'item')}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

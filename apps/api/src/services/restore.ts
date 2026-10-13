// Restore files, folders or the whole drive to an earlier version, and undo.
// Owner: API-versioning. See architecture §9.2.
//
// File / folder restore never copies bytes it does not have to: the old
// version's block list is re-planned through the upload protocol, and
// Platinum already holds those blocks, so `missing` is empty and nothing is
// sent. The block list comes from the ledger (the row written by the commit
// that produced the entry's `version`), else the newest known block list of
// that path with a matching size, else the bytes are read at that version and
// hashed on the server (only blocks Platinum reports missing are then sent,
// each re-read with a Range request). A folder restore also removes what was
// added after that version. Everything is ONE action (one timeline entry), so
// the restore itself can be undone.
//
// A drive restore is a Platinum volume restore (a byte copy of the old
// image). The current head is checkpointed first ("Before restore — …").

import {
  basename,
  BLOCK_SIZE,
  dirname,
  normalizePath,
  type ActionKind,
  type ActionSummary,
  type RestoreResponse,
} from '@volumes/shared';
import { ApiError } from '../lib/http';
import { getStore } from '../storage';
import { isStoreError, type Commit, type FileEntry, type FileStat, type Ref } from '../storage/types';
import type { WorkspaceCtx } from '../types';
import { createCheckpoint, deleteCheckpoint } from './checkpoints';
import { exactBlockLists, landedCommit, withAction, type ActionCtx, type PathChange } from './ledger';
import { detachLiveLinks } from './links';
import { reserveQuota } from './reservations';
import { blockSourceAt, serverUpload } from './server-upload';
import { listTree, statOrNull } from './tree';
import { DIR_BYTES, logicalSize, Projection } from './footprint';
import { hashBlocks, isUnder, mapLimit, topMost } from './versioning-util';


interface PlannedFile {
  path: string;
  /** Where the bytes live at `at` when that differs from `path` (a file renamed since). */
  sourcePath?: string;
  size: number;
  mtime: number;
  mode?: number;
  blocks: string[];
}

interface Removal {
  path: string;
  type: 'file' | 'dir';
  /** file bytes (for the ledger) */
  size: number;
  /** what it occupies in the volume's logicalBytes (quota) */
  logical: number;
}

interface RestoreWork {
  /** head paths to remove first (top-most only) */
  remove: Removal[];
  files: PlannedFile[];
  dirs: string[];
  changes: PathChange[];
  /** growth of logicalBytes (4 KiB pages per file, 4 KiB per folder), like an upload plan's */
  addBytes: number;
}

/** A folder at head: its file bytes and its logical footprint (itself, subfolders, files by the page). */
function dirRemoval(path: string, entries: FileEntry[]): Removal {
  let size = 0;
  let logical = 4096;
  for (const e of entries) {
    if (!isUnder(path, e.path) || e.path === path) continue;
    if (e.type === 'dir') logical += 4096;
    else {
      size += e.size;
      logical += logicalSize(e.size);
    }
  }
  return { path, type: 'dir', size, logical };
}

const fileRemoval = (path: string, size: number): Removal => ({ path, type: 'file', size, logical: logicalSize(size) });

// ── content identity ────────────────────────────────────────────────────────

/**
 * A file's bytes at a commit, as block hashes: the ledger's block list of the
 * exact version when it has one, else the bytes read and hashed.
 */
async function contentHash(ws: WorkspaceCtx, s: FileStat, at: string): Promise<string> {
  if (s.size === 0) return 'empty';
  if (s.version) {
    const known = (await exactBlockLists(ws.id, [s])).get(s.path);
    if (known) return known.join(',');
  }
  const h = await hashBlocks((await getStore().read(ws.volumeId, s.path, { at })).body);
  if (h.size !== s.size) throw new ApiError(503, 'upstream_unavailable', 'Could not read that version completely. Try again.');
  return h.blocks.join(',');
}

/**
 * Whether two stats of a file (`a` read at `atA`, `b` at `atB`) hold the same
 * content. Identity is the version id (the commit that last wrote the entry);
 * when the store reports none, the bytes are hashed. With `bytesIfVersionsDiffer`,
 * two versions are also the same content when their bytes are (a file deleted
 * and brought back holds what it held). Equal size and mtime alone never count
 * as the same content.
 */
export async function sameContent(
  ws: WorkspaceCtx,
  a: FileStat,
  atA: string,
  b: FileStat,
  atB: string,
  opts: { bytesIfVersionsDiffer?: boolean } = {},
): Promise<boolean> {
  if ((a.type === 'dir') !== (b.type === 'dir') || a.size !== b.size) return false;
  if (a.version && b.version && (a.version === b.version || !opts.bytesIfVersionsDiffer)) return a.version === b.version;
  const [ha, hb] = await Promise.all([contentHash(ws, a, atA), contentHash(ws, b, atB)]);
  return ha === hb;
}

/**
 * Every path under `root` (itself included) whose content differs between
 * commits `a` and `b`: added, removed, changed type, or files whose bytes
 * differ (same version id, else same bytes; see sameContent). Sorted; empty
 * when all is the same.
 */
export async function changedUnder(ws: WorkspaceCtx, root: string, a: string, b: string): Promise<string[]> {
  const store = getStore();
  const byBytes = { bytesIfVersionsDiffer: true };
  const [sa, sb] = await Promise.all([statOrNull(ws, root, a), statOrNull(ws, root, b)]);
  if (!sa && !sb) return [];
  if (!sa || !sb || (sa.type === 'dir') !== (sb.type === 'dir')) return [root];
  if (sa.type !== 'dir') return (await sameContent(ws, sa, a, sb, b, byBytes)) ? [] : [root];
  const [ta, tb] = await Promise.all([listTree(ws, root, a), listTree(ws, root, b)]);
  const B = new Map(tb.entries.map((e) => [e.path, e]));
  const out: string[] = [];
  const check: string[] = [];
  for (const ea of ta.entries) {
    const eb = B.get(ea.path);
    B.delete(ea.path);
    if (!eb || (ea.type === 'dir') !== (eb.type === 'dir')) out.push(ea.path);
    else if (ea.type === 'dir') continue;
    else if (ea.size !== eb.size) out.push(ea.path);
    else check.push(ea.path);
  }
  out.push(...B.keys());
  const same = await mapLimit(check, 16, async (p) => {
    const [x, y] = await Promise.all([store.stat(ws.volumeId, p, { at: a }), store.stat(ws.volumeId, p, { at: b })]);
    return sameContent(ws, x, a, y, b, byBytes);
  });
  check.forEach((p, i) => {
    if (!same[i]) out.push(p);
  });
  return out.sort();
}

// ── block lists ─────────────────────────────────────────────────────────────

/**
 * Resolves the block list of every file: the ledger row written by the commit
 * that produced the entry's version at `at`, else the bytes read at `at` and
 * hashed. A same-size list from some other version is never used: it would
 * silently write the wrong content.
 */
async function resolveBlocks(ws: WorkspaceCtx, stats: FileStat[], target: Commit): Promise<PlannedFile[]> {
  const store = getStore();
  const exact = await exactBlockLists(ws.id, stats);
  return mapLimit(stats, 8, async (s) => {
    let blocks = exact.get(s.path);
    if (!blocks) {
      if (s.size === 0) blocks = [];
      else {
        const r = await store.read(ws.volumeId, s.path, { at: target.id });
        const h = await hashBlocks(r.body);
        if (h.size !== s.size) throw new ApiError(503, 'upstream_unavailable', 'Could not read that version completely. Try again.');
        blocks = h.blocks;
      }
    }
    return { path: s.path, size: s.size, mtime: s.mtime, mode: s.mode, blocks };
  });
}

// ── planning ────────────────────────────────────────────────────────────────

async function planRestore(ws: WorkspaceCtx, roots: string[], target: Commit, headId: string): Promise<RestoreWork> {
  const store = getStore();
  const remove = new Map<string, Removal>();
  const dirs = new Set<string>();
  const fileStats: FileStat[] = [];
  const replacedSize = new Map<string, number>(); // path → head size being replaced
  const changes: PathChange[] = [];

  const rootStats = await mapLimit(roots, 8, (root) => Promise.all([statOrNull(ws, root, target.id), statOrNull(ws, root, headId)]));
  for (let ri = 0; ri < roots.length; ri++) {
    const root = roots[ri];
    const [sAt, sHead] = rootStats[ri];

    if (!sAt) {
      // Did not exist then: remove it (an undo of an add).
      if (sHead && root !== '/') {
        remove.set(root, sHead.type === 'dir' ? dirRemoval(root, (await listTree(ws, root, headId)).entries) : fileRemoval(root, sHead.size));
      }
      continue;
    }

    if (sAt.type !== 'dir') {
      if (sHead && sHead.type === 'dir') {
        remove.set(root, dirRemoval(root, (await listTree(ws, root, headId)).entries));
      } else if (sHead && sHead.version && sHead.version === sAt.version) {
        continue; // already that version
      } else if (sHead) replacedSize.set(root, sHead.size);
      fileStats.push(sAt);
      continue;
    }

    // Folder
    if (sHead && sHead.type !== 'dir') {
      remove.set(root, fileRemoval(root, sHead.size));
    }
    if (root !== '/' && (!sHead || sHead.type !== 'dir')) dirs.add(root);
    const atEntries = (await listTree(ws, root, target.id)).entries;
    const headEntries = sHead && sHead.type === 'dir' ? (await listTree(ws, root, headId)).entries : [];
    const headMap = new Map(headEntries.map((e) => [e.path, e]));
    const atMap = new Map(atEntries.map((e) => [e.path, e]));
    const toStat: string[] = [];
    const sameLooking: string[] = [];
    for (const e of atEntries) {
      const h = headMap.get(e.path);
      if (e.type === 'dir') {
        if (!h) dirs.add(e.path);
        else if (h.type !== 'dir') {
          remove.set(e.path, fileRemoval(e.path, h.size));
          dirs.add(e.path);
        }
        continue;
      }
      if (h && h.type === 'dir') {
        remove.set(e.path, dirRemoval(e.path, headEntries));
        toStat.push(e.path);
      } else if (h && h.size === e.size && h.mtime === e.mtime) {
        sameLooking.push(e.path);
      } else {
        if (h) replacedSize.set(e.path, h.size);
        toStat.push(e.path);
      }
    }
    for (const h of headEntries) {
      if (atMap.has(h.path)) continue;
      remove.set(h.path, h.type === 'dir' ? dirRemoval(h.path, headEntries) : fileRemoval(h.path, h.size));
    }
    // Equal (size, mtime) is not the same content: confirm every one by identity,
    // however many there are, so a restore never skips a changed file.
    const pairs = await mapLimit(sameLooking, 16, async (p) => {
      const [a, h] = await Promise.all([store.stat(ws.volumeId, p, { at: target.id }), store.stat(ws.volumeId, p, { at: headId })]);
      return { a, h, same: await sameContent(ws, a, target.id, h, headId) };
    });
    for (const { a, h, same } of pairs) {
      if (same) continue;
      replacedSize.set(a.path, h.size);
      fileStats.push(a);
    }
    const stats = await mapLimit(toStat, 16, (p) => store.stat(ws.volumeId, p, { at: target.id }));
    fileStats.push(...stats);
  }

  // Only top-most removals; a removal inside a removed folder is implied.
  const removeTop = topMost(remove.keys()).map((p) => remove.get(p)!);
  const files = await resolveBlocks(ws, fileStats, target);
  const dirList = [...dirs].sort();

  for (const r of removeTop) changes.push({ op: 'deleted', path: r.path, entryType: r.type, size: r.size });
  for (const d of dirList) changes.push({ op: 'restored', path: d, entryType: 'dir' });
  for (const f of files) {
    changes.push({
      op: 'restored',
      path: f.path,
      entryType: 'file',
      size: f.size,
      prevSize: replacedSize.get(f.path),
      blockHashes: f.blocks,
      mtime: f.mtime,
    });
  }
  // Logical growth, measured the way the volume (and the quota) count it.
  const removedLogical = removeTop.reduce((s, r) => s + r.logical, 0);
  const replacedLogical = files.reduce((s, f) => {
    const prev = replacedSize.get(f.path);
    return s + (prev === undefined || remove.has(f.path) ? 0 : logicalSize(prev));
  }, 0);
  const addBytes =
    files.reduce((s, f) => s + logicalSize(f.size), 0) +
    DIR_BYTES * (dirList.length + (await missingParents(ws, headId, files, dirs))) -
    replacedLogical -
    removedLogical;
  return { remove: removeTop, files, dirs: dirList, changes, addBytes };
}

/**
 * Folders above the restored items that are missing at head and not restored
 * themselves (a file whose folders were deleted since): the upload creates
 * them, and each takes 4 KiB.
 */
async function missingParents(ws: WorkspaceCtx, headId: string, files: PlannedFile[], dirs: Set<string>): Promise<number> {
  const proj = new Projection(ws, headId);
  const parents = new Set<string>();
  for (const f of files) parents.add(dirname(f.path));
  for (const d of dirs) parents.add(dirname(d));
  let n = 0;
  // Shallowest first, so shared parents are looked up once.
  for (const p of [...parents].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))) {
    if (p === '/' || dirs.has(p)) continue; // a restored folder is counted already (its parents come from its own entry)
    for (const d of await proj.createDirs(p, true)) if (!dirs.has(d)) n++;
  }
  return n;
}

function sumFiles(entries: FileEntry[]): number {
  return entries.reduce((s, e) => s + (e.type === 'dir' ? 0 : e.size), 0);
}

const expectedBlocks = (size: number) => Math.ceil(size / BLOCK_SIZE);

// ── execution ───────────────────────────────────────────────────────────────

/** Restores files / folders to `at` as one action (re-uploads old block lists; removes later additions). */
export async function restorePaths(
  ctx: ActionCtx,
  opts: {
    paths: string[];
    at: Ref;
    kind: ActionKind;
    summary: string;
    undoOfActionId?: string;
    /** Runs under the workspace lock with the head the restore starts from, before anything is written; throw to refuse. */
    verify?: (headCommitId: string) => Promise<void>;
  },
): Promise<ActionSummary> {
  const store = getStore();
  const roots = topMost(opts.paths.map((p) => normalizePath(p)));
  if (!roots.length) throw new ApiError(400, 'bad_request', 'Nothing to restore.');
  const target = await store.getCommit(ctx.ws.volumeId, opts.at);
  const { action } = await withAction(
    ctx,
    {
      kind: opts.kind,
      summary: opts.summary,
      paths: [],
      undoOfActionId: opts.undoOfActionId,
      meta: { at: target.id, atCreatedAt: target.createdAt, roots: roots.slice(0, 50) },
    },
    async (rec) => {
      if (opts.verify) await opts.verify(rec.baseCommitId);
      const work = await planRestore(ctx.ws, roots, target, rec.baseCommitId);
      await using _quota = await reserveQuota(ctx.ws.userId, work.addBytes, 'restore.paths'); // held until the restore lands
      // Ledger intent before any storage call.
      await rec.addPaths(work.changes);
      for (const r of work.remove) {
        await rec.commit(await store.remove(ctx.ws.volumeId, r.path, { recursive: true }));
        await detachLiveLinks(ctx.ws.id, r.path, rec.actionId);
      }
      if (work.files.length || work.dirs.length) await serverUpload(ctx.ws, work.files, work.dirs, blockSourceAt(ctx.ws, work.files, target.id), rec);
    },
  );
  return action;
}

/**
 * Restores the file now at `to` to the version it had at `at` under an earlier
 * name `from` (it was renamed since). One action; the bytes are re-planned
 * from the old version's block list like any file restore.
 */
export async function restoreFileFrom(
  ctx: ActionCtx,
  opts: { from: string; to: string; at: Ref; summary: string },
): Promise<ActionSummary> {
  const store = getStore();
  const from = normalizePath(opts.from);
  const to = normalizePath(opts.to);
  const target = await store.getCommit(ctx.ws.volumeId, opts.at);
  const src = await store.stat(ctx.ws.volumeId, from, { at: target.id });
  if (src.type === 'dir') throw new ApiError(409, 'not_a_file', 'That version is a folder.', { path: from });
  const { action } = await withAction(
    ctx,
    { kind: 'restore.file', summary: opts.summary, paths: [], meta: { at: target.id, atCreatedAt: target.createdAt, roots: [to], from } },
    async (rec) => {
      const now = await statOrNull(ctx.ws, to, rec.baseCommitId);
      if (now && now.type === 'dir') throw new ApiError(409, 'not_a_file', 'A folder has that name now.', { path: to });
      const [planned] = await resolveBlocks(ctx.ws, [src], target);
      const file: PlannedFile = { ...planned, path: to, sourcePath: from };
      const parents = (await new Projection(ctx.ws, rec.baseCommitId).createDirs(to)).length * DIR_BYTES; // folders deleted since
      await using _quota = await reserveQuota(ctx.ws.userId, logicalSize(file.size) - (now ? logicalSize(now.size) : 0) + parents, 'restore.file'); // held until the restore lands
      await rec.addPaths([
        { op: 'restored', path: to, entryType: 'file', size: file.size, prevSize: now?.size, blockHashes: file.blocks, mtime: file.mtime },
      ]);
      await serverUpload(ctx.ws, [file], [], blockSourceAt(ctx.ws, [file], target.id), rec);
    },
  );
  return action;
}

// ── drive ───────────────────────────────────────────────────────────────────

/** Ledger rows for a drive restore: what comes back (restored) and what goes (deleted, top-most). */
async function driveChanges(ws: WorkspaceCtx, headId: string, targetId: string): Promise<PathChange[]> {
  const [h, t] = await Promise.all([listTree(ws, '/', headId), listTree(ws, '/', targetId)]);
  const H = new Map(h.entries.map((e) => [e.path, e]));
  const T = new Map(t.entries.map((e) => [e.path, e]));
  const changes: PathChange[] = [];
  const gone: string[] = [];
  for (const [p, e] of H) {
    const te = T.get(p);
    if (!te || (te.type === 'dir') !== (e.type === 'dir')) gone.push(p);
  }
  for (const p of topMost(gone)) {
    const e = H.get(p)!;
    const size = e.type === 'dir' ? sumFiles(h.entries.filter((x) => isUnder(p, x.path))) : e.size;
    changes.push({ op: 'deleted', path: p, entryType: e.type === 'dir' ? 'dir' : 'file', size });
  }
  for (const [p, e] of T) {
    const he = H.get(p);
    if (e.type === 'dir') {
      if (!he || he.type !== 'dir') changes.push({ op: 'restored', path: p, entryType: 'dir' });
    } else if (!he || he.type === 'dir' || he.size !== e.size || he.mtime !== e.mtime) {
      changes.push({ op: 'restored', path: p, entryType: 'file', size: e.size, prevSize: he && he.type !== 'dir' ? he.size : undefined, mtime: e.mtime });
    }
  }
  return changes;
}

/** Restores the whole drive (volume restore), auto-checkpointing the current head first. */
export async function restoreDrive(
  ctx: ActionCtx,
  at: Ref,
  opts?: {
    undoOfActionId?: string;
    autoCheckpoint?: boolean;
    summary?: string;
    /** Runs under the workspace lock with the head the restore starts from, before anything is written; throw to refuse. */
    verify?: (headCommitId: string) => Promise<void>;
  },
): Promise<RestoreResponse> {
  const store = getStore();
  const target = await store.getCommit(ctx.ws.volumeId, at);
  let checkpoint: { id: string; name: string } | undefined;
  let checkpointSkipped = false;
  const { action } = await withAction(
    ctx,
    {
      kind: 'restore.drive',
      // The time is shown by the client in the viewer's own clock (meta.atCreatedAt).
      summary: opts?.summary ?? 'Restored the drive to an earlier version',
      paths: [],
      undoOfActionId: opts?.undoOfActionId,
      meta: { at: target.id, atCreatedAt: target.createdAt },
    },
    async (rec) => {
      if (opts?.verify) await opts.verify(rec.baseCommitId);
      if (target.id === rec.baseCommitId) return; // already there: noop
      const head = await store.getCommit(ctx.ws.volumeId, rec.baseCommitId);
      await using _quota = await reserveQuota(ctx.ws.userId, target.logicalBytes - head.logicalBytes, 'restore.drive'); // held until the restore lands
      if (opts?.autoCheckpoint !== false) {
        try {
          const cp = await createCheckpoint(ctx, {
            name: 'Before restore',
            note: 'Saved automatically before the drive was restored to an earlier version.',
            at: rec.baseCommitId,
            auto: true,
          });
          checkpoint = { id: cp.id, name: cp.name };
        } catch (e) {
          const budget = (e instanceof ApiError && e.code === 'tag_budget_exceeded') || (isStoreError(e, 'quota_exceeded') && e.extra.limit === 'tags');
          if (!budget) throw e;
          checkpointSkipped = true;
        }
      }
      const changes = await driveChanges(ctx.ws, rec.baseCommitId, target.id);
      await rec.addPaths(changes);
      let commitId: string;
      try {
        commitId = (await store.restoreVolume(ctx.ws.volumeId, target.id)).id;
      } catch (e) {
        // A timeout or 5xx may still have restored the drive: the lock means a
        // moved head is this restore. Then it succeeded, and the checkpoint stays.
        const landed = await landedCommit(ctx.ws.volumeId, rec.baseCommitId, e);
        if (!landed) {
          if (checkpoint && landed === null) await deleteCheckpoint(ctx.ws, checkpoint.id).catch(() => {});
          if (landed === null) checkpoint = undefined;
          throw e;
        }
        commitId = landed;
      }
      await rec.commit({ commitId, outcome: 'fast', headCommitId: commitId, overwritten: [], skipped: [] });
      for (const c of changes) if (c.op === 'deleted') await detachLiveLinks(ctx.ws.id, c.path, rec.actionId);
    },
  );
  return { action, ...(checkpoint ? { checkpoint } : {}), ...(checkpointSkipped ? { checkpointSkipped: true } : {}) };
}

/**
 * Default summary of a file / folder restore. It carries no time: the client
 * adds the version's time in the viewer's own clock (meta.atCreatedAt).
 */
export function restoreSummary(path: string, type: 'file' | 'dir'): string {
  if (path === '/') return 'Restored every file to an earlier version';
  const name = basename(path);
  return type === 'dir' ? `Restored folder ${name} to an earlier version` : `Restored ${name} to an earlier version`;
}

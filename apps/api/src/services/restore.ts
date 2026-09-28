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

import { and, eq, inArray, ne, sql, isNotNull } from 'drizzle-orm';
import {
  basename,
  BLOCK_SIZE,
  MAX_PLAN_BLOCKS,
  MAX_PLAN_FILES,
  normalizePath,
  type ActionKind,
  type ActionSummary,
  type RestoreResponse,
} from '@volumes/shared';
import { db } from '../db/client';
import { actionPaths, actions } from '../db/schema';
import { ApiError } from '../lib/http';
import { getStore } from '../storage';
import { isStoreError, type Commit, type CommitResult, type FileEntry, type FileStat, type Ref } from '../storage/types';
import type { WorkspaceCtx } from '../types';
import { createCheckpoint, deleteCheckpoint } from './checkpoints';
import { lastKnownBlocks, withAction, type ActionCtx, type ActionRecorder, type PathChange } from './ledger';
import { assertQuota } from './quota';
import { listTree, statOrNull } from './tree';
import { formatUtc, hashBlocks, isUnder, mapLimit, readStream, topMost } from './versioning-util';

/** Files whose (size, mtime) match head are version-checked one by one only up to this many. */
const VERSION_CHECK_MAX = 2000;

interface PlannedFile {
  path: string;
  size: number;
  mtime: number;
  mode?: number;
  blocks: string[];
}

interface RestoreWork {
  /** head paths to remove first (top-most only) */
  remove: { path: string; type: 'file' | 'dir'; size: number }[];
  files: PlannedFile[];
  dirs: string[];
  changes: PathChange[];
  addBytes: number;
}

const expectedBlocks = (size: number) => Math.ceil(size / BLOCK_SIZE);

// ── block lists ─────────────────────────────────────────────────────────────

/**
 * Block lists recorded by the exact commit that wrote each entry
 * (`vc_<version>` ∈ action.commit_ids), for many paths at once.
 */
async function exactBlocks(wsId: string, stats: FileStat[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const withVersion = stats.filter((s) => s.version);
  for (let i = 0; i < withVersion.length; i += 1000) {
    const chunk = withVersion.slice(i, i + 1000);
    const commitIds = [...new Set(chunk.map((s) => `vc_${s.version}`))];
    const rows = await db
      .select({ path: actionPaths.path, blocks: actionPaths.blockHashes, size: actionPaths.size, commitIds: actions.commitIds })
      .from(actionPaths)
      .innerJoin(actions, eq(actions.id, actionPaths.actionId))
      .where(
        and(
          eq(actionPaths.workspaceId, wsId),
          inArray(
            actionPaths.path,
            chunk.map((s) => s.path),
          ),
          ne(actionPaths.op, 'deleted'),
          isNotNull(actionPaths.blockHashes),
          sql`${actions.commitIds} && ${sql.param(commitIds)}::text[]`,
        ),
      );
    const want = new Map(chunk.map((s) => [s.path, s]));
    for (const r of rows) {
      const s = want.get(r.path);
      if (!s || !r.blocks || out.has(r.path)) continue;
      if (!r.commitIds.includes(`vc_${s.version}`)) continue;
      if ((r.size ?? -1) !== s.size || r.blocks.length !== expectedBlocks(s.size)) continue;
      out.set(r.path, r.blocks);
    }
  }
  return out;
}

/** Resolves the block list of every file (ledger → last known → hash the bytes at `at`). */
async function resolveBlocks(ws: WorkspaceCtx, stats: FileStat[], target: Commit): Promise<PlannedFile[]> {
  const store = getStore();
  const exact = await exactBlocks(ws.id, stats);
  const asOf = new Date(target.createdAt);
  return mapLimit(stats, 8, async (s) => {
    let blocks = exact.get(s.path);
    if (!blocks) {
      const known = await lastKnownBlocks(ws.id, s.path, asOf);
      if (known && known.size === s.size && known.blocks.length === expectedBlocks(s.size)) blocks = known.blocks;
    }
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
  const remove = new Map<string, { path: string; type: 'file' | 'dir'; size: number }>();
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
        const size = sHead.type === 'dir' ? sumFiles((await listTree(ws, root, headId)).entries) : sHead.size;
        remove.set(root, { path: root, type: sHead.type === 'dir' ? 'dir' : 'file', size });
      }
      continue;
    }

    if (sAt.type !== 'dir') {
      if (sHead && sHead.type === 'dir') {
        remove.set(root, { path: root, type: 'dir', size: sumFiles((await listTree(ws, root, headId)).entries) });
      } else if (sHead && sHead.version && sHead.version === sAt.version) {
        continue; // already that version
      } else if (sHead) replacedSize.set(root, sHead.size);
      fileStats.push(sAt);
      continue;
    }

    // Folder
    if (sHead && sHead.type !== 'dir') {
      remove.set(root, { path: root, type: 'file', size: sHead.size });
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
          remove.set(e.path, { path: e.path, type: 'file', size: h.size });
          dirs.add(e.path);
        }
        continue;
      }
      if (h && h.type === 'dir') {
        remove.set(e.path, { path: e.path, type: 'dir', size: sumFiles(headEntries.filter((x) => isUnder(e.path, x.path))) });
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
      remove.set(h.path, {
        path: h.path,
        type: h.type === 'dir' ? 'dir' : 'file',
        size: h.type === 'dir' ? sumFiles(headEntries.filter((x) => isUnder(h.path, x.path))) : h.size,
      });
    }
    // (size, mtime) equal is almost always the same content; confirm by version when affordable.
    if (sameLooking.length && sameLooking.length <= VERSION_CHECK_MAX) {
      const pairs = await mapLimit(sameLooking, 16, async (p) => {
        const [a, h] = await Promise.all([store.stat(ws.volumeId, p, { at: target.id }), store.stat(ws.volumeId, p, { at: headId })]);
        return { a, h };
      });
      for (const { a, h } of pairs) {
        if (a.version && h.version && a.version === h.version) continue;
        if (!a.version && !h.version) continue;
        replacedSize.set(a.path, h.size);
        fileStats.push(a);
      }
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
  const removedBytes = removeTop.reduce((s, r) => s + r.size, 0);
  const replacedBytes = files.reduce((s, f) => s + (replacedSize.get(f.path) ?? 0), 0);
  const addBytes = files.reduce((s, f) => s + f.size, 0) - replacedBytes - removedBytes;
  return { remove: removeTop, files, dirs: dirList, changes, addBytes };
}

function sumFiles(entries: FileEntry[]): number {
  return entries.reduce((s, e) => s + (e.type === 'dir' ? 0 : e.size), 0);
}

// ── execution ───────────────────────────────────────────────────────────────

function batches(files: PlannedFile[]): PlannedFile[][] {
  const out: PlannedFile[][] = [];
  let cur: PlannedFile[] = [];
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

/** Plans, sends only the blocks Platinum lacks (re-read from `at`), commits; one commit per batch. */
async function uploadRestored(ws: WorkspaceCtx, files: PlannedFile[], dirs: string[], at: string, rec: ActionRecorder): Promise<void> {
  const store = getStore();
  const source = new Map<string, { path: string; start: number; end: number }>();
  for (const f of files) {
    f.blocks.forEach((sha, i) => {
      if (source.has(sha)) return;
      const start = i * BLOCK_SIZE;
      source.set(sha, { path: f.path, start, end: Math.min(start + BLOCK_SIZE, f.size) - 1 });
    });
  }
  const send = async (uploadId: string, shas: string[]) => {
    await mapLimit([...new Set(shas)], 4, async (sha) => {
      const src = source.get(sha);
      if (!src) throw new ApiError(500, 'internal', 'Restore could not locate a block.');
      const r = await store.read(ws.volumeId, src.path, { at, range: `bytes=${src.start}-${src.end}` });
      await store.putBlock(ws.volumeId, uploadId, sha, await readStream(r.body));
    });
  };

  const groups = batches(files);
  if (!groups.length && dirs.length) groups.push([]);
  for (let i = 0; i < groups.length; i++) {
    const batch = groups[i];
    const plan = await store.planUpload(ws.volumeId, {
      files: batch.map((f) => ({ path: f.path, size: f.size, blocks: f.blocks, mtime: f.mtime, ...(f.mode !== undefined ? { mode: f.mode } : {}) })),
      dirs: i === 0 ? dirs : [],
      overwrite: true,
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

/** Restores files / folders to `at` as one action (re-uploads old block lists; removes later additions). */
export async function restorePaths(
  ctx: ActionCtx,
  opts: { paths: string[]; at: Ref; kind: ActionKind; summary: string; undoOfActionId?: string },
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
      const work = await planRestore(ctx.ws, roots, target, rec.baseCommitId);
      await assertQuota(ctx.userId, work.addBytes);
      // Ledger intent before any storage call.
      await rec.addPaths(work.changes);
      for (const r of work.remove) {
        await rec.commit(await store.remove(ctx.ws.volumeId, r.path, { recursive: true }));
      }
      if (work.files.length || work.dirs.length) await uploadRestored(ctx.ws, work.files, work.dirs, target.id, rec);
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
  opts?: { undoOfActionId?: string; autoCheckpoint?: boolean; summary?: string },
): Promise<RestoreResponse> {
  const store = getStore();
  const target = await store.getCommit(ctx.ws.volumeId, at);
  let checkpoint: { id: string; name: string } | undefined;
  let checkpointSkipped = false;
  const { action } = await withAction(
    ctx,
    {
      kind: 'restore.drive',
      summary: opts?.summary ?? `Restored the drive to ${formatUtc(target.createdAt)}`,
      paths: [],
      undoOfActionId: opts?.undoOfActionId,
      meta: { at: target.id, atCreatedAt: target.createdAt },
    },
    async (rec) => {
      if (target.id === rec.baseCommitId) return; // already there: noop
      const head = await store.getCommit(ctx.ws.volumeId, rec.baseCommitId);
      await assertQuota(ctx.userId, target.logicalBytes - head.logicalBytes);
      if (opts?.autoCheckpoint !== false) {
        try {
          const cp = await createCheckpoint(ctx, {
            name: `Before restore — ${formatUtc(new Date())}`,
            note: `Saved automatically before the drive was restored to ${formatUtc(target.createdAt)}.`,
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
      try {
        await rec.addPaths(await driveChanges(ctx.ws, rec.baseCommitId, target.id));
        const c = await store.restoreVolume(ctx.ws.volumeId, target.id);
        await rec.commit({ commitId: c.id, outcome: 'fast', headCommitId: c.id, overwritten: [], skipped: [] });
      } catch (e) {
        if (checkpoint) await deleteCheckpoint(ctx.ws, checkpoint.id).catch(() => {});
        checkpoint = undefined;
        throw e;
      }
    },
  );
  return { action, ...(checkpoint ? { checkpoint } : {}), ...(checkpointSkipped ? { checkpointSkipped: true } : {}) };
}

/** Default summary of a file / folder restore. */
export function restoreSummary(path: string, type: 'file' | 'dir', at: string): string {
  if (path === '/') return `Restored every file to ${formatUtc(at)}`;
  const name = basename(path);
  return type === 'dir' ? `Restored folder ${name} to ${formatUtc(at)}` : `Restored ${name} to ${formatUtc(at)}`;
}

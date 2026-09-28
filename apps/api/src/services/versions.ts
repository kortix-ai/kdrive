// Versions of one file, and comparing a file at two versions.
// Owner: API-versioning. See architecture §9.2.
//
// Versions come from the ledger: every committed row that wrote the path
// (plus moves/copies of an ancestor folder), following renames back to the
// file's earlier names. A version is kept only while its action still has a
// surviving commit; each is stat'ed at that commit and deduplicated by the
// entry `version` (the commit that last wrote it). With no ledger rows the
// commit chain is walked instead: stat(head).version → vc_<version> →
// parent → stat … (≤ 50 steps).

import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  basename,
  mimeFor,
  previewKind,
  TEXT_DIFF_MAX_BYTES,
  type CompareFileResponse,
  type CompareKind,
  type FileSide,
  type FileVersion,
  type VersionsResponse,
} from '@volumes/shared';
import { db } from '../db/client';
import { actionPaths, actions, type ActionPathRow, type ActionRow } from '../db/schema';
import { ApiError } from '../lib/http';
import { getStore } from '../storage';
import { isStoreError, type Commit, type FileStat } from '../storage/types';
import type { WorkspaceCtx } from '../types';
import { allCheckpointRows } from './checkpoints';
import { actionsByCommits } from './ledger';
import { statOrNull } from './tree';
import { ancestorsOf, cmpCommitId, contentUrlFor, mapLimit, visibleHistory } from './versioning-util';

const CHAIN_MAX = 50;
const RENAME_DEPTH = 20;

interface VersionEvent {
  row: ActionPathRow;
  action: ActionRow;
  /** The file's path at the time of this event (an earlier name after renames). */
  name: string;
}

/** Committed rows that wrote `name` itself, or moved/copied one of its ancestor folders. */
async function rowsFor(wsId: string, name: string): Promise<(ActionPathRow & { action: ActionRow })[]> {
  const ancestors = ancestorsOf(name);
  const direct = eq(actionPaths.path, name);
  const viaAncestor = ancestors.length
    ? and(inArray(actionPaths.path, ancestors), inArray(actionPaths.op, ['moved', 'copied']), eq(actionPaths.entryType, 'dir'))
    : undefined;
  const rows = await db
    .select({ p: actionPaths, a: actions })
    .from(actionPaths)
    .innerJoin(actions, eq(actions.id, actionPaths.actionId))
    .where(and(eq(actionPaths.workspaceId, wsId), eq(actions.status, 'committed'), viaAncestor ? or(direct, viaAncestor) : direct))
    .orderBy(desc(sql`${actions.headCommitId} COLLATE "C"`), desc(actionPaths.id));
  return rows.map((r) => ({ ...r.p, action: r.a }));
}

/** Ledger events for the file at `path`, following renames back (newest first). */
async function collectEvents(wsId: string, path: string): Promise<VersionEvent[]> {
  const events: VersionEvent[] = [];
  const queue: { name: string; before: string | null }[] = [{ name: path, before: null }];
  const seen = new Set<string>();
  for (let depth = 0; depth < RENAME_DEPTH && queue.length; depth++) {
    const { name, before } = queue.shift()!;
    const key = `${name}\u0000${before ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const row of await rowsFor(wsId, name)) {
      const head = row.action.headCommitId;
      if (!head) continue;
      if (before && cmpCommitId(head, before) >= 0) continue;
      const { action, ...rest } = row;
      events.push({ row: rest, action, name });
      // A rename into this name ends this name's lineage: older rows at this
      // name were another file; the file's own past lives under the old name.
      if (row.op === 'moved' && row.fromPath) {
        const earlier = row.path === name ? row.fromPath : row.fromPath + name.slice(row.path.length);
        queue.push({ name: earlier, before: head });
        break;
      }
    }
  }
  return events;
}

/** Every version of `path` still in history (ledger first, commit-chain fallback). */
export async function fileVersions(ws: WorkspaceCtx, path: string): Promise<VersionsResponse> {
  const store = getStore();
  const [events, headStat] = await Promise.all([collectEvents(ws.id, path), statOrNull(ws, path)]);
  if (!events.length) return chainVersions(ws, path, headStat);

  // Which commits still exist (history hides thinned ones)?
  const oldest = events.reduce((m, e) => {
    const first = e.action.commitIds[0] ?? e.action.headCommitId!;
    return cmpCommitId(first, m) < 0 ? first : m;
  }, events[0].action.headCommitId!);
  const { commits } = await visibleHistory(ws.volumeId, { stopAt: (c) => cmpCommitId(c.id, oldest) <= 0, maxPages: 25 });
  const visible = new Map(commits.map((c) => [c.id, c]));

  const candidates = events
    .map((e) => {
      const surviving = [...e.action.commitIds].reverse().find((id) => visible.has(id));
      return surviving ? { e, commit: visible.get(surviving)! } : null;
    })
    .filter((x): x is { e: VersionEvent; commit: Commit } => !!x);

  const stats = await mapLimit(candidates, 8, async ({ e, commit }) => {
    try {
      return await store.stat(ws.volumeId, e.name, { at: commit.id });
    } catch (err) {
      if (isStoreError(err, 'path_not_found') || isStoreError(err, 'not_found')) return null;
      throw err;
    }
  });

  // Oldest first, so the event that created a version wins the dedupe.
  const order = candidates.map((c, i) => ({ ...c, stat: stats[i] })).filter((x) => x.stat) as {
    e: VersionEvent;
    commit: Commit;
    stat: FileStat;
  }[];
  order.sort((x, y) => cmpCommitId(x.commit.id, y.commit.id));
  const byVersion = new Map<string, { e: VersionEvent; commit: Commit; stat: FileStat }>();
  for (const x of order) {
    const key = x.stat.version ?? `commit:${x.commit.id}`;
    const prev = byVersion.get(key);
    // Prefer the event whose commit wrote the entry.
    if (!prev || (x.stat.version && x.commit.id === `vc_${x.stat.version}` && prev.commit.id !== `vc_${x.stat.version}`)) {
      byVersion.set(key, x);
    }
  }

  const versions: FileVersion[] = [...byVersion.values()].map(({ e, commit, stat }) => ({
    commitId: commit.id,
    createdAt: commit.createdAt,
    size: stat.size,
    op: e.row.path === e.name ? e.row.op : e.row.op === 'moved' || e.row.op === 'copied' ? e.row.op : 'unknown',
    actionId: e.action.id,
    summary: e.action.summary,
    isCurrent: !!headStat && !!stat.version && headStat.version === stat.version && e.name === path,
    checkpointNames: [],
  }));

  // The current content came from outside the ledger (or its commit was thinned): show it anyway.
  if (headStat && headStat.type === 'file' && !versions.some((v) => v.isCurrent)) {
    const c = await commitForVersion(ws.volumeId, headStat);
    versions.push({
      commitId: c.id,
      createdAt: c.createdAt,
      size: headStat.size,
      op: 'unknown',
      actionId: null,
      summary: null,
      isCurrent: true,
      checkpointNames: [],
    });
  }

  versions.sort((x, y) => cmpCommitId(y.commitId, x.commitId));
  await attachCheckpointNames(ws, path, versions);
  return { path, versions, source: 'ledger' };
}

/** The commit that wrote the entry (`vc_<version>`) when it is readable, else the stat's commit. */
async function commitForVersion(volumeId: string, s: FileStat): Promise<Pick<Commit, 'id' | 'createdAt'>> {
  const store = getStore();
  if (s.version) {
    try {
      return await store.getCommit(volumeId, `vc_${s.version}`);
    } catch (e) {
      if (!isStoreError(e, 'not_found')) throw e;
    }
  }
  return store.getCommit(volumeId, s.commitId);
}

async function chainVersions(ws: WorkspaceCtx, path: string, headStat: FileStat | null): Promise<VersionsResponse> {
  const store = getStore();
  const versions: FileVersion[] = [];
  if (!headStat) return { path, versions, source: 'chain' };
  const seen = new Set<string>();
  let stat: FileStat | null = headStat;
  for (let step = 0; stat && step < CHAIN_MAX; step++) {
    if (!stat.version || seen.has(stat.version)) break;
    seen.add(stat.version);
    let commit: Commit;
    try {
      commit = await store.getCommit(ws.volumeId, `vc_${stat.version}`);
    } catch (e) {
      if (isStoreError(e, 'not_found')) break;
      throw e;
    }
    versions.push({
      commitId: commit.id,
      createdAt: commit.createdAt,
      size: stat.size,
      op: 'unknown',
      actionId: null,
      summary: null,
      isCurrent: step === 0,
      checkpointNames: [],
    });
    if (!commit.parentId) break;
    try {
      stat = await statOrNull(ws, path, commit.parentId);
    } catch (e) {
      if (isStoreError(e, 'not_found')) break;
      throw e;
    }
  }
  const byCommit = await actionsByCommits(
    ws.id,
    versions.map((v) => v.commitId),
  );
  for (const v of versions) {
    const a = byCommit.get(v.commitId);
    if (a) {
      v.actionId = a.id;
      v.summary = a.summary;
    }
  }
  await attachCheckpointNames(ws, path, versions);
  return { path, versions, source: 'chain' };
}

/** Each checkpoint names the version the file had at the checkpoint's commit. */
async function attachCheckpointNames(ws: WorkspaceCtx, path: string, versions: FileVersion[]): Promise<void> {
  if (!versions.length) return;
  const cps = await allCheckpointRows(ws.id);
  if (!cps.length) return;
  const store = getStore();
  // version id → FileVersion (via a stat at each version's commit)
  const versionIds = await mapLimit(versions, 8, async (v) => {
    try {
      return (await store.stat(ws.volumeId, path, { at: v.commitId })).version;
    } catch {
      return null;
    }
  });
  const byVersion = new Map<string, FileVersion>();
  versions.forEach((v, i) => {
    const id = versionIds[i];
    if (id && !byVersion.has(id)) byVersion.set(id, v);
  });
  const atCp = await mapLimit(cps, 8, async (cp) => {
    try {
      return (await store.stat(ws.volumeId, path, { at: cp.commitId })).version;
    } catch {
      return null;
    }
  });
  cps.forEach((cp, i) => {
    const vid = atCp[i];
    const v = vid ? byVersion.get(vid) : undefined;
    if (v && !v.checkpointNames.includes(cp.name)) v.checkpointNames.push(cp.name);
  });
}

// ── compare ─────────────────────────────────────────────────────────────────

function compareKind(path: string): CompareKind {
  const k = previewKind(path);
  if (k === 'text' || k === 'code' || k === 'markdown' || k === 'json') return 'text';
  if (k === 'image') return 'image';
  if (k === 'csv') return 'csv';
  return 'binary';
}

/** Both sides of one file at two versions (metadata + URLs); the diff itself runs in the browser. */
export async function compareFile(ws: WorkspaceCtx, path: string, a: string, b: string): Promise<CompareFileResponse> {
  const store = getStore();
  const [ca, cb] = await Promise.all([store.getCommit(ws.volumeId, a), store.getCommit(ws.volumeId, b)]);
  const [sa, sb] = await Promise.all([statOrNull(ws, path, ca.id), statOrNull(ws, path, cb.id)]);
  if (!sa && !sb) throw new ApiError(404, 'path_not_found', 'This file does not exist at either version.', { path });
  if ((sa && sa.type === 'dir') || (sb && sb.type === 'dir')) {
    throw new ApiError(409, 'not_a_file', 'Folders are compared with the drive compare.', { path });
  }
  const kind = compareKind(path);
  const mime = mimeFor(basename(path));
  const side = (s: FileStat | null, c: Commit): FileSide | null =>
    s
      ? {
          commitId: c.id,
          createdAt: c.createdAt,
          size: s.size,
          mtime: s.mtime,
          mime,
          version: s.version,
          contentUrl: contentUrlFor(ws.id, path, c.id),
          downloadUrl: contentUrlFor(ws.id, path, c.id, true),
        }
      : null;
  // Only line/cell diffs are bounded; images and binaries always compare.
  const tooLargeForDiff = (kind === 'text' || kind === 'csv') && [sa, sb].some((s) => !!s && s.size > TEXT_DIFF_MAX_BYTES);
  return { path, kind, a: side(sa, ca), b: side(sb, cb), tooLargeForDiff };
}

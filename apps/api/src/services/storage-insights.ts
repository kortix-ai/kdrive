// Settings → Storage: what the user's drives hold by kind of file, their
// largest files, what history keeps restorable, and who in a shared drive
// wrote the files that are there now.
//
// Everything is read from one recursive listing of each drive at its head plus
// the change ledger; nothing is stored. Results are cached per head commit
// (and, for attribution, per ledger state), so a page reload costs nothing
// until the drive changes.

import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import {
  STORAGE_CATEGORIES,
  isWithin,
  meterLevel,
  storageCategory,
  type CategoryUsage,
  type DriveStorage,
  type HistoryUsage,
  type StorageCategory,
  type StorageFile,
  type StorageOverviewResponse,
  type StoragePeopleResponse,
  type StoragePerson,
} from '@volumes/shared';
import { db } from '../db/client';
import { actionPaths, actions, bauthUser, workspaceMembers, workspaces, type WorkspaceRow } from '../db/schema';
import { getStore } from '../storage';
import { isStoreError, type FileEntry } from '../storage/types';
import type { WorkspaceCtx } from '../types';
import { getQuotaBytes } from './quota';
import { mapLimit } from './versioning-util';
import { listWorkspaces } from './workspaces';

/** Entries read per drive at most; a bigger drive is summarised from its first part (`partial`). */
const MAX_ENTRIES = 200_000;
/** Ledger rows read per drive at most when attributing files (newest first). */
const MAX_LEDGER_ROWS = 500_000;
const LEDGER_PAGE = 20_000;
/** Path rewrites (folder moves and copies over many pending files) before attribution gives up on the rest. */
const MAX_REWRITES = 20_000_000;
/** The window RETENTION_COPY promises every version for. */
export const HISTORY_WINDOW_DAYS = 7;
const LARGEST = 10;

// ── the current files of a drive ────────────────────────────────────────────

interface HeadFiles {
  commitId: string;
  logicalBytes: number;
  files: FileEntry[];
  partial: boolean;
}

/** Tiny LRU keyed by `volumeId:commitId…` (commits are immutable, so entries never go stale). */
class Lru<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: V): void {
    this.map.set(k, v);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
  clear(): void {
    this.map.clear();
  }
}

const listings = new Lru<HeadFiles>(32);
const attributions = new Lru<Attribution>(32);

export function clearStorageInsightsCache(): void {
  listings.clear();
  attributions.clear();
}

/** Every file of the drive at its head (one recursive listing, pinned to one commit), at most MAX_ENTRIES entries. */
async function headFiles(volumeId: string | null): Promise<HeadFiles> {
  if (!volumeId) return { commitId: '', logicalBytes: 0, files: [], partial: false };
  const store = getStore();
  let info;
  try {
    info = await store.getVolume(volumeId);
  } catch (e) {
    if (isStoreError(e, 'volume_not_found')) return { commitId: '', logicalBytes: 0, files: [], partial: false };
    throw e;
  }
  const key = `${volumeId}:${info.headCommitId}`;
  const hit = listings.get(key);
  if (hit) return hit;
  const files: FileEntry[] = [];
  let seen = 0;
  let cursor: string | undefined;
  let partial = false;
  for (;;) {
    const page = await store.list(volumeId, '/', { at: info.headCommitId, recursive: true, limit: 10_000, cursor });
    seen += page.entries.length;
    for (const e of page.entries) if (e.type === 'file') files.push(e);
    if (!page.nextCursor) break;
    if (seen >= MAX_ENTRIES) {
      partial = true;
      break;
    }
    cursor = page.nextCursor;
  }
  const v = { commitId: info.headCommitId, logicalBytes: info.logicalBytes, files, partial };
  listings.set(key, v);
  return v;
}

function emptyCategories(): Map<StorageCategory, CategoryUsage> {
  return new Map(STORAGE_CATEGORIES.map((c) => [c, { category: c, bytes: 0, files: 0 }]));
}

/** Keeps the `n` biggest of a stream of files (ties: path order). */
function pushLargest(top: StorageFile[], f: StorageFile, n = LARGEST): void {
  if (top.length === n && f.size <= top[n - 1].size) return;
  top.push(f);
  top.sort((a, b) => b.size - a.size || (a.path < b.path ? -1 : 1));
  if (top.length > n) top.pop();
}

// ── overview: own drives ────────────────────────────────────────────────────

/** Per drive and overall: bytes and files by category, the largest files, and recent replaced / deleted content. */
export async function storageOverview(userId: string): Promise<StorageOverviewResponse> {
  const [quotaBytes, rows] = await Promise.all([getQuotaBytes(userId), listWorkspaces(userId)]);
  const [heads, members, history] = await Promise.all([
    mapLimit(rows, 4, (r) => headFiles(r.volumeId)),
    memberCounts(rows.map((r) => r.id)),
    historyUsage(rows.map((r) => r.id)),
  ]);

  const total = emptyCategories();
  const largest: StorageFile[] = [];
  const drives: DriveStorage[] = rows.map((r: WorkspaceRow, i) => {
    const h = heads[i];
    const cats = emptyCategories();
    let fileBytes = 0;
    for (const f of h.files) {
      const category = storageCategory(f.name || f.path);
      for (const m of [cats, total]) {
        const c = m.get(category)!;
        c.bytes += f.size;
        c.files += 1;
      }
      fileBytes += f.size;
      pushLargest(largest, { workspaceId: r.id, workspaceName: r.name, path: f.path, size: f.size, category });
    }
    return {
      workspaceId: r.id,
      name: r.name,
      bytes: h.logicalBytes,
      fileBytes,
      files: h.files.length,
      categories: [...cats.values()],
      members: members.get(r.id) ?? 0,
      partial: h.partial,
    };
  });

  const usedBytes = heads.reduce((s, h) => s + h.logicalBytes, 0);
  return {
    quotaBytes,
    usedBytes,
    level: meterLevel(usedBytes, quotaBytes),
    fileBytes: drives.reduce((s, d) => s + d.fileBytes, 0),
    files: drives.reduce((s, d) => s + d.files, 0),
    categories: [...total.values()],
    drives,
    largest,
    history,
    partial: drives.some((d) => d.partial),
  };
}

async function memberCounts(wsIds: string[]): Promise<Map<string, number>> {
  if (!wsIds.length) return new Map();
  const rows = await db
    .select({ ws: workspaceMembers.workspaceId, n: sql<number>`count(*)::int` })
    .from(workspaceMembers)
    .where(inArray(workspaceMembers.workspaceId, wsIds))
    .groupBy(workspaceMembers.workspaceId);
  return new Map(rows.map((r) => [r.ws, Number(r.n)]));
}

/**
 * What changes in the retention window replaced or deleted, from the ledger: a
 * file overwritten by an upload, an edit, a restore or a move / copy onto it
 * (its old size), and every deleted item (its size then). The storage layer does
 * not report how much history actually occupies, so this is what history keeps
 * restorable, not bytes on disk: unchanged data is shared between versions.
 */
async function historyUsage(wsIds: string[]): Promise<HistoryUsage> {
  const none = { windowDays: HISTORY_WINDOW_DAYS, replacedBytes: 0, replacedFiles: 0, deletedBytes: 0, deletedItems: 0 };
  if (!wsIds.length) return none;
  const since = new Date(Date.now() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [r] = await db
    .select({
      replacedBytes: sql<string>`COALESCE(SUM(${actionPaths.prevSize}) FILTER (WHERE ${actionPaths.op} <> 'deleted' AND ${actionPaths.entryType} = 'file'), 0)`,
      replacedFiles: sql<number>`(COUNT(*) FILTER (WHERE ${actionPaths.op} <> 'deleted' AND ${actionPaths.entryType} = 'file' AND ${actionPaths.prevSize} IS NOT NULL))::int`,
      deletedBytes: sql<string>`COALESCE(SUM(${actionPaths.size}) FILTER (WHERE ${actionPaths.op} = 'deleted'), 0)`,
      deletedItems: sql<number>`(COUNT(*) FILTER (WHERE ${actionPaths.op} = 'deleted'))::int`,
    })
    .from(actionPaths)
    .innerJoin(actions, eq(actions.id, actionPaths.actionId))
    .where(and(inArray(actionPaths.workspaceId, wsIds), eq(actions.status, 'committed'), gt(actions.createdAt, since)));
  if (!r) return none;
  return {
    windowDays: HISTORY_WINDOW_DAYS,
    replacedBytes: Number(r.replacedBytes),
    replacedFiles: Number(r.replacedFiles),
    deletedBytes: Number(r.deletedBytes),
    deletedItems: Number(r.deletedItems),
  };
}

// ── who wrote what: attribution from the ledger ─────────────────────────────

interface Share {
  bytes: number;
  files: number;
  agentBytes: number;
}

interface Attribution {
  byUser: Map<string, Share>;
  untracked: { bytes: number; files: number };
  partial: boolean;
}

interface LedgerRow {
  id: number;
  op: string;
  path: string;
  fromPath: string | null;
  entryType: 'file' | 'dir';
  size: number | null;
  userId: string | null;
  agent: boolean;
  head: string;
}

/** Ops that put new content at `path` (a move only carries content that is already there). */
const WRITES = new Set(['added', 'changed', 'restored', 'copied']);

/**
 * Who last wrote each current file. Rule: a file counts toward whoever made the
 * last change that put its bytes there (an upload, an edit, a copy, a restore
 * or an undo, which is a restore); a move or a rename keeps the earlier writer.
 * An AI agent's change counts toward the person it acts for (and shows in
 * `agentBytes`). A file with no such change on record (a duplicated drive's
 * original content, or a change made outside KDRIVE), or whose recorded size
 * does not match what is there, is `untracked`.
 *
 * The ledger is replayed backwards, newest commit first: each current path is
 * pending until a write claims it; a move rewrites a pending path to where the
 * file was before. That stops as soon as every file is claimed, and reads at
 * most MAX_LEDGER_ROWS rows.
 */
export async function attributeFiles(wsId: string, files: Pick<FileEntry, 'path' | 'size'>[]): Promise<Attribution> {
  const byUser = new Map<string, Share>();
  const untracked = { bytes: 0, files: 0 };
  const sizeOf = new Map(files.map((f) => [f.path, f.size]));
  // Path at the point of the replay → the current path of the file there.
  let pending = new Map(files.map((f) => [f.path, f.path]));
  let partial = false;
  let rewrites = 0;

  const claim = (current: string, row: LedgerRow) => {
    const size = sizeOf.get(current) ?? 0;
    if (!row.userId) {
      untracked.bytes += size;
      untracked.files += 1;
      return;
    }
    const s = byUser.get(row.userId) ?? { bytes: 0, files: 0, agentBytes: 0 };
    s.bytes += size;
    s.files += 1;
    if (row.agent) s.agentBytes += size;
    byUser.set(row.userId, s);
  };
  const untrack = (current: string) => {
    untracked.bytes += sizeOf.get(current) ?? 0;
    untracked.files += 1;
  };
  /** Pending paths inside folder `dir` (not the folder itself: only files are pending). */
  const under = (dir: string) => {
    rewrites += pending.size;
    return [...pending.keys()].filter((p) => p !== dir && isWithin(dir, p));
  };

  let after: { head: string; id: number } | null = null;
  let read = 0;
  outer: while (pending.size) {
    if (read >= MAX_LEDGER_ROWS || rewrites >= MAX_REWRITES) {
      partial = true;
      break;
    }
    const rows = await ledgerPage(wsId, after);
    if (!rows.length) break;
    read += rows.length;
    after = { head: rows[rows.length - 1].head, id: rows[rows.length - 1].id };
    for (const row of rows) {
      if (!pending.size) break outer;
      if (row.entryType === 'file') {
        const current = pending.get(row.path);
        if (current === undefined) continue;
        if (WRITES.has(row.op)) {
          pending.delete(row.path);
          // A size on record that differs from the file now means a later, unrecorded change.
          if (row.size !== null && row.size !== sizeOf.get(current)) untrack(current);
          else claim(current, row);
        } else if (row.op === 'moved' && row.fromPath) {
          pending.delete(row.path);
          pending.set(row.fromPath, current);
        }
        continue;
      }
      // Folders: a copy wrote everything still pending inside it; a move carried it from fromPath.
      if (row.op === 'copied') {
        for (const p of under(row.path)) {
          claim(pending.get(p)!, row);
          pending.delete(p);
        }
      } else if (row.op === 'moved' && row.fromPath) {
        const moved = under(row.path);
        if (!moved.length) continue;
        const next = new Map(pending);
        for (const p of moved) next.delete(p);
        for (const p of moved) next.set(row.fromPath + p.slice(row.path.length), pending.get(p)!);
        pending = next;
      }
    }
  }
  for (const current of pending.values()) untrack(current);
  return { byUser, untracked, partial };
}

/** One page of the drive's committed ledger rows, newest commit first (then newest row first). */
async function ledgerPage(wsId: string, after: { head: string; id: number } | null): Promise<LedgerRow[]> {
  const conds = [eq(actionPaths.workspaceId, wsId), eq(actions.status, 'committed'), sql`${actions.headCommitId} IS NOT NULL`];
  if (after) conds.push(sql`(${actions.headCommitId}, ${actionPaths.id}) < (${after.head}, ${after.id})`);
  const rows = await db
    .select({
      id: actionPaths.id,
      op: actionPaths.op,
      path: actionPaths.path,
      fromPath: actionPaths.fromPath,
      entryType: actionPaths.entryType,
      size: actionPaths.size,
      userId: actions.userId,
      actorKind: actions.actorKind,
      head: actions.headCommitId,
    })
    .from(actionPaths)
    .innerJoin(actions, eq(actions.id, actionPaths.actionId))
    .where(and(...conds))
    .orderBy(sql`${actions.headCommitId} DESC, ${actionPaths.id} DESC`)
    .limit(LEDGER_PAGE);
  return rows.map((r) => ({ ...r, head: r.head!, agent: r.actorKind === 'agent' }));
}

/** The ledger's state: a finished action changes it even when the head commit stays the same. */
async function ledgerStamp(wsId: string): Promise<string> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int`, last: sql<string | null>`max(${actions.finalizedAt})::text` })
    .from(actions)
    .where(and(eq(actions.workspaceId, wsId), eq(actions.status, 'committed')));
  return `${r?.n ?? 0}:${r?.last ?? ''}`;
}

/** Everyone with access to the drive (owner first), plus anyone else named by `ids`, marked former. */
async function peopleOf(ws: WorkspaceCtx, ids: string[]): Promise<{ id: string; name: string | null; email: string; role: StoragePerson['role'] }[]> {
  const [owner] = await db
    .select({ id: bauthUser.id, name: bauthUser.name, email: bauthUser.email })
    .from(bauthUser)
    .innerJoin(workspaces, eq(workspaces.userId, bauthUser.id))
    .where(and(eq(workspaces.id, ws.id), isNull(workspaces.deletedAt)));
  const members = await db
    .select({ id: bauthUser.id, name: bauthUser.name, email: bauthUser.email, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(bauthUser, eq(bauthUser.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, ws.id));
  const out: { id: string; name: string | null; email: string; role: StoragePerson['role'] }[] = [];
  if (owner) out.push({ ...owner, role: 'owner' });
  out.push(...members);
  const known = new Set(out.map((p) => p.id));
  const former = ids.filter((id) => !known.has(id));
  if (former.length) {
    const rows = await db.select({ id: bauthUser.id, name: bauthUser.name, email: bauthUser.email }).from(bauthUser).where(inArray(bauthUser.id, former));
    out.push(...rows.map((r) => ({ ...r, role: 'former' as const })));
  }
  return out;
}

/** Each person's share of the drive's current files. Any member may read it. */
export async function storagePeople(ws: WorkspaceCtx): Promise<StoragePeopleResponse> {
  const head = await headFiles(ws.volumeId);
  const key = `${ws.volumeId}:${head.commitId}:${await ledgerStamp(ws.id)}`;
  let a = attributions.get(key);
  if (!a) {
    a = await attributeFiles(ws.id, head.files);
    attributions.set(key, a);
  }
  const people = await peopleOf(ws, [...a.byUser.keys()]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const shares: StoragePerson[] = people.map((p) => {
    const s = a.byUser.get(p.id) ?? { bytes: 0, files: 0, agentBytes: 0 };
    return { person: { id: p.id, name: p.name, email: p.email }, role: p.role, ...s };
  });
  // A writer whose account is gone has no person to show: their files are untracked.
  const untracked = { ...a.untracked };
  for (const [id, s] of a.byUser) {
    if (byId.has(id)) continue;
    untracked.bytes += s.bytes;
    untracked.files += s.files;
  }
  const rank = (r: StoragePerson['role']) => (r === 'owner' ? 0 : r === 'former' ? 2 : 1);
  shares.sort((x, y) => y.bytes - x.bytes || rank(x.role) - rank(y.role) || x.person.email.localeCompare(y.person.email));
  return {
    workspaceId: ws.id,
    name: ws.name,
    commitId: head.commitId,
    fileBytes: head.files.reduce((s, f) => s + f.size, 0),
    files: head.files.length,
    people: shares,
    untracked,
    partial: head.partial || a.partial,
  };
}

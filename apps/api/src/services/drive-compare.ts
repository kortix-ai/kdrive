// Added / removed / changed / moved paths between two versions of a drive.
// Owner: API-versioning. See architecture §9.2.
//
// Ledger first: when every surviving commit between the two points belongs
// to a committed action (and no action straddles either end), the ledger
// names the touched paths; each candidate is then stat'ed at both ends so the
// verdict is exact. Otherwise (external changes, huge ranges) both trees are
// listed and diffed by path, then (size, mtime); equal (size, mtime) pairs
// between a removed and an added path are reported as moves.

import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { CompareDriveResponse, DriveChange } from '@volumes/shared';
import { db } from '../db/client';
import { actionPaths, actions, type ActionRow } from '../db/schema';
import { getStore } from '../storage';
import type { Commit, FileEntry, FileStat, Ref } from '../storage/types';
import type { WorkspaceCtx } from '../types';
import { actionsByCommits } from './ledger';
import { listTree } from './tree';
import { ancestorsOf, cmpCommit, cmpCommitId, isUnder, mapLimit, statIfReadable, visibleHistory } from './versioning-util';

/** Above this many touched paths two tree listings are cheaper than two stats per path. */
const LEDGER_MAX_CANDIDATES = 500;

type EntryKind = 'file' | 'dir';
const kindOf = (t: string): EntryKind => (t === 'dir' ? 'dir' : 'file');

/** Added / removed / changed / moved paths between two versions (ledger, else tree diff). */
export async function compareDrive(ws: WorkspaceCtx, a: Ref, b: Ref): Promise<CompareDriveResponse> {
  const store = getStore();
  let [ca, cb] = await Promise.all([store.getCommit(ws.volumeId, a), store.getCommit(ws.volumeId, b)]);
  if (cmpCommit(ca, cb) > 0) [ca, cb] = [cb, ca];
  const base = { a: { commitId: ca.id, createdAt: ca.createdAt }, b: { commitId: cb.id, createdAt: cb.createdAt } };
  if (ca.id === cb.id) return { ...base, changes: [], source: 'ledger' };
  const fromLedger = await ledgerCompare(ws, ca, cb);
  if (fromLedger) return { ...base, changes: fromLedger, source: 'ledger' };
  return { ...base, changes: await treeCompare(ws, ca.id, cb.id), source: 'tree' };
}

// ── ledger ──────────────────────────────────────────────────────────────────

async function ledgerCompare(ws: WorkspaceCtx, ca: Commit, cb: Commit): Promise<DriveChange[] | null> {
  // Surviving commits in (a, b].
  const hist = await visibleHistory(ws.volumeId, { stopAt: (c) => cmpCommitId(c.id, ca.id) <= 0, maxPages: 25 });
  if (!hist.complete) return null;
  const inRange = hist.commits.filter((c) => cmpCommitId(c.id, ca.id) > 0 && cmpCommitId(c.id, cb.id) <= 0);
  const claimed = await actionsByCommits(
    ws.id,
    inRange.map((c) => c.id),
  );
  for (const c of inRange) {
    const act = claimed.get(c.id);
    if (!act || act.status !== 'committed') return null; // external or in-flight change
  }
  // Every committed action whose head lies in (a, b], including thinned ones.
  const acts: ActionRow[] = await db
    .select()
    .from(actions)
    .where(
      and(
        eq(actions.workspaceId, ws.id),
        eq(actions.status, 'committed'),
        isNotNull(actions.headCommitId),
        sql`${actions.headCommitId} COLLATE "C" > ${ca.id}`,
        sql`${actions.headCommitId} COLLATE "C" <= ${cb.id}`,
      ),
    );
  for (const act of claimed.values()) if (!acts.some((x) => x.id === act.id)) acts.push(act);
  // An action straddling either end means the ledger can't describe the range.
  for (const act of acts) {
    const ids = act.commitIds;
    if (ids.some((id) => cmpCommitId(id, ca.id) <= 0) || ids.some((id) => cmpCommitId(id, cb.id) > 0)) return null;
  }
  if (!acts.length) return [];
  acts.sort((x, y) => cmpCommitId(x.headCommitId!, y.headCommitId!));
  const order = new Map(acts.map((x, i) => [x.id, i]));
  const rows = await db
    .select()
    .from(actionPaths)
    .where(inArray(
      actionPaths.actionId,
      acts.map((x) => x.id),
    ))
    .orderBy(asc(actionPaths.id));
  rows.sort((x, y) => order.get(x.actionId)! - order.get(y.actionId)! || x.id - y.id);

  // Candidates + rename chains (destination → the path it had at `a`).
  const cands = new Set<string>();
  const origin = new Map<string, string>();
  for (const r of rows) {
    cands.add(r.path);
    if (r.fromPath) cands.add(r.fromPath);
    if (r.op === 'moved' && r.fromPath) {
      const src = origin.get(r.fromPath) ?? r.fromPath;
      origin.delete(r.fromPath);
      origin.set(r.path, src);
    }
    if (cands.size > LEDGER_MAX_CANDIDATES) return null;
  }
  for (const p of [...cands]) for (const anc of ancestorsOf(p)) cands.add(anc);
  cands.delete('/');
  if (cands.size > LEDGER_MAX_CANDIDATES) return null;

  const list = [...cands];
  const [statsA, statsB] = await Promise.all([
    mapLimit(list, 8, (p) => statIfReadable(ws.volumeId, p, ca.id)),
    mapLimit(list, 8, (p) => statIfReadable(ws.volumeId, p, cb.id)),
  ]);
  const A = new Map<string, FileStat>();
  const B = new Map<string, FileStat>();
  list.forEach((p, i) => {
    if (statsA[i]) A.set(p, statsA[i]!);
    if (statsB[i]) B.set(p, statsB[i]!);
  });

  const changes: DriveChange[] = [];
  const consumed = new Set<string>();
  for (const [dst, src] of origin) {
    const sB = B.get(dst);
    const sA = A.get(src);
    if (dst === src || !sB || A.has(dst) || !sA || B.has(src)) continue;
    changes.push({
      op: 'moved',
      path: dst,
      fromPath: src,
      type: kindOf(sB.type),
      ...(kindOf(sA.type) === 'file' ? { sizeA: sA.size } : {}),
      ...(kindOf(sB.type) === 'file' ? { sizeB: sB.size } : {}),
    });
    consumed.add(dst);
    consumed.add(src);
  }
  for (const p of list) {
    if (consumed.has(p)) continue;
    const sA = A.get(p);
    const sB = B.get(p);
    if (!sA && !sB) continue;
    if (sA && !sB) changes.push({ op: 'removed', path: p, type: kindOf(sA.type), ...(sA.type === 'file' ? { sizeA: sA.size } : {}) });
    else if (!sA && sB) changes.push({ op: 'added', path: p, type: kindOf(sB.type), ...(sB.type === 'file' ? { sizeB: sB.size } : {}) });
    else if (sA && sB) {
      if (kindOf(sA.type) !== kindOf(sB.type)) {
        changes.push({ op: 'removed', path: p, type: kindOf(sA.type), ...(sA.type === 'file' ? { sizeA: sA.size } : {}) });
        changes.push({ op: 'added', path: p, type: kindOf(sB.type), ...(sB.type === 'file' ? { sizeB: sB.size } : {}) });
      } else if (kindOf(sB.type) === 'file') {
        const differs = sA.version && sB.version ? sA.version !== sB.version : sA.size !== sB.size || sA.mtime !== sB.mtime;
        if (differs) changes.push({ op: 'changed', path: p, type: 'file', sizeA: sA.size, sizeB: sB.size });
      }
    }
  }
  return collapse(changes);
}

// ── tree ────────────────────────────────────────────────────────────────────

function dirSignature(root: string, entries: Map<string, FileEntry>): string {
  const parts: string[] = [];
  for (const [p, e] of entries) {
    if (isUnder(root, p)) parts.push(`${p.slice(root.length)}|${kindOf(e.type)}|${e.type === 'dir' ? 0 : e.size}|${e.type === 'dir' ? 0 : e.mtime}`);
  }
  return parts.sort().join('\n');
}

function dirBytes(root: string, entries: Map<string, FileEntry>): number {
  let n = 0;
  for (const [p, e] of entries) if (e.type !== 'dir' && isUnder(root, p)) n += e.size;
  return n;
}

async function treeCompare(ws: WorkspaceCtx, aId: string, bId: string): Promise<DriveChange[]> {
  const [ta, tb] = await Promise.all([listTree(ws, '/', aId), listTree(ws, '/', bId)]);
  const A = new Map(ta.entries.map((e) => [e.path, e]));
  const B = new Map(tb.entries.map((e) => [e.path, e]));

  const added: FileEntry[] = [];
  const removed: FileEntry[] = [];
  const changes: DriveChange[] = [];
  for (const [p, eb] of B) {
    const ea = A.get(p);
    if (!ea) added.push(eb);
    else if (kindOf(ea.type) !== kindOf(eb.type)) {
      removed.push(ea);
      added.push(eb);
    } else if (kindOf(eb.type) === 'file' && (ea.size !== eb.size || ea.mtime !== eb.mtime)) {
      changes.push({ op: 'changed', path: p, type: 'file', sizeA: ea.size, sizeB: eb.size });
    }
  }
  for (const [p, ea] of A) if (!B.has(p)) removed.push(ea);

  // Keep only top-most added / removed items (a new folder hides its contents).
  const topOf = (list: FileEntry[]) => {
    const dirs = list.filter((e) => e.type === 'dir').map((e) => e.path);
    return list.filter((e) => !dirs.some((d) => isUnder(d, e.path)));
  };
  let addTop = topOf(added);
  let remTop = topOf(removed);

  // Folder moves: identical contents under a different name.
  const remDirSig = new Map<string, FileEntry[]>();
  for (const e of remTop) if (e.type === 'dir') push(remDirSig, dirSignature(e.path, A), e);
  const addDirSig = new Map<string, FileEntry[]>();
  for (const e of addTop) if (e.type === 'dir') push(addDirSig, dirSignature(e.path, B), e);
  const movedPaths = new Set<string>();
  for (const [sig, rs] of remDirSig) {
    const as = addDirSig.get(sig);
    if (rs.length !== 1 || as?.length !== 1) continue;
    changes.push({ op: 'moved', path: as[0].path, fromPath: rs[0].path, type: 'dir', sizeA: dirBytes(rs[0].path, A), sizeB: dirBytes(as[0].path, B) });
    movedPaths.add(as[0].path);
    movedPaths.add(rs[0].path);
  }
  addTop = addTop.filter((e) => !movedPaths.has(e.path));
  remTop = remTop.filter((e) => !movedPaths.has(e.path));

  // File moves: a unique (size, mtime) pair between a removed and an added file.
  const key = (e: FileEntry) => `${e.size}:${e.mtime}`;
  const remByKey = new Map<string, FileEntry[]>();
  for (const e of remTop) if (e.type !== 'dir') push(remByKey, key(e), e);
  const addByKey = new Map<string, FileEntry[]>();
  for (const e of addTop) if (e.type !== 'dir') push(addByKey, key(e), e);
  for (const [k, rs] of remByKey) {
    const as = addByKey.get(k);
    if (rs.length !== 1 || as?.length !== 1) continue;
    changes.push({ op: 'moved', path: as[0].path, fromPath: rs[0].path, type: 'file', sizeA: rs[0].size, sizeB: as[0].size });
    movedPaths.add(as[0].path);
    movedPaths.add(rs[0].path);
  }
  for (const e of addTop) {
    if (movedPaths.has(e.path)) continue;
    changes.push({ op: 'added', path: e.path, type: kindOf(e.type), sizeB: e.type === 'dir' ? dirBytes(e.path, B) : e.size });
  }
  for (const e of remTop) {
    if (movedPaths.has(e.path)) continue;
    changes.push({ op: 'removed', path: e.path, type: kindOf(e.type), sizeA: e.type === 'dir' ? dirBytes(e.path, A) : e.size });
  }
  return collapse(changes);
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

/** Drops entries inside an added / removed / moved folder, then sorts by path. */
function collapse(changes: DriveChange[]): DriveChange[] {
  const roots: string[] = [];
  for (const c of changes) {
    if (c.type !== 'dir') continue;
    if (c.op === 'added' || c.op === 'removed' || c.op === 'moved') roots.push(c.path);
    if (c.op === 'moved' && c.fromPath) roots.push(c.fromPath);
  }
  const out = changes.filter((c) => !roots.some((r) => isUnder(r, c.path) || (c.fromPath ? isUnder(r, c.fromPath) : false)));
  return out.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : x.op < y.op ? -1 : 1));
}

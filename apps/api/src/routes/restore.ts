// Restore (file / folder / drive) and undo of any action.
// Owner: API-versioning (architecture §9.2).
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { EmptyBody, IdSchema, RestoreRequest, RestoreResponse, UndoResponse, type RestoreResponse as RestoreResponseT } from '@volumes/shared';
import { db } from '../db/client';
import { actionPaths, actions, type ActionRow } from '../db/schema';
import { audit } from '../lib/audit';
import { ApiError, ok, parseJson } from '../lib/http';
import { getAction } from '../services/ledger';
import { reattachLinks, unmoveLiveLinks } from '../services/links';
import { reconcileLostCommits } from '../services/lost-commits';
import { changedUnder, restoreDrive, restoreFileFrom, restorePaths, restoreSummary } from '../services/restore';
import { pathAtCommit } from '../services/versions';
import { statOrNull } from '../services/tree';
import { mapLimit, topMost } from '../services/versioning-util';
import { getStore } from '../storage';
import type { AppEnv, WorkspaceCtx } from '../types';

export const restoreRoutes = new Hono<AppEnv>();

/** POST /api/w/:ws/restore {scope, path?, at} — the restore is a new, undoable version. */
restoreRoutes.post('/restore', async (c) => {
  const req = await parseJson(c, RestoreRequest);
  const ws = c.get('ws');
  const user = c.get('user');
  const ctx = { ws, userId: user.id };

  if (req.scope === 'drive') {
    const r = await restoreDrive(ctx, req.at);
    await audit(c, {
      kind: 'restore.drive',
      userId: user.id,
      workspaceId: ws.id,
      target: '/',
      meta: { at: req.at, actionId: r.action.id, checkpointId: r.checkpoint?.id ?? null, checkpointSkipped: !!r.checkpointSkipped },
    });
    if (r.checkpoint) {
      await audit(c, {
        kind: 'checkpoint.create',
        userId: user.id,
        workspaceId: ws.id,
        target: r.checkpoint.id,
        meta: { name: r.checkpoint.name, auto: true },
      });
    }
    return ok(c, RestoreResponse, r);
  }

  const commit = await getStore().getCommit(ws.volumeId, req.at);
  if (req.paths?.length && !(req.paths.length === 1 && !req.path)) {
    // Several items to one version: ONE action, one timeline entry, one undo.
    const paths = [...new Set([...(req.path ? [req.path] : []), ...req.paths])];
    const action = await restorePaths(ctx, {
      paths,
      at: commit.id,
      kind: req.scope === 'file' ? 'restore.file' : 'restore.folder',
      summary: `Restored ${paths.length.toLocaleString('en-US')} items to an earlier version`,
    });
    await audit(c, { kind: 'restore.folder', userId: user.id, workspaceId: ws.id, target: paths[0], meta: { at: commit.id, actionId: action.id, scope: req.scope, paths: paths.slice(0, 50), count: paths.length } });
    return ok(c, RestoreResponse, { action } satisfies RestoreResponseT);
  }
  const path = req.path ?? req.paths![0];
  const then = await statOrNull(ws, path, commit.id);
  if (!then) {
    // A file renamed since: restore the version it had under its earlier name.
    const earlier = req.scope === 'file' ? await pathAtCommit(ws, path, commit.id) : null;
    const old = earlier && earlier !== path ? await statOrNull(ws, earlier, commit.id) : null;
    if (!old || old.type === 'dir') throw new ApiError(404, 'path_not_found', 'That item does not exist at this version.', { path });
    const action = await restoreFileFrom(ctx, { from: earlier!, to: path, at: commit.id, summary: restoreSummary(path, 'file') });
    await audit(c, { kind: 'restore.file', userId: user.id, workspaceId: ws.id, target: path, meta: { at: commit.id, actionId: action.id, scope: req.scope, from: earlier } });
    return ok(c, RestoreResponse, { action } satisfies RestoreResponseT);
  }
  const type = then.type === 'dir' ? 'dir' : 'file';
  const kind = type === 'dir' ? 'restore.folder' : 'restore.file';
  const action = await restorePaths(ctx, { paths: [path], at: commit.id, kind, summary: restoreSummary(path, type) });
  await audit(c, { kind, userId: user.id, workspaceId: ws.id, target: path, meta: { at: commit.id, actionId: action.id, scope: req.scope } });
  const body: RestoreResponseT = { action };
  return ok(c, RestoreResponse, body);
});

/** POST /api/w/:ws/actions/:id/undo — puts the action's paths back as they were before it (itself undoable). */
restoreRoutes.post('/actions/:id/undo', async (c) => {
  await parseJson(c, EmptyBody);
  const id = IdSchema.parse(c.req.param('id'));
  const ws = c.get('ws');
  const user = c.get('user');
  const ctx = { ws, userId: user.id };
  // A commit whose response was lost is recorded first: the ledger then shows what storage holds.
  await reconcileLostCommits(ws);
  const target = await getAction(ws.id, id);
  if (!target) throw new ApiError(404, 'not_found', 'No such change.');
  if (target.status !== 'committed' || !target.baseCommitId) {
    throw new ApiError(409, 'conflict', 'This change cannot be undone.');
  }
  const summary = `Undid: ${target.summary}`.slice(0, 500);
  const rows = await db
    .select({ op: actionPaths.op, path: actionPaths.path, fromPath: actionPaths.fromPath })
    .from(actionPaths)
    .where(eq(actionPaths.actionId, target.id))
    .orderBy(asc(actionPaths.id));
  // Checked up front, and again under the workspace lock when the head moved
  // in between, so a change landing meanwhile can never be overwritten.
  const checked = await assertNothingLater(ws, target, rows);
  const verify = async (head: string) => {
    if (head !== checked) await assertNothingLater(ws, target, rows, head);
  };
  let action;
  if (target.kind === 'restore.drive') {
    const r = await restoreDrive(ctx, target.baseCommitId, { undoOfActionId: target.id, autoCheckpoint: false, summary, verify });
    action = r.action;
  } else {
    // A move changed its source too, so its source goes back; a copy never touched its source.
    const paths = [...new Set(rows.flatMap((r) => (r.op === 'moved' && r.fromPath ? [r.path, r.fromPath] : [r.path])))];
    if (!paths.length) throw new ApiError(409, 'conflict', 'This change has nothing to undo.');
    action = await restorePaths(ctx, { paths, at: target.baseCommitId, kind: 'undo', summary, undoOfActionId: target.id, verify });
  }
  // Live links follow their items back: moved ones return to the old path, detached ones work again.
  if (action.status === 'committed') {
    for (const r of [...rows].reverse()) if (r.op === 'moved' && r.fromPath) await unmoveLiveLinks(ws.id, r.path, r.fromPath, action.id);
    await reattachLinks(ws.id, target.id);
  }
  await audit(c, { kind: 'undo', userId: user.id, workspaceId: ws.id, target: target.id, meta: { kind: target.kind, actionId: action.id, at: target.baseCommitId } });
  return ok(c, UndoResponse, { action });
});

/**
 * An undo puts the action's paths back as they were before it (its base), so
 * it would silently throw away anything anyone else wrote to those paths (or
 * inside them) since. What counts is storage, not the ledger: every stretch of
 * history between the base and the head that the action did not write itself
 * (before its first commit, between its commits, as when another action lands
 * between two plans of a multi-plan upload, and after its last) must leave
 * every path the undo touches unchanged, by content identity (version id, else
 * the bytes), never by size and time. A commit no action has claimed yet (a
 * lost response) counts like any other. Otherwise refuse with the paths that
 * changed, and the timeline restore shows the effects first. Returns the head
 * it checked against.
 */
async function assertNothingLater(
  ws: WorkspaceCtx,
  target: ActionRow,
  rows: { op: string; path: string; fromPath: string | null }[],
  head?: string,
): Promise<string> {
  // The head first: an action landing after this read moves it, so the caller re-checks.
  const now = head ?? (await getStore().getVolume(ws.volumeId)).headCommitId;
  const [undone] = await db
    .select({ id: actions.id })
    .from(actions)
    .where(and(eq(actions.workspaceId, ws.id), eq(actions.undoOfActionId, target.id), eq(actions.status, 'committed')))
    .limit(1);
  if (undone) throw new ApiError(409, 'conflict', 'This change was already undone.');
  const refuse = (paths: string[] = []) => {
    const shown = paths.slice(0, 3).join(', ');
    const more = paths.length > 3 ? ` and ${(paths.length - 3).toLocaleString('en-US')} more` : '';
    const what = paths.length ? ` (${shown}${more} changed since)` : '';
    return new ApiError(409, 'conflict', `Later changes would be lost${what}. Restore from the timeline instead.`, {
      paths: paths.slice(0, 50),
      count: paths.length,
    });
  };
  const runs = await foreignRuns(ws, target, now);
  if (!runs) throw refuse();
  if (!runs.length) return now;
  const roots =
    target.kind === 'restore.drive'
      ? ['/']
      : topMost([...new Set(rows.flatMap((r) => (r.op === 'moved' && r.fromPath ? [r.path, r.fromPath] : [r.path])))]);
  if (roots.length * runs.length > 500) throw refuse();
  const changed = new Set<string>();
  for (const [from, to] of runs) {
    for (const p of (await mapLimit(roots, 8, (r) => changedUnder(ws, r, from, to))).flat()) changed.add(p);
  }
  if (changed.size) throw refuse([...changed].sort());
  return now;
}

/** At most this many commits of one action are walked; beyond it the undo is refused. */
const MAX_OWN_COMMITS = 1000;

/**
 * The stretches [from, to] of history between the action's base and `now`
 * that other writers made: the action's own commits (on the head chain, in
 * order) cut the history into the parts before, between and after them. A
 * `merged` result's hidden side commit is skipped: its merge commit is the one
 * on the head chain. null when the history cannot be told apart.
 */
async function foreignRuns(ws: WorkspaceCtx, target: ActionRow, now: string): Promise<[string, string][] | null> {
  if (!target.baseCommitId || !target.commitIds.length || target.commitIds.length > MAX_OWN_COMMITS) return null;
  const store = getStore();
  const own = (await mapLimit(target.commitIds, 8, (id) => store.getCommit(ws.volumeId, id)))
    .filter((c) => c.onHead && c.kind !== 'side')
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.createdAt.localeCompare(b.createdAt));
  if (!own.length) return null;
  const runs: [string, string][] = [];
  let at = target.baseCommitId;
  for (const c of own) {
    if (!c.parentId) return null;
    if (c.parentId !== at) runs.push([at, c.parentId]);
    at = c.id;
  }
  if (now !== at) runs.push([at, now]);
  return runs;
}

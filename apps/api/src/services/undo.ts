// Undo of any action, as one service call shared by the web route and the
// agent tools: the same "nothing later" checks, ledger action, links and audit.
import { and, asc, eq } from 'drizzle-orm';
import type { ActionSummary } from '@volumes/shared';
import { db } from '../db/client';
import { actionPaths, actions, type ActionRow } from '../db/schema';
import { ApiError } from '../lib/http';
import { getStore } from '../storage';
import type { WorkspaceCtx } from '../types';
import { getAction } from './ledger';
import { reattachFollowers, unmoveFollowers } from './follow';
import { reconcileLostCommits } from './lost-commits';
import { changedUnder, restoreDrive, restorePaths } from './restore';
import { auditAs, type AuditedCtx } from './restore-request';
import { mapLimit, topMost } from './versioning-util';

/** Puts the action's paths back as they were before it (itself undoable). */
export async function undoAction(ctx: AuditedCtx, id: string): Promise<ActionSummary> {
  const { ws } = ctx;
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
  let action: ActionSummary;
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
    for (const r of [...rows].reverse()) if (r.op === 'moved' && r.fromPath) await unmoveFollowers(ws.id, r.path, r.fromPath, action.id);
    await reattachFollowers(ws.id, target.id);
  }
  await auditAs(ctx, { kind: 'undo', target: target.id, meta: { kind: target.kind, actionId: action.id, at: target.baseCommitId } });
  return action;
}

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
  const runs = await foreignRuns(ws, target.baseCommitId, target.commitIds, now);
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
 * The stretches [from, to] of history between `base` and `now` that other
 * writers made: `ownCommitIds` (on the head chain, in order) cut the history
 * into the parts before, between and after them. A `merged` result's hidden
 * side commit is skipped: its merge commit is the one on the head chain. null
 * when the history cannot be told apart.
 */
export async function foreignRuns(ws: WorkspaceCtx, base: string | null, ownCommitIds: string[], now: string): Promise<[string, string][] | null> {
  if (!base || !ownCommitIds.length || ownCommitIds.length > MAX_OWN_COMMITS) return null;
  const store = getStore();
  const own = (await mapLimit(ownCommitIds, 8, (id) => store.getCommit(ws.volumeId, id)))
    .filter((c) => c.onHead && c.kind !== 'side')
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.createdAt.localeCompare(b.createdAt));
  if (!own.length) return null;
  const runs: [string, string][] = [];
  let at = base;
  for (const c of own) {
    if (!c.parentId) return null;
    if (c.parentId !== at) runs.push([at, c.parentId]);
    at = c.id;
  }
  if (now !== at) runs.push([at, now]);
  return runs;
}

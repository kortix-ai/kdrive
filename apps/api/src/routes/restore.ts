// Restore (file / folder / drive) and undo of any action.
// Owner: API-versioning (architecture §9.2).
import { and, asc, eq, gt, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { EmptyBody, IdSchema, RestoreRequest, RestoreResponse, UndoResponse, type RestoreResponse as RestoreResponseT } from '@volumes/shared';
import { db } from '../db/client';
import { actionPaths, actions, type ActionRow } from '../db/schema';
import { audit } from '../lib/audit';
import { ApiError, ok, parseJson } from '../lib/http';
import { getAction } from '../services/ledger';
import { reattachLinks, unmoveLiveLinks } from '../services/links';
import { restoreDrive, restoreFileFrom, restorePaths, restoreSummary } from '../services/restore';
import { pathAtCommit } from '../services/versions';
import { listTree, statOrNull } from '../services/tree';
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
  await assertNothingLater(ws, target, rows);
  let action;
  if (target.kind === 'restore.drive') {
    const r = await restoreDrive(ctx, target.baseCommitId, { undoOfActionId: target.id, autoCheckpoint: false, summary });
    action = r.action;
  } else {
    // A move changed its source too, so its source goes back; a copy never touched its source.
    const paths = [...new Set(rows.flatMap((r) => (r.op === 'moved' && r.fromPath ? [r.path, r.fromPath] : [r.path])))];
    if (!paths.length) throw new ApiError(409, 'conflict', 'This change has nothing to undo.');
    action = await restorePaths(ctx, { paths, at: target.baseCommitId, kind: 'undo', summary, undoOfActionId: target.id });
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
 * An undo puts the action's paths back as they were before it, so it would
 * silently throw away anything done to those paths (or inside them) since.
 * When later actions exist, every path the undo touches must still look
 * exactly as the action left it (same files, sizes and times; same folder
 * contents); otherwise refuse, and the timeline restore shows the effects first.
 */
async function assertNothingLater(ws: WorkspaceCtx, target: ActionRow, rows: { op: string; path: string; fromPath: string | null }[]): Promise<void> {
  const later = await db
    .select({ id: actions.id, undoOf: actions.undoOfActionId })
    .from(actions)
    .where(
      and(
        eq(actions.workspaceId, ws.id),
        eq(actions.status, 'committed'),
        ne(actions.id, target.id),
        target.headCommitId ? sql`${actions.headCommitId} COLLATE "C" > ${target.headCommitId}` : gt(actions.createdAt, target.createdAt),
      ),
    );
  if (!later.length) return;
  if (later.some((a) => a.undoOf === target.id)) throw new ApiError(409, 'conflict', 'This change was already undone.');
  const refuse = () => new ApiError(409, 'conflict', 'Later changes would be lost. Restore from the timeline instead.');
  if (!target.headCommitId) throw refuse();
  const roots =
    target.kind === 'restore.drive'
      ? ['/']
      : topMost([...new Set(rows.flatMap((r) => (r.op === 'moved' && r.fromPath ? [r.path, r.fromPath] : [r.path])))]);
  if (roots.length > 500) throw refuse();
  const then = target.headCommitId;
  const same = await mapLimit(roots, 8, async (r) => (await signature(ws, r, then)) === (await signature(ws, r, undefined)));
  if (same.some((x) => !x)) throw refuse();
}

/** What an undo would overwrite under `root`: files by (size, mtime), folders by what they hold. */
async function signature(ws: WorkspaceCtx, root: string, at: string | undefined): Promise<string> {
  const st = await statOrNull(ws, root, at);
  if (!st) return 'none';
  if (st.type !== 'dir') return `f|${st.size}|${st.mtime}`;
  const { entries } = await listTree(ws, root, at);
  return (
    'd|' +
    entries
      .map((e) => `${e.path}|${e.type === 'dir' ? 'd' : `${e.size}|${e.mtime}`}`)
      .sort()
      .join('\n')
  );
}

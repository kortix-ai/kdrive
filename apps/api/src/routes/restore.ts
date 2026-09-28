// Restore (file / folder / drive) and undo of any action.
// Owner: API-versioning (architecture §9.2).
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { EmptyBody, IdSchema, RestoreRequest, RestoreResponse, UndoResponse, type RestoreResponse as RestoreResponseT } from '@volumes/shared';
import { db } from '../db/client';
import { actionPaths } from '../db/schema';
import { audit } from '../lib/audit';
import { ApiError, ok, parseJson } from '../lib/http';
import { getAction } from '../services/ledger';
import { restoreDrive, restorePaths, restoreSummary } from '../services/restore';
import { statOrNull } from '../services/tree';
import { getStore } from '../storage';
import type { AppEnv } from '../types';

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

  const path = req.path!;
  const commit = await getStore().getCommit(ws.volumeId, req.at);
  const then = await statOrNull(ws, path, commit.id);
  if (!then) throw new ApiError(404, 'path_not_found', 'That item does not exist at this version.', { path });
  const type = then.type === 'dir' ? 'dir' : 'file';
  const kind = type === 'dir' ? 'restore.folder' : 'restore.file';
  const action = await restorePaths(ctx, { paths: [path], at: commit.id, kind, summary: restoreSummary(path, type, commit.createdAt) });
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
  let action;
  if (target.kind === 'restore.drive') {
    const r = await restoreDrive(ctx, target.baseCommitId, { undoOfActionId: target.id, autoCheckpoint: false, summary });
    action = r.action;
  } else {
    const rows = await db
      .select({ path: actionPaths.path, fromPath: actionPaths.fromPath })
      .from(actionPaths)
      .where(eq(actionPaths.actionId, target.id))
      .orderBy(asc(actionPaths.id));
    const paths = [...new Set(rows.flatMap((r) => (r.fromPath ? [r.path, r.fromPath] : [r.path])))];
    if (!paths.length) throw new ApiError(409, 'conflict', 'This change has nothing to undo.');
    action = await restorePaths(ctx, { paths, at: target.baseCommitId, kind: 'undo', summary, undoOfActionId: target.id });
  }
  await audit(c, { kind: 'undo', userId: user.id, workspaceId: ws.id, target: target.id, meta: { kind: target.kind, actionId: action.id, at: target.baseCommitId } });
  return ok(c, UndoResponse, { action });
});

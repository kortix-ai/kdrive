// Restore (file / folder / drive) and undo of any action.
// Owner: API-versioning (architecture §9.2). The bodies live in
// services/restore-request.ts and services/undo.ts, shared with the agent tools.
import { Hono } from 'hono';
import { EmptyBody, IdSchema, RestoreRequest, RestoreResponse, UndoResponse } from '@volumes/shared';
import { ok, parseJson } from '../lib/http';
import { clientIp } from '../middleware/rate-limit';
import { runRestore } from '../services/restore-request';
import { undoAction } from '../services/undo';
import type { AppEnv } from '../types';

export const restoreRoutes = new Hono<AppEnv>();

/** POST /api/w/:ws/restore {scope, path?, at} — the restore is a new, undoable version. */
restoreRoutes.post('/restore', async (c) => {
  const req = await parseJson(c, RestoreRequest);
  const user = c.get('user');
  return ok(c, RestoreResponse, await runRestore({ ws: c.get('ws'), userId: user.id, email: user.email, ip: clientIp(c) }, req));
});

/** POST /api/w/:ws/actions/:id/undo — puts the action's paths back as they were before it (itself undoable). */
restoreRoutes.post('/actions/:id/undo', async (c) => {
  await parseJson(c, EmptyBody);
  const id = IdSchema.parse(c.req.param('id'));
  const user = c.get('user');
  const action = await undoAction({ ws: c.get('ws'), userId: user.id, email: user.email, ip: clientIp(c) }, id);
  return ok(c, UndoResponse, { action });
});

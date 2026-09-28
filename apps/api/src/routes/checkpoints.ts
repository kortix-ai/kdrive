// Checkpoints CRUD. Owner: API-versioning (architecture §9.2).
import { Hono } from 'hono';
import { CheckpointListResponse, CheckpointResponse, CreateCheckpointRequest, IdSchema, UpdateCheckpointRequest } from '@volumes/shared';
import { audit } from '../lib/audit';
import { noContent, ok, parseJson } from '../lib/http';
import { createCheckpoint, deleteCheckpoint, listCheckpoints, updateCheckpoint } from '../services/checkpoints';
import type { AppEnv } from '../types';

export const checkpointsRoutes = new Hono<AppEnv>();

/** GET /api/w/:ws/checkpoints — list (newest first) + the shared tag budget. */
checkpointsRoutes.get('/checkpoints', async (c) => ok(c, CheckpointListResponse, await listCheckpoints(c.get('ws'))));

/** POST /api/w/:ws/checkpoints {name, note?, at?} — tags the version (default head). */
checkpointsRoutes.post('/checkpoints', async (c) => {
  const body = await parseJson(c, CreateCheckpointRequest);
  const ws = c.get('ws');
  const user = c.get('user');
  const checkpoint = await createCheckpoint({ ws, userId: user.id }, { name: body.name, note: body.note, at: body.at });
  await audit(c, {
    kind: 'checkpoint.create',
    userId: user.id,
    workspaceId: ws.id,
    target: checkpoint.id,
    meta: { name: checkpoint.name, commitId: checkpoint.commitId },
  });
  return ok(c, CheckpointResponse, { checkpoint }, 201);
});

/** PATCH /api/w/:ws/checkpoints/:id {name?, note?} */
checkpointsRoutes.patch('/checkpoints/:id', async (c) => {
  const id = IdSchema.parse(c.req.param('id'));
  const body = await parseJson(c, UpdateCheckpointRequest);
  const ws = c.get('ws');
  const user = c.get('user');
  const { before, checkpoint } = await updateCheckpoint(ws, id, body);
  await audit(c, {
    kind: 'checkpoint.update',
    userId: user.id,
    workspaceId: ws.id,
    target: id,
    meta: { from: { name: before.name, note: before.note }, to: { name: checkpoint.name, note: checkpoint.note } },
  });
  return ok(c, CheckpointResponse, { checkpoint });
});

/** DELETE /api/w/:ws/checkpoints/:id — untags the version and forgets the checkpoint. */
checkpointsRoutes.delete('/checkpoints/:id', async (c) => {
  const id = IdSchema.parse(c.req.param('id'));
  const ws = c.get('ws');
  const user = c.get('user');
  const row = await deleteCheckpoint(ws, id);
  await audit(c, {
    kind: 'checkpoint.delete',
    userId: user.id,
    workspaceId: ws.id,
    target: id,
    meta: { name: row.name, commitId: row.commitId, auto: row.auto },
  });
  return noContent(c);
});

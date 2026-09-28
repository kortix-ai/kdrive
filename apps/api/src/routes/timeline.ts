// Timeline + single commit. Owner: API-versioning (architecture §9.2).
import { Hono } from 'hono';
import { CommitResponse, RefSchema, TimelineQuery, TimelineResponse } from '@volumes/shared';
import { ok, parseQuery } from '../lib/http';
import { actionsByCommits, toSummary } from '../services/ledger';
import { buildTimeline } from '../services/timeline';
import { getStore } from '../storage';
import type { AppEnv } from '../types';

export const timelineRoutes = new Hono<AppEnv>();

/** GET /api/w/:ws/timeline?limit&before — one entry per action, newest first. */
timelineRoutes.get('/timeline', async (c) => {
  const q = parseQuery(c, TimelineQuery);
  const ws = c.get('ws');
  return ok(c, TimelineResponse, await buildTimeline(ws, { limit: q.limit, before: q.before || undefined }));
});

/** GET /api/w/:ws/commits/:ref — one version (commit id, tag or head). */
timelineRoutes.get('/commits/:ref', async (c) => {
  const ref = RefSchema.parse(c.req.param('ref'));
  const ws = c.get('ws');
  const commit = await getStore().getCommit(ws.volumeId, ref);
  const byCommit = await actionsByCommits(ws.id, [commit.id]);
  const action = byCommit.get(commit.id);
  return ok(c, CommitResponse, {
    id: commit.id,
    createdAt: commit.createdAt,
    kind: commit.kind,
    logicalBytes: commit.logicalBytes,
    fileCount: commit.fileCount,
    tags: commit.tags,
    action: action ? toSummary(action) : null,
  });
});

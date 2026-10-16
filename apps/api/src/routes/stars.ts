// Starred and Recent: per person, across every drive they can open. Mounted at /api
// (not /api/w/:ws), so a viewer can star and record opens: neither changes the drive.
import { Hono } from 'hono';
import {
  DriveStarsResponse,
  RecentListResponse,
  RecentQuery,
  RecordOpenRequest,
  SetStarsRequest,
  StarredListResponse,
} from '@volumes/shared';
import { ApiError, noContent, ok, parseJson, parseQuery } from '../lib/http';
import { getWorkspaceAccess } from '../services/members';
import { listRecent, recordOpen } from '../services/recent';
import { driveStars, listStarred, setStars } from '../services/stars';
import type { AppEnv, WorkspaceCtx } from '../types';

const WS_ID = /^[0-9a-z]{26}$/;

/** A drive the session user owns or is a member of (any role), else 404 like everywhere else. */
async function driveFor(userId: string, wsId: string): Promise<WorkspaceCtx> {
  const ws = WS_ID.test(wsId) ? await getWorkspaceAccess(userId, wsId) : null;
  if (!ws) throw new ApiError(404, 'not_found', 'Workspace not found.');
  return ws;
}

export const starsRoutes = new Hono<AppEnv>();

/** GET /api/stars: everything the user starred in drives they can still open. */
starsRoutes.get('/stars', async (c) => ok(c, StarredListResponse, { items: await listStarred(c.get('user').id) }));

/** POST /api/stars { workspaceId, paths, starred }: answers with the drive's starred paths. */
starsRoutes.post('/stars', async (c) => {
  const req = await parseJson(c, SetStarsRequest);
  const userId = c.get('user').id;
  const ws = await driveFor(userId, req.workspaceId);
  return ok(c, DriveStarsResponse, { paths: await setStars(userId, ws, req.paths, req.starred) });
});

/** GET /api/recent?limit: files the user opened or changed, newest first. */
starsRoutes.get('/recent', async (c) => {
  const q = parseQuery(c, RecentQuery);
  return ok(c, RecentListResponse, { items: await listRecent(c.get('user').id, q.limit) });
});

/** POST /api/recent/opened { workspaceId, path }: the user previewed or downloaded a file. */
starsRoutes.post('/recent/opened', async (c) => {
  const req = await parseJson(c, RecordOpenRequest);
  const userId = c.get('user').id;
  await recordOpen(userId, await driveFor(userId, req.workspaceId), req.path);
  return noContent(c);
});

/** GET /api/w/:ws/stars: the user's starred paths in one drive (the stars on rows and tiles). */
export const driveStarsRoutes = new Hono<AppEnv>();

driveStarsRoutes.get('/stars', async (c) => ok(c, DriveStarsResponse, { paths: await driveStars(c.get('user').id, c.get('ws').id) }));

// File versions and compare (file / drive). Owner: API-versioning (architecture §9.2).
import { Hono } from 'hono';
import { CompareDriveQuery, CompareDriveResponse, CompareFileQuery, CompareFileResponse, VersionsQuery, VersionsResponse } from '@volumes/shared';
import { ok, parseQuery } from '../lib/http';
import { compareDrive } from '../services/drive-compare';
import { compareFile, fileVersions } from '../services/versions';
import type { AppEnv } from '../types';

export const versionsRoutes = new Hono<AppEnv>();

/** GET /api/w/:ws/versions?path — every version of a file still in history. */
versionsRoutes.get('/versions', async (c) => {
  const q = parseQuery(c, VersionsQuery);
  return ok(c, VersionsResponse, await fileVersions(c.get('ws'), q.path));
});

/** GET /api/w/:ws/compare/file?path&a&b — both sides' facts + content URLs (the diff runs in the browser). */
versionsRoutes.get('/compare/file', async (c) => {
  const q = parseQuery(c, CompareFileQuery);
  return ok(c, CompareFileResponse, await compareFile(c.get('ws'), q.path, q.a, q.b));
});

/** GET /api/w/:ws/compare/drive?a&b — added / removed / changed / moved between two versions. */
versionsRoutes.get('/compare/drive', async (c) => {
  const q = parseQuery(c, CompareDriveQuery);
  return ok(c, CompareDriveResponse, await compareDrive(c.get('ws'), q.a, q.b));
});

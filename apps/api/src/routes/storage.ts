import { Hono } from 'hono';
import { StorageOverviewResponse, StoragePeopleResponse } from '@volumes/shared';
import { ok } from '../lib/http';
import { storageOverview, storagePeople } from '../services/storage-insights';
import type { AppEnv } from '../types';

/** GET /api/me/storage: the signed-in user's own drives by kind of file, their largest files and recent history. */
export const meStorageRoutes = new Hono<AppEnv>();

meStorageRoutes.get('/me/storage', async (c) => ok(c, StorageOverviewResponse, await storageOverview(c.get('user').id)));

/** GET /api/w/:ws/storage/people: each person's share of the drive's current files (any member may read it). */
export const driveStorageRoutes = new Hono<AppEnv>();

driveStorageRoutes.get('/storage/people', async (c) => ok(c, StoragePeopleResponse, await storagePeople(c.get('ws'))));

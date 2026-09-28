// STUB (FOUNDATION). Owner: API-versioning. Replace the handlers; keep the export name and route paths.
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { stub } from './_stub';

export const versionsRoutes = new Hono<AppEnv>();

versionsRoutes.get('/versions', stub);
versionsRoutes.get('/compare/file', stub);
versionsRoutes.get('/compare/drive', stub);

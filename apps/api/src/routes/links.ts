// STUB (FOUNDATION). Owner: API-sharing-workspaces-admin. Replace the handlers; keep the export name and route paths.
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { stub } from './_stub';

export const linksRoutes = new Hono<AppEnv>();

linksRoutes.get('/links', stub);
linksRoutes.post('/links', stub);
linksRoutes.patch('/links/:id', stub);
linksRoutes.delete('/links/:id', stub);

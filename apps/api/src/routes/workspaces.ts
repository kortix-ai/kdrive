// STUB (FOUNDATION). Owner: API-sharing-workspaces-admin. Replace the handlers; keep the export name and route paths.
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { stub } from './_stub';

export const workspacesRoutes = new Hono<AppEnv>();

workspacesRoutes.get('/', stub);
workspacesRoutes.post('/', stub);
workspacesRoutes.patch('/:id', stub);
workspacesRoutes.delete('/:id', stub);
workspacesRoutes.post('/:id/duplicate', stub);

// STUB (FOUNDATION). Owner: API-sharing-workspaces-admin. Replace the handlers; keep the export name and route paths.
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { stub } from './_stub';

export const accountRoutes = new Hono<AppEnv>();

accountRoutes.delete('/me', stub);
accountRoutes.get('/me/audit', stub);

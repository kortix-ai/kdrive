// STUB (FOUNDATION). Owner: API-sharing-workspaces-admin. Replace the handlers; keep the export name and route paths.
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { stub } from './_stub';

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.get('/users', stub);
adminRoutes.put('/users/:id/quota', stub);
adminRoutes.get('/audit', stub);

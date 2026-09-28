// STUB (FOUNDATION). Owner: API-versioning. Replace the handlers; keep the export name and route paths.
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { stub } from './_stub';

export const restoreRoutes = new Hono<AppEnv>();

restoreRoutes.post('/restore', stub);
restoreRoutes.post('/actions/:id/undo', stub);

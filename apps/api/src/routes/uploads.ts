// STUB (FOUNDATION). Owner: API-files. Replace the handlers; keep the export name and route paths.
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { stub } from './_stub';

export const uploadsRoutes = new Hono<AppEnv>();

uploadsRoutes.post('/uploads', stub);
uploadsRoutes.put('/uploads/:id/blocks/:sha', stub);
uploadsRoutes.post('/uploads/:id/commit', stub);
uploadsRoutes.delete('/uploads/:id', stub);

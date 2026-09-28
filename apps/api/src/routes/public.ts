// STUB (FOUNDATION). Owner: API-sharing-workspaces-admin. Replace the handlers; keep the export name and route paths.
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { stub } from './_stub';

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get('/s/:token', stub);
publicRoutes.get('/s/:token/files', stub);
publicRoutes.get('/s/:token/content', stub);
publicRoutes.get('/s/:token/zip', stub);

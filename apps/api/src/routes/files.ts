// STUB (FOUNDATION). Owner: API-files. Replace the handlers; keep the export name and route paths.
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { stub } from './_stub';

export const filesRoutes = new Hono<AppEnv>();

filesRoutes.get('/files', stub);
filesRoutes.get('/files/stat', stub);
filesRoutes.get('/files/content', stub);
filesRoutes.get('/files/zip', stub);
filesRoutes.post('/folders', stub);
filesRoutes.post('/files/move', stub);
filesRoutes.post('/files/copy', stub);
filesRoutes.post('/files/delete', stub);
filesRoutes.get('/search', stub);

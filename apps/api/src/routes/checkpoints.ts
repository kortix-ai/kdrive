// STUB (FOUNDATION). Owner: API-versioning. Replace the handlers; keep the export name and route paths.
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { stub } from './_stub';

export const checkpointsRoutes = new Hono<AppEnv>();

checkpointsRoutes.get('/checkpoints', stub);
checkpointsRoutes.post('/checkpoints', stub);
checkpointsRoutes.patch('/checkpoints/:id', stub);
checkpointsRoutes.delete('/checkpoints/:id', stub);

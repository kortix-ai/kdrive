// STUB (FOUNDATION). Owner: API-versioning. Replace the handlers; keep the export name and route paths.
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { stub } from './_stub';

export const timelineRoutes = new Hono<AppEnv>();

timelineRoutes.get('/timeline', stub);
timelineRoutes.get('/commits/:ref', stub);

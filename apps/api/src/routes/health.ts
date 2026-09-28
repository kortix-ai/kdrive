import { Hono } from 'hono';
import { HealthResponse } from '@volumes/shared';
import { ok } from '../lib/http';
import { storageMode } from '../storage';
import type { AppEnv } from '../types';

export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get('/health', (c) => ok(c, HealthResponse, { ok: true, storageMode: storageMode() }));

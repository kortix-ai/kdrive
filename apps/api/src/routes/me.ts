import { Hono } from 'hono';
import { ConfigResponse, MeResponse, RETENTION_COPY, UsageResponse } from '@volumes/shared';
import { MCP_RESOURCE } from '../agents/urls';
import { env, isAdminEmail } from '../env';
import { ok } from '../lib/http';
import { requireUser } from '../middleware/session';
import { getUsage } from '../services/quota';
import { ensureUserBootstrap, listWorkspaces, toWorkspaceSummaries } from '../services/workspaces';
import { storageMode } from '../storage';
import type { AppEnv } from '../types';

/** GET /api/config, GET /api/me, GET /api/me/usage (FOUNDATION). */
export const meRoutes = new Hono<AppEnv>();

meRoutes.get('/config', (c) =>
  ok(c, ConfigResponse, {
    providers: env.providers,
    devLogin: env.devLoginEnabled,
    storageMode: storageMode(),
    retentionCopy: RETENTION_COPY,
    mcp: { enabled: env.mcpEnabled, url: MCP_RESOURCE },
  }),
);

meRoutes.get('/me', requireUser, async (c) => {
  const user = c.get('user');
  // Heals a failed first-sign-in hook: bootstrap is idempotent.
  const def = await ensureUserBootstrap(user);
  const [rows, usage] = await Promise.all([listWorkspaces(user.id), getUsage(user.id)]);
  const workspaces = await toWorkspaceSummaries(rows);
  return ok(c, MeResponse, {
    user: { id: user.id, email: user.email, name: user.name, image: user.image },
    isAdmin: isAdminEmail(user.email),
    defaultWorkspaceId: def.id,
    workspaces,
    usage,
  });
});

meRoutes.get('/me/usage', requireUser, async (c) => ok(c, UsageResponse, await getUsage(c.get('user').id)));

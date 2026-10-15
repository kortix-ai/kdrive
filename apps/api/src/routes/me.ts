import { Hono } from 'hono';
import { ConfigResponse, MeResponse, RETENTION_COPY, UsageResponse } from '@volumes/shared';
import { MCP_RESOURCE } from '../agents/urls';
import { env } from '../env';
import { emailEnabled } from '../email/client';
import { ok } from '../lib/http';
import { requireUser } from '../middleware/session';
import { isAdminUser } from '../services/admins';
import { publicBilling } from '../services/billing-config';
import { getUsage } from '../services/quota';
import { listSharedWorkspaceSummaries } from '../services/members';
import { ensureUserBootstrap, listWorkspaces, toWorkspaceSummaries } from '../services/workspaces';
import { storageMode } from '../storage';
import type { AppEnv } from '../types';

/** GET /api/config, GET /api/me, GET /api/me/usage (FOUNDATION). */
export const meRoutes = new Hono<AppEnv>();

meRoutes.get('/config', async (c) =>
  ok(c, ConfigResponse, {
    providers: env.providers,
    devLogin: env.devLoginEnabled,
    emailPassword: env.emailPassword,
    passwordReset: env.emailPassword && env.emailLinks,
    emailVerification: env.emailLinks,
    requireEmailVerification: env.requireEmailVerification,
    signupMode: env.signupMode,
    email: { enabled: emailEnabled() },
    storageMode: storageMode(),
    retentionCopy: RETENTION_COPY,
    mcp: { enabled: env.mcpEnabled, url: MCP_RESOURCE },
    billing: await publicBilling(),
  }),
);

meRoutes.get('/me', requireUser, async (c) => {
  const user = c.get('user');
  // The only place a drive is provisioned (idempotent, so it also heals a failed earlier
  // call). Sign-up itself never provisions one: that keeps a throwaway address from costing
  // a storage volume and keeps sign-up equally fast for new and taken addresses. A user held
  // for verification gets no drive until the address is confirmed.
  const held = env.requireEmailVerification && user.emailVerified === false;
  const def = held ? null : await ensureUserBootstrap(user);
  const [rows, shared, usage, isAdmin] = await Promise.all([
    held ? [] : listWorkspaces(user.id),
    held ? [] : listSharedWorkspaceSummaries(user.id),
    getUsage(user.id),
    isAdminUser(user),
  ]);
  // Own drives first, then drives other people shared (their bytes count against their owners, not here).
  const workspaces = [...(await toWorkspaceSummaries(rows)), ...shared];
  return ok(c, MeResponse, {
    user: { id: user.id, email: user.email, name: user.name, image: user.image, emailVerified: user.emailVerified !== false },
    isAdmin,
    defaultWorkspaceId: def?.id ?? null,
    workspaces,
    usage,
  });
});

meRoutes.get('/me/usage', requireUser, async (c) => ok(c, UsageResponse, await getUsage(c.get('user').id)));

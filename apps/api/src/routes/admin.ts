import { Hono } from 'hono';
import { AdminAuditQuery, AdminUserResponse, AdminUsersQuery, AdminUsersResponse, AuditListResponse, formatBytes, SetQuotaRequest } from '@volumes/shared';
import { getStore } from '../storage';
import { ok, parseJson, parseQuery } from '../lib/http';
import { listAuditEvents } from '../services/account';
import { adminListUsers, adminSetQuota } from '../services/workspace-admin';
import type { AppEnv } from '../types';

/** /api/admin/* (app.ts gates it with requireAdmin: emails in VOLUMES_ADMIN_EMAILS). */
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.get('/users', async (c) => {
  const q = parseQuery(c, AdminUsersQuery);
  const [users, cap] = await Promise.all([adminListUsers(q.q || undefined), workspaceCap()]);
  return ok(c, AdminUsersResponse, { users, ...(cap ? { workspaceCapBytes: cap } : {}) });
});

adminRoutes.put('/users/:id/quota', async (c) => {
  const req = await parseJson(c, SetQuotaRequest);
  const user = await adminSetQuota(c, c.get('user'), c.req.param('id'), req.quotaBytes);
  const cap = await workspaceCap();
  const warning =
    cap && req.quotaBytes > cap
      ? `Storage caps one workspace at ${formatBytes(cap)}: the quota can only be used in full across several workspaces.`
      : undefined;
  return ok(c, AdminUserResponse, { user, ...(warning ? { warning } : {}) });
});

/** The storage tier's per-volume size cap (null when storage cannot say). */
async function workspaceCap(): Promise<number | null> {
  try {
    return (await getStore().limits()).maxBytesPerVolume;
  } catch {
    return null;
  }
}

adminRoutes.get('/audit', async (c) => {
  const q = parseQuery(c, AdminAuditQuery);
  return ok(c, AuditListResponse, await listAuditEvents({ userId: q.userId, kind: q.kind, before: q.before, limit: q.limit }));
});

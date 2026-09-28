import { Hono } from 'hono';
import { AdminAuditQuery, AdminUserResponse, AdminUsersQuery, AdminUsersResponse, AuditListResponse, SetQuotaRequest } from '@volumes/shared';
import { ok, parseJson, parseQuery } from '../lib/http';
import { listAuditEvents } from '../services/account';
import { adminListUsers, adminSetQuota } from '../services/workspace-admin';
import type { AppEnv } from '../types';

/** /api/admin/* (app.ts gates it with requireAdmin: emails in VOLUMES_ADMIN_EMAILS). */
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.get('/users', async (c) => {
  const q = parseQuery(c, AdminUsersQuery);
  return ok(c, AdminUsersResponse, { users: await adminListUsers(q.q || undefined) });
});

adminRoutes.put('/users/:id/quota', async (c) => {
  const req = await parseJson(c, SetQuotaRequest);
  const user = await adminSetQuota(c, c.get('user'), c.req.param('id'), req.quotaBytes);
  return ok(c, AdminUserResponse, { user });
});

adminRoutes.get('/audit', async (c) => {
  const q = parseQuery(c, AdminAuditQuery);
  return ok(c, AuditListResponse, await listAuditEvents({ userId: q.userId, kind: q.kind, before: q.before, limit: q.limit }));
});

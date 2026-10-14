import { Hono } from 'hono';
import {
  AddAdminRequest,
  AdminAuditFilter,
  AdminAuditListResponse,
  AdminAuditQuery,
  AdminDomainsResponse,
  AdminEntryResponse,
  AdminListResponse,
  AdminOverviewResponse,
  AdminStorageRequestResponse,
  AdminStorageRequestsQuery,
  AdminStorageRequestsResponse,
  AdminUserDetailResponse,
  AdminUserResponse,
  AdminUsersQuery,
  AdminUsersResponse,
  formatBytes,
  SetQuotaRequest,
} from '@volumes/shared';
import { getStore } from '../storage';
import { ok, parseJson, parseQuery } from '../lib/http';
import { adminAuditCsv, listAdminAudit } from '../services/admin-audit';
import { adminDomains, adminListUsers, adminOverview, adminSetQuota, adminUserDetail } from '../services/admin-panel';
import { addAdmin, listAdmins, removeAdmin } from '../services/admins';
import { adminDismissStorageRequest, adminGrantStorageRequest, adminListStorageRequests } from '../services/storage-requests';
import type { AppEnv } from '../types';

/** /api/admin/* (app.ts gates it with requireAdmin: verified addresses in the `admins` table). */
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.get('/overview', async (c) => ok(c, AdminOverviewResponse, await adminOverview()));

adminRoutes.get('/users', async (c) => {
  const q = parseQuery(c, AdminUsersQuery);
  const [{ users, total }, cap] = await Promise.all([
    adminListUsers({ q: q.q || undefined, sort: q.sort, dir: q.dir, page: q.page, limit: q.limit }),
    workspaceCap(),
  ]);
  return ok(c, AdminUsersResponse, { users, total, page: q.page, limit: q.limit, ...(cap ? { workspaceCapBytes: cap } : {}) });
});

adminRoutes.get('/users/:id', async (c) => {
  const [detail, cap] = await Promise.all([adminUserDetail(c.req.param('id')), workspaceCap()]);
  return ok(c, AdminUserDetailResponse, { ...detail, ...(cap ? { workspaceCapBytes: cap } : {}) });
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

adminRoutes.get('/domains', async (c) => ok(c, AdminDomainsResponse, { domains: await adminDomains() }));

adminRoutes.get('/audit', async (c) => {
  const q = parseQuery(c, AdminAuditQuery);
  return ok(c, AdminAuditListResponse, await listAdminAudit(q));
});

/** The audit log under the same filters as a CSV download (newest first, capped; see AUDIT_CSV_MAX). */
adminRoutes.get('/audit.csv', async (c) => {
  const f = parseQuery(c, AdminAuditFilter);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return c.body(await adminAuditCsv(f), 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="kdrive-audit-${stamp}.csv"`,
    'cache-control': 'no-store',
  });
});

adminRoutes.get('/admins', async (c) => ok(c, AdminListResponse, { admins: await listAdmins() }));

adminRoutes.post('/admins', async (c) => {
  const req = await parseJson(c, AddAdminRequest);
  return ok(c, AdminEntryResponse, { admin: await addAdmin(c, c.get('user'), req.email) }, 201);
});

adminRoutes.delete('/admins/:email', async (c) => {
  await removeAdmin(c, c.get('user'), c.req.param('email'));
  return c.body(null, 204);
});

adminRoutes.get('/storage-requests', async (c) => {
  const q = parseQuery(c, AdminStorageRequestsQuery);
  return ok(c, AdminStorageRequestsResponse, { requests: await adminListStorageRequests(q.status) });
});

adminRoutes.post('/storage-requests/:id/grant', async (c) =>
  ok(c, AdminStorageRequestResponse, { request: await adminGrantStorageRequest(c, c.get('user'), c.req.param('id')) }),
);

adminRoutes.post('/storage-requests/:id/dismiss', async (c) =>
  ok(c, AdminStorageRequestResponse, { request: await adminDismissStorageRequest(c, c.get('user'), c.req.param('id')) }),
);

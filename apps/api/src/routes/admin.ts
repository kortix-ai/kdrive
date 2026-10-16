import { Hono } from 'hono';
import {
  AddAdminRequest,
  AdminAuditFilter,
  AdminAuditListResponse,
  AdminAuditQuery,
  AdminBillingResponse,
  AdminDomainsResponse,
  AdminDrivesQuery,
  AdminDrivesResponse,
  AdminEntryResponse,
  AdminListResponse,
  AdminLogsQuery,
  AdminLogsResponse,
  AdminOverviewResponse,
  AdminSessionResponse,
  AdminSettingsResponse,
  AdminStorageRequestResponse,
  AdminStorageRequestsQuery,
  AdminStorageRequestsResponse,
  AdminUserDetailResponse,
  AdminUserResponse,
  AdminUsersQuery,
  AdminUsersResponse,
  formatBytes,
  SetBillingKeyRequest,
  SetBillingPricesRequest,
  SetBillingWebhookSecretRequest,
  SetQuotaRequest,
} from '@volumes/shared';
import { getStore } from '../storage';
import { ok, parseJson, parseQuery } from '../lib/http';
import { adminAuditCsv, listAdminAudit } from '../services/admin-audit';
import { readServerLog } from '../lib/server-log';
import { adminDomains, adminListDrives, adminListUsers, adminOverview, adminSetQuota, adminUserDetail } from '../services/admin-panel';
import { adminSettings } from '../services/admin-settings';
import { addAdmin, adminSource, listAdmins, removeAdmin } from '../services/admins';
import {
  adminBillingView,
  adminDisconnect,
  adminRetryWebhook,
  adminSetKey,
  adminSetPrices,
  adminSetWebhookSecret,
} from '../services/billing-config';
import { adminDismissStorageRequest, adminGrantStorageRequest, adminListStorageRequests } from '../services/storage-requests';
import type { AppEnv } from '../types';

/**
 * /api/admin/* (app.ts gates it with requireAdmin: verified addresses in VOLUMES_ADMIN_EMAILS or
 * the `admins` table; everyone else gets the 404 of a route that does not exist).
 */
export const adminRoutes = new Hono<AppEnv>();

/** Who is signed in to the admin console (the web app's server-side gate calls it first). */
adminRoutes.get('/session', async (c) => {
  const u = c.get('user');
  return ok(c, AdminSessionResponse, { user: { id: u.id, email: u.email, name: u.name, image: u.image }, source: adminSource(u.email) });
});

adminRoutes.get('/drives', async (c) => {
  const q = parseQuery(c, AdminDrivesQuery);
  const { drives, total } = await adminListDrives({ q: q.q || undefined, sort: q.sort, dir: q.dir, page: q.page, limit: q.limit });
  return ok(c, AdminDrivesResponse, { drives, total, page: q.page, limit: q.limit });
});

/** The API's recent warnings, errors and 5xx answers (in memory, redacted). */
adminRoutes.get('/logs', async (c) => {
  const q = parseQuery(c, AdminLogsQuery);
  return ok(c, AdminLogsResponse, readServerLog(q));
});

adminRoutes.get('/settings', async (c) => ok(c, AdminSettingsResponse, await adminSettings()));

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

// ── billing (Stripe): one key and two prices; KDRIVE sets up the rest. Responses never carry a secret. ──

adminRoutes.get('/billing', async (c) => ok(c, AdminBillingResponse, await adminBillingView()));

adminRoutes.put('/billing/key', async (c) => {
  const req = await parseJson(c, SetBillingKeyRequest);
  return ok(c, AdminBillingResponse, await adminSetKey(c, c.get('user'), req.secretKey));
});

adminRoutes.put('/billing/prices', async (c) => {
  const req = await parseJson(c, SetBillingPricesRequest);
  return ok(c, AdminBillingResponse, await adminSetPrices(c, c.get('user'), req));
});

adminRoutes.put('/billing/webhook-secret', async (c) => {
  const req = await parseJson(c, SetBillingWebhookSecretRequest);
  return ok(c, AdminBillingResponse, await adminSetWebhookSecret(c, c.get('user'), req.webhookSecret));
});

adminRoutes.post('/billing/webhook', async (c) => ok(c, AdminBillingResponse, await adminRetryWebhook(c, c.get('user'))));

adminRoutes.delete('/billing', async (c) => ok(c, AdminBillingResponse, await adminDisconnect(c, c.get('user'))));

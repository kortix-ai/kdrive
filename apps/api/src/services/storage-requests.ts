// Storage requests: how a person gets a paid plan's storage while there is no
// billing (or alongside it, for plans an admin hands out). One open request per
// user; asking again updates it. Admins are mailed in the background and grant
// (the quota becomes the plan's size) or dismiss it from the Admin page.

import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Context } from 'hono';
import {
  MAX_QUOTA_BYTES,
  planById,
  type AdminStorageRequest,
  type CreateStorageRequest,
  type StorageRequest,
} from '@volumes/shared';
import { appUrl } from '../auth/policy';
import { db } from '../db/client';
import { bauthUser, storageRequests, type StorageRequestRow } from '../db/schema';
import { sendInBackground } from '../email/client';
import { renderStorageGranted } from '../email/templates/storage-granted';
import { renderStorageRequest } from '../email/templates/storage-request';
import { audit } from '../lib/audit';
import { ApiError } from '../lib/http';
import { newId } from '../lib/ids';
import { checkRateLimitKey, limits } from '../middleware/rate-limit';
import type { SessionUser } from '../types';
import { adminEmails } from './admins';
import { subscriptionsFor } from './billing';
import { getQuotaBytes } from './quota';
import { adminGetUser, adminSetQuota } from './admin-panel';
import { mapLimit } from './workspace-admin';

const REQ_ID = /^[0-9a-z]{26}$/;

export function toStorageRequest(r: StorageRequestRow): StorageRequest {
  return {
    id: r.id,
    plan: r.plan,
    note: r.note,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
  };
}

/** The user's latest request: the open one, else the last one an admin answered. */
export async function getMyStorageRequest(userId: string): Promise<StorageRequest | null> {
  const [row] = await db.select().from(storageRequests).where(eq(storageRequests.userId, userId)).orderBy(desc(storageRequests.createdAt)).limit(1);
  return row ? toStorageRequest(row) : null;
}

/**
 * POST /api/me/storage-requests. Refuses a plan the user already has; otherwise opens a
 * request, or updates the open one (plan, note, date). Admins hear about it by email when
 * the plan is new or changed.
 */
export async function requestStorage(c: Context | null, user: SessionUser, input: CreateStorageRequest): Promise<{ request: StorageRequest; created: boolean }> {
  checkRateLimitKey(limits.storageRequest, user.id);
  const plan = planById(input.plan);
  const quota = await getQuotaBytes(user.id);
  if (quota >= plan.storageBytes) {
    throw new ApiError(409, 'conflict', `You already have ${plan.name}'s storage or more.`);
  }
  const note = input.note?.trim() || null;
  const [before] = await db
    .select({ plan: storageRequests.plan })
    .from(storageRequests)
    .where(and(eq(storageRequests.userId, user.id), eq(storageRequests.status, 'open')));
  const [row] = await db
    .insert(storageRequests)
    .values({ id: newId(), userId: user.id, plan: input.plan, note })
    .onConflictDoUpdate({
      target: storageRequests.userId,
      targetWhere: eq(storageRequests.status, 'open'),
      set: { plan: input.plan, note, createdAt: new Date() },
    })
    .returning();
  const created = !before;
  if (!before || before.plan !== input.plan) await notifyAdmins(user, row, quota);
  await audit(c, { kind: 'storage.request', userId: user.id, target: plan.name, meta: { plan: input.plan, requestId: row.id } });
  return { request: toStorageRequest(row), created };
}

async function notifyAdmins(user: SessionUser, row: StorageRequestRow, quotaBytes: number): Promise<void> {
  const url = appUrl('/admin?tab=requests');
  for (const to of await adminEmails()) {
    const mail = renderStorageRequest({
      email: to,
      requester: { email: user.email, name: user.name },
      plan: planById(row.plan),
      note: row.note,
      quotaBytes,
      url,
    });
    sendInBackground({ to, ...mail, category: 'storage-request', links: [url] });
  }
}

// ── admin ────────────────────────────────────────────────────────────────────

export const ADMIN_REQUESTS_MAX = 200;

async function toAdminRequests(rows: StorageRequestRow[]): Promise<AdminStorageRequest[]> {
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const [users, subs] = await Promise.all([mapLimit(userIds, 8, (id) => adminGetUser(id)), subscriptionsFor(userIds)]);
  const byId = new Map(users.map((u) => [u.id, u]));
  const resolverIds = [...new Set(rows.map((r) => r.resolvedBy).filter((x): x is string => !!x))];
  const resolvers = resolverIds.length
    ? await db.select({ id: bauthUser.id, email: bauthUser.email }).from(bauthUser).where(inArray(bauthUser.id, resolverIds))
    : [];
  const resolverEmail = new Map(resolvers.map((r) => [r.id, r.email]));
  return rows.map((r) => {
    const u = byId.get(r.userId)!;
    return {
      ...toStorageRequest(r),
      user: { id: u.id, email: u.email, name: u.name },
      usedBytes: u.usedBytes,
      quotaBytes: u.quotaBytes,
      subscription: subs.get(r.userId) ?? null,
      resolvedBy: r.resolvedBy ? (resolverEmail.get(r.resolvedBy) ?? null) : null,
    };
  });
}

/** GET /api/admin/storage-requests: open ones oldest first (the queue), or every request newest first. */
export async function adminListStorageRequests(status: 'open' | 'all'): Promise<AdminStorageRequest[]> {
  const rows = await db
    .select()
    .from(storageRequests)
    .where(status === 'open' ? eq(storageRequests.status, 'open') : undefined)
    .orderBy(status === 'open' ? storageRequests.createdAt : desc(storageRequests.createdAt))
    .limit(ADMIN_REQUESTS_MAX);
  return toAdminRequests(rows);
}

async function openRequest(id: string): Promise<StorageRequestRow> {
  if (!REQ_ID.test(id)) throw new ApiError(404, 'not_found', 'Request not found.');
  const [row] = await db.select().from(storageRequests).where(eq(storageRequests.id, id)).limit(1);
  if (!row) throw new ApiError(404, 'not_found', 'Request not found.');
  if (row.status !== 'open') throw new ApiError(409, 'conflict', `This request was already ${row.status}.`);
  return row;
}

/** Marks an open request answered; false when someone else answered it first. */
async function resolve(id: string, status: 'granted' | 'dismissed', adminId: string): Promise<StorageRequestRow | null> {
  const [row] = await db
    .update(storageRequests)
    .set({ status, resolvedAt: new Date(), resolvedBy: adminId })
    .where(and(eq(storageRequests.id, id), eq(storageRequests.status, 'open')))
    .returning();
  return row ?? null;
}

/**
 * POST /api/admin/storage-requests/:id/grant: the quota becomes the plan's size through the
 * admin quota path (audited as quota.change), never lower than it already is; the user is mailed.
 */
export async function adminGrantStorageRequest(c: Context | null, admin: { id: string }, id: string): Promise<AdminStorageRequest> {
  const req = await openRequest(id);
  const plan = planById(req.plan);
  const target = Math.min(plan.storageBytes, MAX_QUOTA_BYTES);
  const current = await adminGetUser(req.userId);
  const row = await resolve(id, 'granted', admin.id);
  if (!row) throw new ApiError(409, 'conflict', 'This request was already answered.');
  if (current.quotaBytes < target) await adminSetQuota(c, admin, req.userId, target);
  await audit(c, { kind: 'storage.grant', userId: admin.id, target: current.email, meta: { plan: req.plan, targetUserId: req.userId, requestId: id } });
  const url = appUrl('/drive');
  const mail = renderStorageGranted({ email: current.email, plan, quotaBytes: Math.max(current.quotaBytes, target), url });
  sendInBackground({ to: current.email, ...mail, category: 'storage-granted', links: [url] });
  const [view] = await toAdminRequests([row]);
  return view;
}

/** POST /api/admin/storage-requests/:id/dismiss: closes it without changing the quota (the user can ask again). */
export async function adminDismissStorageRequest(c: Context | null, admin: { id: string }, id: string): Promise<AdminStorageRequest> {
  const req = await openRequest(id);
  const row = await resolve(id, 'dismissed', admin.id);
  if (!row) throw new ApiError(409, 'conflict', 'This request was already answered.');
  const [view] = await toAdminRequests([row]);
  await audit(c, { kind: 'storage.dismiss', userId: admin.id, target: view.user.email, meta: { plan: req.plan, targetUserId: req.userId, requestId: id } });
  return view;
}

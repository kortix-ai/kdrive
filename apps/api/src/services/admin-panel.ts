import { and, asc, count, eq, gte, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import {
  formatBytes,
  MAX_QUOTA_BYTES,
  type AdminDomain,
  type AdminOverviewResponse,
  type AdminUser,
  type AdminUserDetailResponse,
  type AdminUserSort,
  type Subscription,
} from '@volumes/shared';
import { db } from '../db/client';
import { bauthUser, storageRequests, userSettings, workspaceMembers, workspaces } from '../db/schema';
import { env } from '../env';
import { audit } from '../lib/audit';
import { ApiError } from '../lib/http';
import { adminEmails } from './admins';
import { subscriptionsFor } from './billing';
import { writeQuota } from './quota';
import { mapLimit } from './workspace-admin';
import { listWorkspaces, workspaceUsage } from './workspaces';

// The admin panel: users with usage, one user's drives, totals and usage by email
// domain. Usage is each live drive's current logical size, read from storage at
// most USAGE_CONCURRENCY calls at a time and shared by every admin view for
// USAGE_CACHE_MS, so moving between tabs does not re-read every volume.

const USAGE_CONCURRENCY = 8;
const USAGE_CACHE_MS = 30_000;

interface UsageSnapshot {
  /** Live drive id → logical bytes. */
  bytes: Map<string, number>;
  at: Date;
}

let usageCache: UsageSnapshot | null = null;
let usageLoading: Promise<UsageSnapshot> | null = null;

/** Every live drive's size (cached briefly; concurrent callers share one read). */
async function usageSnapshot(): Promise<UsageSnapshot> {
  if (usageCache && Date.now() - usageCache.at.getTime() < USAGE_CACHE_MS) return usageCache;
  usageLoading ??= (async () => {
    const rows = await db
      .select({ id: workspaces.id, volumeId: workspaces.volumeId })
      .from(workspaces)
      .where(isNull(workspaces.deletedAt));
    const sizes = await mapLimit(rows, USAGE_CONCURRENCY, (w) => workspaceUsage(w).catch(() => 0));
    usageCache = { bytes: new Map(rows.map((r, i) => [r.id, sizes[i]])), at: new Date() };
    return usageCache;
  })().finally(() => {
    usageLoading = null;
  });
  return usageLoading;
}

/** Forgets the cached drive sizes (tests; an admin may also want fresh numbers after a big change). */
export function clearAdminUsageCache(): void {
  usageCache = null;
}

// ── users ────────────────────────────────────────────────────────────────────

const userColumns = {
  id: bauthUser.id,
  email: bauthUser.email,
  emailVerified: bauthUser.emailVerified,
  name: bauthUser.name,
  createdAt: bauthUser.createdAt,
  quotaBytes: userSettings.quotaBytes,
  lastSignInAt: userSettings.lastSignInAt,
};

type UserRow = { id: string; email: string; emailVerified: boolean; name: string | null; createdAt: Date; quotaBytes: number | null; lastSignInAt: Date | null };
type UserAgg = { count: number; bytes: number; shared: number };

function toAdminUser(u: UserRow, agg: UserAgg, subscription: Subscription | null, admins: Set<string>): AdminUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    createdAt: u.createdAt.toISOString(),
    lastSignInAt: u.lastSignInAt ? u.lastSignInAt.toISOString() : null,
    quotaBytes: u.quotaBytes ?? env.defaultQuotaBytes,
    usedBytes: agg.bytes,
    workspaceCount: agg.count,
    sharedWithCount: agg.shared,
    emailVerified: u.emailVerified,
    // Same rule as isAdminUser: a listed address the account has verified.
    isAdmin: u.emailVerified && admins.has(u.email.toLowerCase()),
    subscription,
  };
}

/** userId → drives shared with them (live drives only). */
async function sharedCounts(userIds?: string[]): Promise<Map<string, number>> {
  const rows = await db
    .select({ userId: workspaceMembers.userId, n: count() })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(isNull(workspaces.deletedAt), userIds ? inArray(workspaceMembers.userId, userIds) : undefined))
    .groupBy(workspaceMembers.userId);
  return new Map(rows.map((r) => [r.userId, Number(r.n)]));
}

const escapeLike = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

function sortValue(u: AdminUser, key: AdminUserSort): number | string {
  switch (key) {
    case 'used':
      return u.usedBytes;
    case 'quota':
      return u.quotaBytes;
    case 'created':
      return u.createdAt;
    case 'lastSignIn':
      return u.lastSignInAt ?? '';
    case 'email':
      return u.email.toLowerCase();
    case 'drives':
      return u.workspaceCount;
  }
}

/**
 * GET /api/admin/users: every user matching `q` (email or name), sorted on the
 * server (usage needs every drive's size, so paging happens after sorting), one
 * page at a time. Ties fall back to the email so pages never overlap.
 */
export async function adminListUsers(opts: {
  q?: string;
  sort?: AdminUserSort;
  dir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}): Promise<{ users: AdminUser[]; total: number }> {
  const sort = opts.sort ?? 'used';
  const dir = opts.dir === 'asc' ? 1 : -1;
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 50;
  const pattern = opts.q ? escapeLike(opts.q) : null;
  const [users, drives, shared, usage, admins] = await Promise.all([
    db
      .select(userColumns)
      .from(bauthUser)
      .leftJoin(userSettings, eq(userSettings.userId, bauthUser.id))
      .where(pattern ? or(ilike(bauthUser.email, pattern), ilike(bauthUser.name, pattern)) : undefined),
    db.select({ id: workspaces.id, userId: workspaces.userId }).from(workspaces).where(isNull(workspaces.deletedAt)),
    sharedCounts(),
    usageSnapshot(),
    adminEmails(),
  ]);
  const agg = new Map<string, UserAgg>();
  for (const w of drives) {
    const a = agg.get(w.userId) ?? { count: 0, bytes: 0, shared: 0 };
    a.count++;
    a.bytes += usage.bytes.get(w.id) ?? 0;
    agg.set(w.userId, a);
  }
  const all = users.map((u) => toAdminUser(u, { count: 0, bytes: 0, ...agg.get(u.id), shared: shared.get(u.id) ?? 0 }, null, admins));
  all.sort((a, b) => {
    const x = sortValue(a, sort);
    const y = sortValue(b, sort);
    if (x !== y) return (x < y ? -1 : 1) * dir;
    return a.email < b.email ? -1 : a.email > b.email ? 1 : 0;
  });
  const slice = all.slice((page - 1) * limit, page * limit);
  const subs = await subscriptionsFor(slice.map((u) => u.id));
  return { users: slice.map((u) => ({ ...u, subscription: subs.get(u.id) ?? null })), total: all.length };
}

async function userRow(userId: string): Promise<UserRow> {
  const [u] = await db
    .select(userColumns)
    .from(bauthUser)
    .leftJoin(userSettings, eq(userSettings.userId, bauthUser.id))
    .where(eq(bauthUser.id, userId))
    .limit(1);
  if (!u) throw new ApiError(404, 'not_found', 'User not found.');
  return u;
}

/** One user with fresh usage (their drives read now, not from the panel's cache). */
export async function adminGetUser(userId: string): Promise<AdminUser> {
  const u = await userRow(userId);
  const rows = await listWorkspaces(userId);
  const [bytes, subs, shared, admins] = await Promise.all([
    mapLimit(rows, USAGE_CONCURRENCY, (w) => workspaceUsage(w)),
    subscriptionsFor([userId]),
    sharedCounts([userId]),
    adminEmails(),
  ]);
  const agg = { count: rows.length, bytes: bytes.reduce((a, b) => a + b, 0), shared: shared.get(userId) ?? 0 };
  return toAdminUser(u, agg, subs.get(userId) ?? null, admins);
}

/**
 * GET /api/admin/users/:id: the user, each drive they own (size and how many people
 * it is shared with) and each drive shared with them (role, owner, size).
 */
export async function adminUserDetail(userId: string): Promise<Omit<AdminUserDetailResponse, 'workspaceCapBytes'>> {
  const u = await userRow(userId);
  const [own, sharedRows, subs, admins] = await Promise.all([
    listWorkspaces(userId),
    db
      .select({
        ws: { id: workspaces.id, name: workspaces.name, volumeId: workspaces.volumeId },
        role: workspaceMembers.role,
        joinedAt: workspaceMembers.createdAt,
        owner: { id: bauthUser.id, email: bauthUser.email, name: bauthUser.name },
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .innerJoin(bauthUser, eq(bauthUser.id, workspaces.userId))
      .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)))
      .orderBy(asc(workspaceMembers.createdAt)),
    subscriptionsFor([userId]),
    adminEmails(),
  ]);
  const members = own.length
    ? await db
        .select({ workspaceId: workspaceMembers.workspaceId, n: count() })
        .from(workspaceMembers)
        .where(inArray(workspaceMembers.workspaceId, own.map((w) => w.id)))
        .groupBy(workspaceMembers.workspaceId)
    : [];
  const memberCount = new Map(members.map((m) => [m.workspaceId, Number(m.n)]));
  const [ownBytes, sharedBytes] = await Promise.all([
    mapLimit(own, USAGE_CONCURRENCY, (w) => workspaceUsage(w)),
    mapLimit(sharedRows, USAGE_CONCURRENCY, (r) => workspaceUsage(r.ws)),
  ]);
  const agg = { count: own.length, bytes: ownBytes.reduce((a, b) => a + b, 0), shared: sharedRows.length };
  return {
    user: toAdminUser(u, agg, subs.get(userId) ?? null, admins),
    isListedAdmin: admins.has(u.email.toLowerCase()),
    drives: own.map((w, i) => ({
      id: w.id,
      name: w.name,
      isDefault: w.isDefault,
      usedBytes: ownBytes[i],
      memberCount: memberCount.get(w.id) ?? 0,
      createdAt: w.createdAt.toISOString(),
    })),
    sharedWith: sharedRows.map((r, i) => ({
      id: r.ws.id,
      name: r.ws.name,
      role: r.role,
      owner: r.owner,
      usedBytes: sharedBytes[i],
      joinedAt: r.joinedAt.toISOString(),
    })),
  };
}

/** Sets a user's quota (0 < q ≤ MAX_QUOTA_BYTES; the schema enforces it) and audits {from, to}. */
export async function adminSetQuota(c: Context | null, admin: { id: string }, userId: string, quotaBytes: number): Promise<AdminUser> {
  if (!Number.isInteger(quotaBytes) || quotaBytes <= 0 || quotaBytes > MAX_QUOTA_BYTES) {
    throw new ApiError(400, 'bad_request', `Quota must be between 1 byte and ${formatBytes(MAX_QUOTA_BYTES)}.`);
  }
  const before = await adminGetUser(userId); // 404 for an unknown user
  await writeQuota(userId, quotaBytes);
  await audit(c, {
    kind: 'quota.change',
    userId: admin.id,
    target: before.email,
    meta: { targetUserId: userId, from: before.quotaBytes, to: quotaBytes },
  });
  return { ...before, quotaBytes };
}

// ── overview ─────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** GET /api/admin/overview: server totals and the five users storing the most. */
export async function adminOverview(): Promise<AdminOverviewResponse> {
  const now = Date.now();
  const [top, [drives], [shared], [quota], [open], [d7], [d30], usage] = await Promise.all([
    adminListUsers({ sort: 'used', dir: 'desc', limit: 5 }),
    db.select({ n: count() }).from(workspaces).where(isNull(workspaces.deletedAt)),
    db
      .select({ n: sql<string>`count(DISTINCT ${workspaceMembers.workspaceId})` })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(isNull(workspaces.deletedAt)),
    db
      .select({ n: sql<string>`COALESCE(SUM(COALESCE(${userSettings.quotaBytes}, ${env.defaultQuotaBytes})), 0)` })
      .from(bauthUser)
      .leftJoin(userSettings, eq(userSettings.userId, bauthUser.id)),
    db.select({ n: count() }).from(storageRequests).where(eq(storageRequests.status, 'open')),
    db.select({ n: count() }).from(bauthUser).where(gte(bauthUser.createdAt, new Date(now - 7 * DAY_MS))),
    db.select({ n: count() }).from(bauthUser).where(gte(bauthUser.createdAt, new Date(now - 30 * DAY_MS))),
    usageSnapshot(),
  ]);
  return {
    users: top.total,
    drives: Number(drives?.n ?? 0),
    sharedDrives: Number(shared?.n ?? 0),
    usedBytes: [...usage.bytes.values()].reduce((a, b) => a + b, 0),
    quotaBytes: Number(quota?.n ?? 0),
    openRequests: Number(open?.n ?? 0),
    signups7d: Number(d7?.n ?? 0),
    signups30d: Number(d30?.n ?? 0),
    topUsers: top.users,
    usageAt: usage.at.toISOString(),
  };
}

// ── usage by email domain ────────────────────────────────────────────────────

/** "ada@Kortix.ai" → "kortix.ai". */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

/** GET /api/admin/domains: users grouped by the domain of their address, most used first. */
export async function adminDomains(): Promise<AdminDomain[]> {
  const [users, drives, usage] = await Promise.all([
    db
      .select({ id: bauthUser.id, email: bauthUser.email, name: bauthUser.name, quotaBytes: userSettings.quotaBytes })
      .from(bauthUser)
      .leftJoin(userSettings, eq(userSettings.userId, bauthUser.id)),
    db.select({ id: workspaces.id, userId: workspaces.userId }).from(workspaces).where(isNull(workspaces.deletedAt)),
    usageSnapshot(),
  ]);
  const perUser = new Map<string, { count: number; bytes: number }>();
  for (const w of drives) {
    const a = perUser.get(w.userId) ?? { count: 0, bytes: 0 };
    a.count++;
    a.bytes += usage.bytes.get(w.id) ?? 0;
    perUser.set(w.userId, a);
  }
  const byDomain = new Map<string, AdminDomain>();
  for (const u of users) {
    const domain = emailDomain(u.email);
    const d = byDomain.get(domain) ?? { domain, users: 0, drives: 0, usedBytes: 0, quotaBytes: 0, members: [] };
    const a = perUser.get(u.id) ?? { count: 0, bytes: 0 };
    const quotaBytes = u.quotaBytes ?? env.defaultQuotaBytes;
    d.users++;
    d.drives += a.count;
    d.usedBytes += a.bytes;
    d.quotaBytes += quotaBytes;
    d.members.push({ id: u.id, email: u.email, name: u.name, usedBytes: a.bytes, quotaBytes, workspaceCount: a.count });
    byDomain.set(domain, d);
  }
  const domains = [...byDomain.values()];
  for (const d of domains) d.members.sort((a, b) => b.usedBytes - a.usedBytes || a.email.localeCompare(b.email));
  return domains.sort((a, b) => b.usedBytes - a.usedBytes || b.users - a.users || a.domain.localeCompare(b.domain));
}

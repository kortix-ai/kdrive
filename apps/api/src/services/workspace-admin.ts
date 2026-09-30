import { and, desc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import type { Context } from 'hono';
import { MAX_QUOTA_BYTES, type AdminUser, type WorkspaceSummary } from '@volumes/shared';
import { db } from '../db/client';
import { bauthUser, checkpoints, uploads, userSettings, workspaces, type WorkspaceRow } from '../db/schema';
import { env, isAdminEmail } from '../env';
import { audit } from '../lib/audit';
import { ApiError } from '../lib/http';
import { newId } from '../lib/ids';
import { withWorkspaceLock } from '../lib/lock';
import { getStore } from '../storage';
import { isStoreError, type Ref } from '../storage/types';
import { deleteWorkspaceLinks } from './links';
import { Hold } from './reservations';
import { getWorkspaceForUser, listWorkspaces, toWorkspaceSummaries, volumeNameFor, workspaceUsage } from './workspaces';

const WS_ID = /^[0-9a-z]{26}$/;

/** The live workspace row `id` owned by `userId`, else 404 (other users' ids look missing). */
export async function getOwnedWorkspaceRow(userId: string, id: string): Promise<WorkspaceRow> {
  if (!WS_ID.test(id)) throw new ApiError(404, 'not_found', 'Workspace not found.');
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.userId, userId), isNull(workspaces.deletedAt)))
    .limit(1);
  if (!row) throw new ApiError(404, 'not_found', 'Workspace not found.');
  return row;
}

async function summaryOf(row: WorkspaceRow): Promise<WorkspaceSummary> {
  const [s] = await toWorkspaceSummaries([row]);
  return s;
}

export async function listWorkspaceSummaries(userId: string): Promise<WorkspaceSummary[]> {
  return toWorkspaceSummaries(await listWorkspaces(userId));
}

// The workspace allowance (env.maxWorkspacesPerUser live workspaces a person,
// the default and duplicates included) and the org's volume slots (the last
// env.reservedVolumes stay free for new users' default workspaces) are
// reserved atomically in services/reservations.ts, so requests made at once
// cannot all pass against the same count.

/** Soft-removes a row whose volume could not be created (keeps the unique volume name unused). */
async function dropRow(id: string): Promise<void> {
  await db.delete(workspaces).where(eq(workspaces.id, id)).catch(() => {});
}

/** POST /api/workspaces: a new empty workspace (volume limit checked first). */
export async function createWorkspace(c: Context | null, userId: string, name: string): Promise<WorkspaceSummary> {
  const id = newId();
  await using hold = new Hold(userId, 'workspace.create');
  await hold.reserve({ workspaces: 1, workspaceId: id });
  await hold.reserveVolume(id);
  const [row] = await db
    .insert(workspaces)
    .values({ id, userId, name, volumeName: volumeNameFor(id), isDefault: false })
    .returning();
  let volumeId: string;
  try {
    volumeId = (await getStore().openVolume(row.volumeName)).id;
  } catch (e) {
    await dropRow(id);
    throw e;
  }
  const [saved] = await db.update(workspaces).set({ volumeId }).where(eq(workspaces.id, id)).returning();
  await audit(c, { kind: 'workspace.create', userId, workspaceId: id, target: name });
  return summaryOf(saved);
}

export async function renameWorkspace(userId: string, id: string, name: string): Promise<WorkspaceSummary> {
  const row = await getOwnedWorkspaceRow(userId, id);
  if (row.name === name) return summaryOf(row);
  const [saved] = await db.update(workspaces).set({ name }).where(eq(workspaces.id, row.id)).returning();
  return summaryOf(saved);
}

/**
 * POST /api/workspaces/:id/duplicate: forks the volume at `at` (default head)
 * into a new workspace. Quota counts the fork's full size; the volume limit is
 * checked before Platinum is called.
 */
export async function duplicateWorkspace(
  c: Context | null,
  userId: string,
  id: string,
  input: { name: string; at?: Ref },
): Promise<WorkspaceSummary> {
  const src = await getWorkspaceForUser(userId, id);
  if (!src) throw new ApiError(404, 'not_found', 'Workspace not found.');
  const store = getStore();
  // Resolve the ref once so the fork, the row and the audit all name one commit.
  const commit = await store.getCommit(src.volumeId, input.at ?? 'head');
  const newWsId = newId();
  // Slot, quota (the fork's full size) and volume, held until the fork is recorded.
  await using hold = new Hold(userId, 'workspace.duplicate');
  await hold.reserve({ workspaces: 1, workspaceId: newWsId, bytes: commit.logicalBytes });
  await hold.reserveVolume(newWsId);
  const [row] = await db
    .insert(workspaces)
    .values({
      id: newWsId,
      userId,
      name: input.name,
      volumeName: volumeNameFor(newWsId),
      isDefault: false,
      forkedFromWorkspaceId: src.id,
      forkedAtCommit: commit.id,
    })
    .returning();
  let volumeId: string;
  try {
    volumeId = (await store.forkVolume(src.volumeId, row.volumeName, commit.id)).id;
  } catch (e) {
    await dropRow(newWsId);
    throw e;
  }
  const [saved] = await db.update(workspaces).set({ volumeId }).where(eq(workspaces.id, newWsId)).returning();
  await audit(c, {
    kind: 'workspace.duplicate',
    userId,
    workspaceId: newWsId,
    target: input.name,
    meta: { fromWorkspaceId: src.id, fromName: src.name, commitId: commit.id, bytes: commit.logicalBytes },
  });
  return summaryOf(saved);
}

/**
 * Deletes one workspace's storage and rows that only a hard delete would
 * cascade: links, checkpoints, open uploads. The row itself is soft-deleted.
 */
async function purgeWorkspace(row: WorkspaceRow): Promise<void> {
  const store = getStore();
  const open = await db
    .select({ id: uploads.id, pt: uploads.ptUploadId })
    .from(uploads)
    .where(and(eq(uploads.workspaceId, row.id), inArray(uploads.status, ['planned', 'uploading'])));
  for (const u of open) if (u.pt) store.releaseUpload(u.pt);
  if (open.length) {
    await db.update(uploads).set({ status: 'aborted', updatedAt: new Date() }).where(inArray(uploads.id, open.map((u) => u.id)));
  }
  if (row.volumeId) {
    try {
      await store.deleteVolume(row.volumeId, { missingOk: true });
    } catch (e) {
      if (!isStoreError(e, 'volume_not_found')) throw e;
    }
  }
}

/** DELETE /api/workspaces/:id: never the default workspace. */
export async function deleteWorkspace(c: Context | null, userId: string, id: string): Promise<void> {
  const row = await getOwnedWorkspaceRow(userId, id);
  if (row.isDefault) throw new ApiError(400, 'bad_request', 'Your default workspace cannot be deleted.');
  await withWorkspaceLock(row.id, async () => {
    await purgeWorkspace(row);
    await db.update(workspaces).set({ deletedAt: new Date() }).where(eq(workspaces.id, row.id));
    const links = await deleteWorkspaceLinks(row.id);
    const cps = await db.delete(checkpoints).where(eq(checkpoints.workspaceId, row.id)).returning({ id: checkpoints.id });
    await audit(c, {
      kind: 'workspace.delete',
      userId,
      workspaceId: row.id,
      target: row.name,
      meta: { links, checkpoints: cps.length },
    });
  });
}

/** Deletes the volumes of every workspace a user has (account deletion). Throws when storage refuses. */
export async function deleteAllWorkspaceVolumes(userId: string): Promise<number> {
  const rows = await db.select().from(workspaces).where(eq(workspaces.userId, userId));
  let n = 0;
  for (const row of rows) {
    await withWorkspaceLock(row.id, () => purgeWorkspace(row));
    if (row.volumeId) n++;
  }
  return n;
}

// ── admin ────────────────────────────────────────────────────────────────────

/** Runs `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const ADMIN_USERS_MAX = 500;

/**
 * Users with settings, live workspace count and usage (Σ volume logicalBytes,
 * at most 8 storage calls in flight). `q` matches email or name.
 */
export async function adminListUsers(q?: string): Promise<AdminUser[]> {
  const pattern = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const users = await db
    .select({
      id: bauthUser.id,
      email: bauthUser.email,
      name: bauthUser.name,
      createdAt: bauthUser.createdAt,
      quotaBytes: userSettings.quotaBytes,
      lastSignInAt: userSettings.lastSignInAt,
    })
    .from(bauthUser)
    .leftJoin(userSettings, eq(userSettings.userId, bauthUser.id))
    .where(pattern ? or(ilike(bauthUser.email, pattern), ilike(bauthUser.name, pattern)) : undefined)
    .orderBy(desc(bauthUser.createdAt))
    .limit(ADMIN_USERS_MAX);
  if (!users.length) return [];
  const wsRows = await db
    .select({ id: workspaces.id, userId: workspaces.userId, volumeId: workspaces.volumeId })
    .from(workspaces)
    .where(and(inArray(workspaces.userId, users.map((u) => u.id)), isNull(workspaces.deletedAt)));
  const usage = await mapLimit(wsRows, 8, (w) => workspaceUsage(w));
  const byUser = new Map<string, { count: number; bytes: number }>();
  wsRows.forEach((w, i) => {
    const agg = byUser.get(w.userId) ?? { count: 0, bytes: 0 };
    agg.count++;
    agg.bytes += usage[i];
    byUser.set(w.userId, agg);
  });
  return users.map((u) => toAdminUser(u, byUser.get(u.id) ?? { count: 0, bytes: 0 }));
}

function toAdminUser(
  u: { id: string; email: string; name: string | null; createdAt: Date; quotaBytes: number | null; lastSignInAt: Date | null },
  agg: { count: number; bytes: number },
): AdminUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    createdAt: u.createdAt.toISOString(),
    lastSignInAt: u.lastSignInAt ? u.lastSignInAt.toISOString() : null,
    quotaBytes: u.quotaBytes ?? env.defaultQuotaBytes,
    usedBytes: agg.bytes,
    workspaceCount: agg.count,
    isAdmin: isAdminEmail(u.email),
  };
}

export async function adminGetUser(userId: string): Promise<AdminUser> {
  const [u] = await db
    .select({
      id: bauthUser.id,
      email: bauthUser.email,
      name: bauthUser.name,
      createdAt: bauthUser.createdAt,
      quotaBytes: userSettings.quotaBytes,
      lastSignInAt: userSettings.lastSignInAt,
    })
    .from(bauthUser)
    .leftJoin(userSettings, eq(userSettings.userId, bauthUser.id))
    .where(eq(bauthUser.id, userId))
    .limit(1);
  if (!u) throw new ApiError(404, 'not_found', 'User not found.');
  const rows = await listWorkspaces(userId);
  const bytes = await mapLimit(rows, 8, (w) => workspaceUsage(w));
  return toAdminUser(u, { count: rows.length, bytes: bytes.reduce((a, b) => a + b, 0) });
}

/** Sets a user's quota (0 < q ≤ MAX_QUOTA_BYTES; the schema enforces it) and audits {from, to}. */
export async function adminSetQuota(c: Context | null, admin: { id: string }, userId: string, quotaBytes: number): Promise<AdminUser> {
  if (!Number.isInteger(quotaBytes) || quotaBytes <= 0 || quotaBytes > MAX_QUOTA_BYTES) {
    throw new ApiError(400, 'bad_request', 'Quota must be between 1 byte and 50 GiB.');
  }
  const before = await adminGetUser(userId); // 404 for an unknown user
  await db
    .insert(userSettings)
    .values({ userId, quotaBytes })
    .onConflictDoUpdate({ target: userSettings.userId, set: { quotaBytes, updatedAt: new Date() } });
  await audit(c, {
    kind: 'quota.change',
    userId: admin.id,
    target: before.email,
    meta: { targetUserId: userId, from: before.quotaBytes, to: quotaBytes },
  });
  return { ...before, quotaBytes };
}

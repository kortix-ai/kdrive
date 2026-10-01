import { and, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { meterLevel, type UsageResponse } from '@volumes/shared';
import { db } from '../db/client';
import { quotaReservations, uploads, userSettings } from '../db/schema';
import { env } from '../env';
import { ApiError } from '../lib/http';
import { listWorkspaces, workspaceUsage } from './workspaces';

/** Anything that can run a select: the pool, or a transaction holding a reservation lock. */
export type Reader = Pick<typeof db, 'select'>;

export async function getQuotaBytes(userId: string, q: Reader = db): Promise<number> {
  const [row] = await q.select({ q: userSettings.quotaBytes }).from(userSettings).where(eq(userSettings.userId, userId));
  return row?.q ?? env.defaultQuotaBytes;
}

/** Usage = Σ volume logicalBytes over the user's live workspaces. */
export async function getUsage(userId: string): Promise<UsageResponse> {
  const [quotaBytes, rows] = await Promise.all([getQuotaBytes(userId), listWorkspaces(userId)]);
  const bytes = await Promise.all(rows.map((r) => workspaceUsage(r)));
  const byWorkspace = rows.map((r, i) => ({ workspaceId: r.id, name: r.name, bytes: bytes[i] }));
  const usedBytes = bytes.reduce((a, b) => a + b, 0);
  return { quotaBytes, usedBytes, level: meterLevel(usedBytes, quotaBytes), byWorkspace };
}

/** Bytes promised to the user's uploads that are planned but not committed yet (and not expired). */
async function uploadReservedBytes(q: Reader, userId: string, excludeUploadId?: string): Promise<number> {
  const conds = [
    eq(uploads.userId, userId),
    inArray(uploads.status, ['planned', 'uploading']),
    gt(uploads.expiresAt, new Date()),
    gt(uploads.addedBytes, 0),
  ];
  if (excludeUploadId) conds.push(ne(uploads.id, excludeUploadId));
  const [r] = await q
    .select({ n: sql<string>`COALESCE(SUM(${uploads.addedBytes}), 0)` })
    .from(uploads)
    .where(and(...conds));
  return Number(r?.n ?? 0);
}

/** Bytes held by the user's running copies / restores / duplicates (services/reservations.ts). */
async function heldBytes(q: Reader, userId: string): Promise<number> {
  const [r] = await q
    .select({ n: sql<string>`COALESCE(SUM(${quotaReservations.bytes}), 0)` })
    .from(quotaReservations)
    .where(and(eq(quotaReservations.userId, userId), eq(quotaReservations.scope, 'user'), gt(quotaReservations.expiresAt, new Date())));
  return Number(r?.n ?? 0);
}

/**
 * Bytes promised but not in logicalBytes yet: uploads planned and not
 * committed, plus mutations running now that hold a reservation.
 */
export async function reservedBytes(userId: string, opts: { excludeUploadId?: string } = {}, q: Reader = db): Promise<number> {
  const [a, b] = await Promise.all([uploadReservedBytes(q, userId, opts.excludeUploadId), heldBytes(q, userId)]);
  return a + b;
}

/** The 413 `quota_exceeded` error with {usedBytes, quotaBytes, requestedBytes, overBytes}. */
export function quotaExceeded(used: number, quotaBytes: number, addBytes: number): ApiError {
  return new ApiError(413, 'quota_exceeded', 'This would go over your storage quota.', {
    usedBytes: used,
    quotaBytes,
    requestedBytes: addBytes,
    overBytes: used + addBytes - quotaBytes,
  });
}

/**
 * Refuses `addBytes` more when it would push the user over quota, counting
 * what is committed plus what in-flight uploads and running mutations have
 * reserved. A check only: to act on the answer, reserve the bytes with
 * services/reservations.ts, or a concurrent request can pass the same check.
 */
export async function assertQuota(userId: string, addBytes: number, opts: { excludeUploadId?: string } = {}): Promise<void> {
  if (addBytes <= 0) return;
  // Reservations first, then usage: a reservation released in between has landed in usage.
  const reserved = await reservedBytes(userId, opts);
  const u = await getUsage(userId);
  const used = u.usedBytes + reserved;
  if (used + addBytes > u.quotaBytes) throw quotaExceeded(used, u.quotaBytes, addBytes);
}

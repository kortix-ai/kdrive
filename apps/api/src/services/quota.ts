import { and, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { meterLevel, type UsageResponse } from '@volumes/shared';
import { db } from '../db/client';
import { uploads, userSettings } from '../db/schema';
import { env } from '../env';
import { ApiError } from '../lib/http';
import { listWorkspaces, workspaceUsage } from './workspaces';

export async function getQuotaBytes(userId: string): Promise<number> {
  const [row] = await db.select({ q: userSettings.quotaBytes }).from(userSettings).where(eq(userSettings.userId, userId));
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

/**
 * Bytes promised to the user's uploads that are planned but not committed yet
 * (and not expired): their growth is not in logicalBytes until they commit.
 */
export async function reservedBytes(userId: string, opts: { excludeUploadId?: string } = {}): Promise<number> {
  const conds = [
    eq(uploads.userId, userId),
    inArray(uploads.status, ['planned', 'uploading']),
    gt(uploads.expiresAt, new Date()),
    gt(uploads.addedBytes, 0),
  ];
  if (opts.excludeUploadId) conds.push(ne(uploads.id, opts.excludeUploadId));
  const [r] = await db
    .select({ n: sql<string>`COALESCE(SUM(${uploads.addedBytes}), 0)` })
    .from(uploads)
    .where(and(...conds));
  return Number(r?.n ?? 0);
}

/**
 * Refuses `addBytes` more when it would push the user over quota, counting
 * what is committed plus what in-flight uploads have reserved: 413
 * `quota_exceeded` with {usedBytes, quotaBytes, requestedBytes, overBytes}.
 */
export async function assertQuota(userId: string, addBytes: number, opts: { excludeUploadId?: string } = {}): Promise<void> {
  if (addBytes <= 0) return;
  const [u, reserved] = await Promise.all([getUsage(userId), reservedBytes(userId, opts)]);
  const used = u.usedBytes + reserved;
  const after = used + addBytes;
  if (after > u.quotaBytes) {
    throw new ApiError(413, 'quota_exceeded', 'This would go over your storage quota.', {
      usedBytes: used,
      quotaBytes: u.quotaBytes,
      requestedBytes: addBytes,
      overBytes: after - u.quotaBytes,
    });
  }
}

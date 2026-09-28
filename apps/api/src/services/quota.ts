import { eq } from 'drizzle-orm';
import { meterLevel, type UsageResponse } from '@volumes/shared';
import { db } from '../db/client';
import { userSettings } from '../db/schema';
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
 * Refuses `addBytes` more when it would push the user over quota: 413
 * `quota_exceeded` with {usedBytes, quotaBytes, requestedBytes, overBytes}.
 */
export async function assertQuota(userId: string, addBytes: number): Promise<void> {
  if (addBytes <= 0) return;
  const u = await getUsage(userId);
  const after = u.usedBytes + addBytes;
  if (after > u.quotaBytes) {
    throw new ApiError(413, 'quota_exceeded', 'This would go over your storage quota.', {
      usedBytes: u.usedBytes,
      quotaBytes: u.quotaBytes,
      requestedBytes: addBytes,
      overBytes: after - u.quotaBytes,
    });
  }
}

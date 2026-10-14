import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import type { AuditEvent } from '@volumes/shared';
import { db } from '../db/client';
import { auditEvents, bauthUser, shareLinks, workspaces, type AuditEventRow } from '../db/schema';
import { audit } from '../lib/audit';
import { ApiError } from '../lib/http';
import { cancelSubscriptionForDeletion } from './billing';
import { deleteAllWorkspaceVolumes } from './workspace-admin';

/**
 * Deletes every workspace volume (missingOk) and the user row (cascades to
 * sessions, settings, workspaces, ledger, links, checkpoints, uploads), then
 * audits `account.delete` with the email kept as actorEmail and userId null.
 * A paid subscription is cancelled first. A billing or storage failure aborts
 * before any row is removed, so a retry can finish.
 */
export async function deleteAccount(userId: string, opts: { ip?: string | null } = {}): Promise<void> {
  const [user] = await db.select({ id: bauthUser.id, email: bauthUser.email }).from(bauthUser).where(eq(bauthUser.id, userId)).limit(1);
  if (!user) throw new ApiError(404, 'not_found', 'Account not found.');
  const [wsCount, linkCount] = await Promise.all([
    db.$count(workspaces, eq(workspaces.userId, userId)),
    db.$count(shareLinks, eq(shareLinks.userId, userId)),
  ]);
  await cancelSubscriptionForDeletion(userId);
  const volumes = await deleteAllWorkspaceVolumes(userId);
  await db.delete(bauthUser).where(eq(bauthUser.id, userId));
  await audit(null, {
    kind: 'account.delete',
    userId: null,
    actorEmail: user.email,
    target: user.email,
    meta: { deletedUserId: userId, workspaces: wsCount, volumes, links: linkCount },
    ip: opts.ip ?? null,
  });
}

export function toAuditEvent(r: AuditEventRow): AuditEvent {
  return {
    id: r.id,
    kind: r.kind,
    target: r.target,
    meta: r.meta ?? {},
    workspaceId: r.workspaceId,
    actorEmail: r.actorEmail,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Audit events newest first, paged by id (`before` = the last id seen). */
export async function listAuditEvents(filter: {
  userId?: string;
  kind?: string;
  before?: number;
  limit: number;
}): Promise<{ events: AuditEvent[]; nextCursor: string | null }> {
  const conds: SQL[] = [];
  if (filter.userId) conds.push(eq(auditEvents.userId, filter.userId));
  if (filter.kind) conds.push(eq(auditEvents.kind, filter.kind));
  if (filter.before) conds.push(lt(auditEvents.id, filter.before));
  const rows = await db
    .select()
    .from(auditEvents)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditEvents.id))
    .limit(filter.limit + 1);
  const page = rows.slice(0, filter.limit);
  return {
    events: page.map(toAuditEvent),
    nextCursor: rows.length > filter.limit && page.length ? String(page[page.length - 1].id) : null,
  };
}

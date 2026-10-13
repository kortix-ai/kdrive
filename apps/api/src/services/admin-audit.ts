import { and, desc, eq, gte, ilike, inArray, lt, or, type SQL } from 'drizzle-orm';
import type { AdminAuditEvent, AdminAuditFilter } from '@volumes/shared';
import { db } from '../db/client';
import { auditEvents, bauthUser, workspaces } from '../db/schema';
import { toAuditEvent } from './account';

// The admin audit log: every user's events, newest first, with filters shared by
// the paged list and the CSV export.

/** Rows a CSV export holds at most (newest first); narrow the filter for older ones. */
export const AUDIT_CSV_MAX = 50_000;
const CSV_BATCH = 1000;

function conditions(f: AdminAuditFilter): SQL[] {
  const conds: SQL[] = [];
  if (f.q) {
    const p = `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conds.push(
      or(
        ilike(auditEvents.actorEmail, p),
        ilike(auditEvents.target, p),
        inArray(auditEvents.userId, db.select({ id: bauthUser.id }).from(bauthUser).where(ilike(bauthUser.email, p))),
      )!,
    );
  }
  if (f.userId) conds.push(eq(auditEvents.userId, f.userId));
  if (f.kind.length) conds.push(inArray(auditEvents.kind, f.kind));
  if (f.workspaceId) conds.push(eq(auditEvents.workspaceId, f.workspaceId));
  if (f.from) conds.push(gte(auditEvents.createdAt, new Date(f.from)));
  if (f.to) conds.push(lt(auditEvents.createdAt, new Date(f.to)));
  return conds;
}

async function page(f: AdminAuditFilter, before: number | undefined, limit: number): Promise<AdminAuditEvent[]> {
  const conds = conditions(f);
  if (before) conds.push(lt(auditEvents.id, before));
  const rows = await db
    .select({ ev: auditEvents, workspaceName: workspaces.name, userEmail: bauthUser.email })
    .from(auditEvents)
    // Deleted drives keep their row (soft delete), so old events still name their drive.
    .leftJoin(workspaces, eq(workspaces.id, auditEvents.workspaceId))
    .leftJoin(bauthUser, eq(bauthUser.id, auditEvents.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditEvents.id))
    .limit(limit);
  return rows.map((r) => ({
    ...toAuditEvent(r.ev),
    // Some events (sign-ins) record only the account: name it by its current address.
    actorEmail: r.ev.actorEmail ?? r.userEmail,
    userId: r.ev.userId,
    ip: r.ev.ip,
    workspaceName: r.workspaceName,
  }));
}

/** GET /api/admin/audit: one page, paged by id (`before` = the last id seen). */
export async function listAdminAudit(
  f: AdminAuditFilter & { before?: number; limit: number },
): Promise<{ events: AdminAuditEvent[]; nextCursor: string | null }> {
  const rows = await page(f, f.before, f.limit + 1);
  const events = rows.slice(0, f.limit);
  return { events, nextCursor: rows.length > f.limit && events.length ? String(events[events.length - 1].id) : null };
}

const CSV_COLUMNS = ['id', 'time', 'actor_email', 'user_id', 'kind', 'target', 'workspace_id', 'workspace_name', 'ip', 'meta'] as const;

/**
 * One CSV field. Quoted when it holds a separator, quote or newline. Text that a
 * spreadsheet would run as a formula (= + - @, tab, CR first) gets a leading `'`:
 * targets and names are user input.
 */
export function csvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(e: AdminAuditEvent): string {
  return [e.id, e.createdAt, e.actorEmail, e.userId, e.kind, e.target, e.workspaceId, e.workspaceName, e.ip, JSON.stringify(e.meta ?? {})]
    .map(csvField)
    .join(',');
}

/** GET /api/admin/audit.csv: every event matching the filter (newest first, at most AUDIT_CSV_MAX). */
export async function adminAuditCsv(f: AdminAuditFilter): Promise<string> {
  const lines: string[] = [CSV_COLUMNS.join(',')];
  let before: number | undefined;
  while (lines.length - 1 < AUDIT_CSV_MAX) {
    const rows = await page(f, before, Math.min(CSV_BATCH, AUDIT_CSV_MAX - (lines.length - 1)));
    for (const r of rows) lines.push(csvRow(r));
    if (rows.length < CSV_BATCH) break;
    before = rows[rows.length - 1].id;
  }
  return `${lines.join('\r\n')}\r\n`;
}

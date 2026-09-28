import type { Context } from 'hono';
import type { AuditKind } from '@volumes/shared';
import { db } from '../db/client';
import { auditEvents } from '../db/schema';
import { clientIp } from '../middleware/rate-limit';

export interface AuditInput {
  kind: AuditKind;
  userId: string | null;
  actorEmail?: string | null;
  workspaceId?: string | null;
  target?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
}

/** Writes one audit event. Never throws (an audit failure must not fail the request). */
export async function audit(c: Context | null, e: AuditInput): Promise<void> {
  try {
    let actorEmail = e.actorEmail ?? null;
    if (!actorEmail && c) {
      const u = c.get('user' as never) as { email?: string } | undefined;
      actorEmail = u?.email ?? null;
    }
    await db.insert(auditEvents).values({
      userId: e.userId,
      actorEmail,
      workspaceId: e.workspaceId ?? null,
      kind: e.kind,
      target: e.target ?? null,
      meta: e.meta ?? {},
      ip: e.ip ?? (c ? clientIp(c) : null),
    });
  } catch (err) {
    console.warn('[audit] failed to record', e.kind, err instanceof Error ? err.message : err);
  }
}

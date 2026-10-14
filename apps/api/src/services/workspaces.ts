import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { VOLUME_NAME_PREFIX, type DriveRole, type WorkspaceSummary } from '@volumes/shared';
import { db } from '../db/client';
import { userSettings, workspaces, type WorkspaceRow } from '../db/schema';
import { env } from '../env';
import { newId } from '../lib/ids';
import { getStore } from '../storage';
import { isStoreError } from '../storage/types';
import type { WorkspaceCtx } from '../types';

export const DEFAULT_WORKSPACE_NAME = 'My Drive';

export function volumeNameFor(workspaceId: string): string {
  return `${VOLUME_NAME_PREFIX}${workspaceId}`;
}

export function toCtx(row: WorkspaceRow & { volumeId: string }, role: DriveRole = 'owner'): WorkspaceCtx {
  return {
    id: row.id,
    userId: row.userId,
    role,
    name: row.name,
    volumeId: row.volumeId,
    volumeName: row.volumeName,
    isDefault: row.isDefault,
  };
}

/** Opens (get-or-create) the workspace's volume and stores its id. Idempotent. */
export async function ensureVolume(ws: WorkspaceRow): Promise<WorkspaceRow & { volumeId: string }> {
  if (ws.volumeId) return ws as WorkspaceRow & { volumeId: string };
  const info = await getStore().openVolume(ws.volumeName);
  const [row] = await db
    .update(workspaces)
    .set({ volumeId: info.id })
    .where(and(eq(workspaces.id, ws.id), isNull(workspaces.volumeId)))
    .returning();
  if (row) return row as WorkspaceRow & { volumeId: string };
  const [again] = await db.select().from(workspaces).where(eq(workspaces.id, ws.id));
  return { ...again, volumeId: again.volumeId ?? info.id };
}

/**
 * First sign-in bootstrap: settings row (default quota), default workspace and
 * its volume. Safe to call on every request (idempotent, race-safe).
 */
export async function ensureUserBootstrap(user: { id: string }): Promise<WorkspaceRow & { volumeId: string }> {
  await db.insert(userSettings).values({ userId: user.id, quotaBytes: env.defaultQuotaBytes }).onConflictDoNothing();
  let ws = await getDefaultWorkspace(user.id);
  if (!ws) {
    const id = newId();
    await db
      .insert(workspaces)
      .values({ id, userId: user.id, name: DEFAULT_WORKSPACE_NAME, volumeName: volumeNameFor(id), isDefault: true })
      .onConflictDoNothing();
    ws = await getDefaultWorkspace(user.id);
    if (!ws) throw new Error('failed to create the default workspace');
  }
  return ensureVolume(ws);
}

export async function getDefaultWorkspace(userId: string): Promise<WorkspaceRow | null> {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.userId, userId), eq(workspaces.isDefault, true), isNull(workspaces.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** Live workspaces of a user: the default first, then by creation time. */
export async function listWorkspaces(userId: string): Promise<WorkspaceRow[]> {
  return db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.userId, userId), isNull(workspaces.deletedAt)))
    .orderBy(desc(workspaces.isDefault), asc(workspaces.createdAt));
}

/** The workspace `wsId` if (and only if) the user owns it and it is live; opens its volume. */
export async function getWorkspaceForUser(userId: string, wsId: string): Promise<WorkspaceCtx | null> {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, wsId), eq(workspaces.userId, userId), isNull(workspaces.deletedAt)))
    .limit(1);
  if (!row) return null;
  return toCtx(await ensureVolume(row));
}

/** Volume logicalBytes for a workspace (0 when the volume is missing). */
export async function workspaceUsage(row: Pick<WorkspaceRow, 'volumeId'>): Promise<number> {
  if (!row.volumeId) return 0;
  try {
    return (await getStore().getVolume(row.volumeId)).logicalBytes;
  } catch (e) {
    if (isStoreError(e, 'volume_not_found')) return 0;
    throw e;
  }
}

/** Maps rows to the WorkspaceSummary contract (usage read in parallel). */
export async function toWorkspaceSummaries(rows: WorkspaceRow[]): Promise<WorkspaceSummary[]> {
  const parentIds = [...new Set(rows.map((r) => r.forkedFromWorkspaceId).filter((x): x is string => !!x))];
  const parents = parentIds.length
    ? await db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces).where(inArray(workspaces.id, parentIds))
    : [];
  const parentName = new Map(parents.map((p) => [p.id, p.name]));
  const usage = await Promise.all(rows.map((r) => workspaceUsage(r)));
  return rows.map((r, i) => ({
    id: r.id,
    name: r.name,
    isDefault: r.isDefault,
    role: 'owner' as const,
    owner: null,
    createdAt: r.createdAt.toISOString(),
    usageBytes: usage[i],
    forkedFrom: r.forkedAtCommit
      ? {
          workspaceId: r.forkedFromWorkspaceId,
          workspaceName: r.forkedFromWorkspaceId ? (parentName.get(r.forkedFromWorkspaceId) ?? null) : null,
          commitId: r.forkedAtCommit,
        }
      : null,
  }));
}

export async function touchLastSignIn(userId: string): Promise<void> {
  await db
    .insert(userSettings)
    .values({ userId, quotaBytes: env.defaultQuotaBytes, lastSignInAt: new Date() })
    .onConflictDoUpdate({ target: userSettings.userId, set: { lastSignInAt: new Date(), updatedAt: new Date() } });
}

// Starred items and recently opened files, per person.
//
// A star (and a recent open) names a path, so it follows its item the way a live share
// link does: the link hooks in services/links.ts run inside the same workspace lock on
// every move, rename, delete, restore and undo, and call the functions at the end of
// this file. Reads only ever show drives the person can open right now (owner or member),
// so removing someone from a drive hides their stars there without touching them.
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { StarredItem } from '@volumes/shared';
import { db } from '../db/client';
import { recentOpens, stars, workspaceMembers, workspaces, type WorkspaceRow } from '../db/schema';
import { ApiError } from '../lib/http';
import { newId } from '../lib/ids';
import { isStoreError, type FileStat } from '../storage/types';
import type { WorkspaceCtx } from '../types';
import { statOrNull } from './tree';
import { mapLimit } from './versioning-util';

/** Live drives the user owns or is a member of, by id. */
export async function accessibleDrives(userId: string): Promise<Map<string, WorkspaceRow>> {
  const rows = await db
    .select({ ws: workspaces })
    .from(workspaces)
    .leftJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId)))
    .where(and(isNull(workspaces.deletedAt), or(eq(workspaces.userId, userId), eq(workspaceMembers.userId, userId))));
  return new Map(rows.map((r) => [r.ws.id, r.ws]));
}

/** The item at `path` now, or null (gone, or the drive has no volume / lost it). */
export async function statNow(ws: Pick<WorkspaceRow, 'volumeId'>, path: string): Promise<FileStat | null> {
  if (!ws.volumeId) return null;
  try {
    return await statOrNull({ volumeId: ws.volumeId }, path);
  } catch (e) {
    if (isStoreError(e, 'volume_not_found')) return null;
    throw e;
  }
}

const basenameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1) || p;

// ── stars ───────────────────────────────────────────────────────────────────

/** The user's starred paths in one drive (for the stars on rows and tiles). */
export async function driveStars(userId: string, wsId: string): Promise<string[]> {
  const rows = await db
    .select({ path: stars.path })
    .from(stars)
    .where(and(eq(stars.userId, userId), eq(stars.workspaceId, wsId), isNull(stars.detachedAt)))
    .orderBy(stars.path);
  return rows.map((r) => r.path);
}

/**
 * Stars (or unstars) items of a drive the user can open: viewers too, since a star changes
 * nothing in the drive. Starring needs the item to exist now; unstarring never does.
 */
export async function setStars(userId: string, ws: WorkspaceCtx, paths: string[], starred: boolean): Promise<string[]> {
  const unique = [...new Set(paths)];
  if (unique.includes('/')) throw new ApiError(400, 'bad_request', 'The drive itself cannot be starred.');
  if (starred) {
    const stats = await mapLimit(unique, 8, (p) => statOrNull(ws, p));
    const missing = unique.filter((_, i) => !stats[i]);
    if (missing.length) throw new ApiError(404, 'not_found', `Nothing at ${missing[0]}.`, { paths: missing.slice(0, 20) });
    await db
      .insert(stars)
      .values(
        unique.map((p, i) => ({
          id: newId(),
          userId,
          workspaceId: ws.id,
          path: p,
          targetType: stats[i]!.type === 'dir' ? ('dir' as const) : ('file' as const),
        })),
      )
      .onConflictDoNothing();
  } else {
    await db
      .delete(stars)
      .where(and(eq(stars.userId, userId), eq(stars.workspaceId, ws.id), inArray(stars.path, unique), isNull(stars.detachedAt)));
  }
  return driveStars(userId, ws.id);
}

/** Every starred item the user can still open, newest star first. Items missing now are left out. */
export async function listStarred(userId: string): Promise<StarredItem[]> {
  const drives = await accessibleDrives(userId);
  if (!drives.size) return [];
  const rows = await db
    .select()
    .from(stars)
    .where(and(eq(stars.userId, userId), isNull(stars.detachedAt), inArray(stars.workspaceId, [...drives.keys()])))
    .orderBy(desc(stars.createdAt), desc(stars.id))
    .limit(500);
  const items = await mapLimit(rows, 8, async (r): Promise<StarredItem | null> => {
    const ws = drives.get(r.workspaceId)!;
    const st = await statNow(ws, r.path);
    if (!st || (st.type !== 'file' && st.type !== 'dir')) return null;
    return {
      workspaceId: ws.id,
      workspaceName: ws.name,
      path: r.path,
      name: st.name || basenameOf(r.path),
      type: st.type,
      size: st.type === 'dir' ? 0 : st.size,
      mtime: st.mtime,
      starredAt: r.createdAt.toISOString(),
    };
  });
  return items.filter((i): i is StarredItem => i !== null);
}

// ── stars and recent opens follow their item ────────────────────────────────
// Called from the live-link hooks in services/links.ts, so every mutation that moves or
// removes an item updates them too, in the same workspace lock and with the same rules.

const atOrUnder = (p: string) => (p === '/' ? sql`true` : sql`(path = ${p} OR starts_with(path, ${p + '/'}))`);

/** A move / rename: stars and opens at or under `from` now name the same item under `to`. */
export async function moveStars(wsId: string, from: string, to: string): Promise<void> {
  if (from === to || from === '/') return;
  // Nothing lives at `to` before a move (a replaced item was detached first): whatever still names it is stale.
  await db.execute(sql`DELETE FROM stars WHERE workspace_id = ${wsId} AND detached_at IS NULL AND ${atOrUnder(to)}`);
  await db.execute(sql`
    UPDATE stars SET path = ${to} || substr(path, char_length(${from}) + 1)
    WHERE workspace_id = ${wsId} AND detached_at IS NULL AND ${atOrUnder(from)}`);
  await db.execute(sql`DELETE FROM recent_opens WHERE workspace_id = ${wsId} AND ${atOrUnder(to)}`);
  await db.execute(sql`
    UPDATE recent_opens SET path = ${to} || substr(path, char_length(${from}) + 1)
    WHERE workspace_id = ${wsId} AND ${atOrUnder(from)}`);
}

/** The item at `path` is gone: detach its stars (undoing the action brings them back) and forget its opens. */
export async function detachStars(wsId: string, path: string, actionId: string): Promise<void> {
  await db.execute(sql`
    UPDATE stars SET detached_at = now(), detached_by_action_id = ${actionId}
    WHERE workspace_id = ${wsId} AND detached_at IS NULL AND ${atOrUnder(path)}`);
  await db.execute(sql`DELETE FROM recent_opens WHERE workspace_id = ${wsId} AND ${atOrUnder(path)}`);
}

/** Undo of `actionId` put its items back: their stars return, unless that path was starred again meanwhile. */
export async function reattachStars(wsId: string, actionId: string): Promise<void> {
  await db.execute(sql`
    UPDATE stars s SET detached_at = NULL, detached_by_action_id = NULL
    WHERE s.workspace_id = ${wsId} AND s.detached_by_action_id = ${actionId}
      AND NOT EXISTS (SELECT 1 FROM stars t WHERE t.user_id = s.user_id AND t.workspace_id = s.workspace_id
        AND t.path = s.path AND t.detached_at IS NULL)`);
}

/** Undo of a move put the item back at `from`: its stars (detached by the undo itself) move back too. */
export async function unmoveStars(wsId: string, to: string, from: string, undoActionId: string): Promise<void> {
  if (from === to || to === '/') return;
  await db.execute(sql`
    UPDATE stars s SET path = ${from} || substr(s.path, char_length(${to}) + 1), detached_at = NULL, detached_by_action_id = NULL
    WHERE s.workspace_id = ${wsId} AND (s.detached_at IS NULL OR s.detached_by_action_id = ${undoActionId})
      AND (s.path = ${to} OR starts_with(s.path, ${to + '/'}))
      AND NOT EXISTS (SELECT 1 FROM stars t WHERE t.user_id = s.user_id AND t.workspace_id = s.workspace_id
        AND t.path = ${from} || substr(s.path, char_length(${to}) + 1) AND t.detached_at IS NULL)`);
}

// Recent: files a person opened (recent_opens) or changed (the ledger), across every
// drive they can open, newest first. Changes are read from actions + action_paths, never
// written twice; an item that no longer exists at that path is left out.
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { RecentItem, RecentReason } from '@volumes/shared';
import { db } from '../db/client';
import { actionPaths, actions, recentOpens } from '../db/schema';
import { ApiError } from '../lib/http';
import type { WorkspaceCtx } from '../types';
import { accessibleDrives, statNow } from './stars';
import { mapLimit } from './versioning-util';

/** Opens kept per person (the oldest beyond this are dropped when a new one lands). */
export const RECENT_OPENS_CAP = 200;
/** Ledger path rows scanned for the person's own changes (a big folder upload is one action). */
const LEDGER_SCAN = 2000;

/** The person previewed or downloaded the file at `path`: one row per item, the newest open wins. */
export async function recordOpen(userId: string, ws: WorkspaceCtx, path: string): Promise<void> {
  if (path === '/') throw new ApiError(400, 'bad_request', 'Only files can be opened.');
  await db
    .insert(recentOpens)
    .values({ userId, workspaceId: ws.id, path })
    .onConflictDoUpdate({ target: [recentOpens.userId, recentOpens.workspaceId, recentOpens.path], set: { openedAt: sql`now()` } });
  await db.execute(sql`
    DELETE FROM recent_opens WHERE user_id = ${userId} AND (workspace_id, path) NOT IN (
      SELECT workspace_id, path FROM recent_opens WHERE user_id = ${userId} ORDER BY opened_at DESC LIMIT ${RECENT_OPENS_CAP})`);
}

type Candidate = { workspaceId: string; path: string; at: Date; reason: RecentReason };

/** Recently opened or changed files, newest first, at most `limit`. */
export async function listRecent(userId: string, limit: number): Promise<RecentItem[]> {
  const drives = await accessibleDrives(userId);
  if (!drives.size) return [];
  const ids = [...drives.keys()];
  const [opens, edits] = await Promise.all([
    db
      .select()
      .from(recentOpens)
      .where(and(eq(recentOpens.userId, userId), inArray(recentOpens.workspaceId, ids)))
      .orderBy(desc(recentOpens.openedAt))
      .limit(RECENT_OPENS_CAP),
    // The person's own committed changes to files (an agent acting for them is not "you").
    db
      .select({ workspaceId: actions.workspaceId, path: actionPaths.path, at: actions.createdAt })
      .from(actionPaths)
      .innerJoin(actions, eq(actions.id, actionPaths.actionId))
      .where(
        and(
          eq(actions.userId, userId),
          eq(actions.status, 'committed'),
          eq(actions.actorKind, 'user'),
          eq(actionPaths.entryType, 'file'),
          ne(actionPaths.op, 'deleted'),
          inArray(actions.workspaceId, ids),
        ),
      )
      .orderBy(desc(actions.createdAt), desc(actionPaths.id))
      .limit(LEDGER_SCAN),
  ]);

  // One entry per item: the latest of its open and its change.
  const byItem = new Map<string, Candidate>();
  const add = (c: Candidate) => {
    const k = `${c.workspaceId}\u0000${c.path}`;
    const cur = byItem.get(k);
    if (!cur || cur.at < c.at) byItem.set(k, c);
  };
  for (const o of opens) add({ workspaceId: o.workspaceId, path: o.path, at: o.openedAt, reason: 'opened' });
  for (const e of edits) add({ workspaceId: e.workspaceId, path: e.path, at: e.at, reason: 'edited' });
  const sorted = [...byItem.values()].sort((a, b) => b.at.getTime() - a.at.getTime());

  // Check what still exists, a page at a time, until `limit` live files are found.
  const out: RecentItem[] = [];
  for (let i = 0; i < sorted.length && out.length < limit; i += limit) {
    const page = sorted.slice(i, i + limit);
    const found = await mapLimit(page, 8, async (c): Promise<RecentItem | null> => {
      const ws = drives.get(c.workspaceId)!;
      const st = await statNow(ws, c.path);
      if (!st || st.type !== 'file') return null;
      return {
        workspaceId: ws.id,
        workspaceName: ws.name,
        path: c.path,
        name: st.name || c.path.slice(c.path.lastIndexOf('/') + 1),
        size: st.size,
        mtime: st.mtime,
        at: c.at.toISOString(),
        reason: c.reason,
      };
    });
    for (const f of found) if (f && out.length < limit) out.push(f);
  }
  return out;
}

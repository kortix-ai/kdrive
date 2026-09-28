// Recently deleted: ledger delete ops whose pre-delete version still exists.
// Owner: API-versioning (architecture §9.2).
import { and, eq, gt, inArray, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { DeletedQuery, DeletedResponse, type DeletedItem } from '@volumes/shared';
import { db } from '../db/client';
import { actionPaths, actions } from '../db/schema';
import { ok, parseQuery } from '../lib/http';
import { deletedRows } from '../services/ledger';
import { ancestorsOf as ancestors, cmpCommitId, mapLimit, statIfReadable, visibleHistory } from '../services/versioning-util';
import { getStore } from '../storage';
import type { Commit } from '../storage/types';
import type { AppEnv, WorkspaceCtx } from '../types';

export const deletedRoutes = new Hono<AppEnv>();

/** How far back a restore point is searched when the pre-delete version is gone. */
const WALK_MAX = 50;

/** Deleted items (newest first) with the version to restore them from. */
export async function listDeleted(ws: WorkspaceCtx, limit: number): Promise<DeletedItem[]> {
  const rows = await deletedRows(ws.id, Math.min(limit * 4, 4000));
  // Newest delete per path only.
  const seen = new Set<string>();
  const latest = rows.filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true)));
  if (!latest.length) return [];
  const head = (await getStore().getVolume(ws.volumeId)).headCommitId;

  let history: Commit[] | null = null;
  const olderThan = async (id: string): Promise<Commit[]> => {
    if (!history) history = (await visibleHistory(ws.volumeId, { maxPages: 10 })).commits;
    return history.filter((c) => cmpCommitId(c.id, id) < 0).slice(0, WALK_MAX);
  };

  const items = await mapLimit(latest, 8, async (r): Promise<DeletedItem | null> => {
    // Something is at that path again. If this very item came back (a restore or
    // an undo of the delete), it is not deleted. A NEW item that took the name
    // does not bring the old one back: keep listing it, marked occupied.
    let occupied = false;
    if (await statIfReadable(ws.volumeId, r.path, head)) {
      if (await cameBack(ws.id, r)) return null;
      occupied = true;
    }
    let restoreAt: string | null = null;
    const base = r.action.baseCommitId;
    if (base && (await statIfReadable(ws.volumeId, r.path, base))) restoreAt = base;
    if (!restoreAt && base) {
      for (const c of await olderThan(base)) {
        if (await statIfReadable(ws.volumeId, r.path, c.id)) {
          restoreAt = c.id;
          break;
        }
      }
    }
    return {
      actionId: r.action.id,
      path: r.path,
      type: r.entryType,
      size: r.size ?? 0,
      deletedAt: (r.action.finalizedAt ?? r.action.createdAt).toISOString(),
      restoreAt,
      restorable: restoreAt !== null,
      ...(occupied ? { occupied: true } : {}),
    };
  });
  return items.filter((i): i is DeletedItem => i !== null).slice(0, limit);
}

/** True when a later committed action restored this path (or a folder above it), or undid the delete. */
async function cameBack(wsId: string, r: { path: string; action: { id: string; createdAt: Date } }): Promise<boolean> {
  const paths = [r.path, ...ancestors(r.path).filter((p) => p !== '/')];
  const [hit] = await db
    .select({ id: actions.id })
    .from(actions)
    .leftJoin(actionPaths, eq(actionPaths.actionId, actions.id))
    .where(
      and(
        eq(actions.workspaceId, wsId),
        eq(actions.status, 'committed'),
        gt(actions.createdAt, r.action.createdAt),
        or(
          eq(actions.undoOfActionId, r.action.id),
          and(eq(actionPaths.op, 'restored'), inArray(actionPaths.path, paths)),
        ),
      ),
    )
    .limit(1);
  return !!hit;
}

/** GET /api/w/:ws/deleted?limit */
deletedRoutes.get('/deleted', async (c) => {
  const q = parseQuery(c, DeletedQuery);
  return ok(c, DeletedResponse, { items: await listDeleted(c.get('ws'), q.limit) });
});

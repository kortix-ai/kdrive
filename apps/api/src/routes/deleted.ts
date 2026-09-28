// Recently deleted: ledger delete ops whose pre-delete version still exists.
// Owner: API-versioning (architecture §9.2).
import { Hono } from 'hono';
import { DeletedQuery, DeletedResponse, type DeletedItem } from '@volumes/shared';
import { ok, parseQuery } from '../lib/http';
import { deletedRows } from '../services/ledger';
import { cmpCommitId, mapLimit, statIfReadable, visibleHistory } from '../services/versioning-util';
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
    // Back again (restored, re-uploaded, or a new item with that name): not "deleted".
    if (await statIfReadable(ws.volumeId, r.path, head)) return null;
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
    };
  });
  return items.filter((i): i is DeletedItem => i !== null).slice(0, limit);
}

/** GET /api/w/:ws/deleted?limit */
deletedRoutes.get('/deleted', async (c) => {
  const q = parseQuery(c, DeletedQuery);
  return ok(c, DeletedResponse, { items: await listDeleted(c.get('ws'), q.limit) });
});

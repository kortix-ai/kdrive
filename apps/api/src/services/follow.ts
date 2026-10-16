// Everything that names an item by its path follows the item: live share links,
// comments and tags. Every mutation that moves or removes an item calls these,
// inside the same workspace lock, so none of them is left pointing at whatever
// takes the path later.
//
// A removed item's comments and tags are detached (kept, but hidden) under the
// action that removed it. Undoing that action re-attaches them; restoring the
// item to a version from before the removal does too (reattachRestored).

import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import type { WorkspaceCtx } from '../types';
import { detachLiveLinks, moveLiveLinks, reattachLinks, unmoveLiveLinks } from './links';
import { statOrNull } from './tree';
import { mapLimit } from './versioning-util';

const TABLES = ['file_comments', 'file_label_assignments'] as const;
type Table = (typeof TABLES)[number];

/** Rows rooted at `p` or anywhere under it (never siblings like `/a b` for `/a`). */
const atOrUnder = (p: string): SQL => (p === '/' ? sql`true` : sql`(path = ${p} OR starts_with(path, ${p + '/'}))`);

/**
 * A tag can be on an item once: a detached assignment comes back only when the
 * item does not carry that tag again by now, and only the latest one of several.
 */
const noLiveTwin = (t: Table): SQL =>
  t === 'file_label_assignments'
    ? sql`AND NOT EXISTS (SELECT 1 FROM file_label_assignments o
        WHERE o.label_id = file_label_assignments.label_id AND o.detached_at IS NULL AND o.path = file_label_assignments.path)
      AND id IN (SELECT DISTINCT ON (label_id, path) id FROM file_label_assignments d
        WHERE d.workspace_id = file_label_assignments.workspace_id AND d.detached_at IS NOT NULL
        ORDER BY label_id, path, detached_at DESC, id DESC)`
    : sql``;

/** A move / rename: what was at or under `from` is now under `to`. */
export async function moveFollowers(wsId: string, from: string, to: string): Promise<void> {
  await moveLiveLinks(wsId, from, to);
  if (from === to || from === '/') return;
  for (const t of TABLES) {
    await db.execute(sql`
      UPDATE ${sql.identifier(t)} SET path = ${to} || substr(path, char_length(${from}) + 1)
      WHERE workspace_id = ${wsId} AND detached_at IS NULL AND ${atOrUnder(from)}`);
  }
}

/** The item at `path` is gone (deleted, replaced or removed by a restore). */
export async function detachFollowers(wsId: string, path: string, actionId: string): Promise<void> {
  await detachLiveLinks(wsId, path, actionId);
  for (const t of TABLES) {
    await db.execute(sql`
      UPDATE ${sql.identifier(t)} SET detached_at = now(), detached_by_action_id = ${actionId}
      WHERE workspace_id = ${wsId} AND detached_at IS NULL AND ${atOrUnder(path)}`);
  }
}

/** Undo of `actionId` put its items back: what it detached is attached again. */
export async function reattachFollowers(wsId: string, actionId: string): Promise<void> {
  await reattachLinks(wsId, actionId);
  for (const t of TABLES) {
    await db.execute(sql`
      UPDATE ${sql.identifier(t)} SET detached_at = NULL, detached_by_action_id = NULL
      WHERE workspace_id = ${wsId} AND detached_by_action_id = ${actionId} ${noLiveTwin(t)}`);
  }
}

/**
 * Undo of a move put the item back at `from`. The undo removed `to` (detaching
 * under the undo's own action id): move those rows back and attach them.
 */
export async function unmoveFollowers(wsId: string, to: string, from: string, undoActionId: string): Promise<void> {
  await unmoveLiveLinks(wsId, to, from, undoActionId);
  if (from === to || to === '/') return;
  for (const t of TABLES) {
    await db.execute(sql`
      UPDATE ${sql.identifier(t)} SET path = ${from} || substr(path, char_length(${to}) + 1), detached_at = NULL, detached_by_action_id = NULL
      WHERE workspace_id = ${wsId} AND (detached_at IS NULL OR detached_by_action_id = ${undoActionId}) AND ${atOrUnder(to)}`);
  }
}

/**
 * A restore brought `roots` back as they were at a version made at `atCreatedAt`.
 * Comments and tags that an earlier action (one made after that version) detached
 * there come back with them, wherever the item exists again. Share links do not:
 * a link to a deleted item stays dead unless the delete itself is undone.
 */
export async function reattachRestored(ws: WorkspaceCtx, roots: string[], atCreatedAt: string, restoreActionId: string): Promise<void> {
  if (!roots.length) return;
  const under = sql.join(roots.map(atOrUnder), sql` OR `);
  const candidates = new Set<string>();
  for (const t of TABLES) {
    const rows = await db.execute<{ path: string }>(sql`
      SELECT DISTINCT r.path FROM ${sql.identifier(t)} r JOIN actions a ON a.id = r.detached_by_action_id
      WHERE r.workspace_id = ${ws.id} AND r.detached_at IS NOT NULL AND r.detached_by_action_id <> ${restoreActionId}
        AND a.created_at >= ${atCreatedAt}::timestamptz AND (${under})
      LIMIT 2000`);
    for (const r of rows) candidates.add(r.path);
  }
  if (!candidates.size) return;
  const present = (await mapLimit([...candidates], 8, async (p) => ((await statOrNull(ws, p)) ? p : null))).filter(
    (p): p is string => p !== null,
  );
  if (!present.length) return;
  const paths = sql.join(
    present.map((p) => sql`${p}`),
    sql`, `,
  );
  for (const t of TABLES) {
    await db.execute(sql`
      UPDATE ${sql.identifier(t)} SET detached_at = NULL, detached_by_action_id = NULL
      WHERE workspace_id = ${ws.id} AND detached_at IS NOT NULL AND detached_by_action_id <> ${restoreActionId}
        AND path IN (${paths})
        AND detached_by_action_id IN (SELECT id FROM actions WHERE workspace_id = ${ws.id} AND created_at >= ${atCreatedAt}::timestamptz)
        ${noLiveTwin(t)}`);
  }
}

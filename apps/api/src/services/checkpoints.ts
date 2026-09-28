// Checkpoints: named versions kept forever. Each one is a Platinum tag
// `cp-<id>` on a commit plus a row in `checkpoints`. Tags are shared with
// pinned links (100 per volume). Owner: API-versioning.

import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Checkpoint, CheckpointListResponse } from '@volumes/shared';
import { db } from '../db/client';
import { checkpoints, type CheckpointRow } from '../db/schema';
import { ApiError } from '../lib/http';
import { newId } from '../lib/ids';
import { getStore } from '../storage';
import { isStoreError, type Commit, type Ref } from '../storage/types';
import type { WorkspaceCtx } from '../types';
import type { ActionCtx } from './ledger';
import { assertTagBudget, checkpointTag, tagBudget } from './tags';
import { mapLimit } from './versioning-util';

function toCheckpoint(row: CheckpointRow, commit: Pick<Commit, 'logicalBytes' | 'fileCount'> | null): Checkpoint {
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    commitId: row.commitId,
    createdAt: row.createdAt.toISOString(),
    auto: row.auto,
    logicalBytes: commit?.logicalBytes ?? 0,
    fileCount: commit?.fileCount ?? 0,
  };
}

async function commitOrNull(volumeId: string, ref: string): Promise<Commit | null> {
  try {
    return await getStore().getCommit(volumeId, ref);
  } catch (e) {
    if (isStoreError(e, 'not_found')) return null;
    throw e;
  }
}

/** Tags `at` (default head) as `cp-<id>` and records the checkpoint row. */
export async function createCheckpoint(
  ctx: ActionCtx,
  input: { name: string; note?: string; at?: Ref; auto?: boolean },
): Promise<Checkpoint> {
  const store = getStore();
  const name = input.name.trim();
  if (!name) throw new ApiError(400, 'bad_request', 'A checkpoint needs a name.');
  await assertTagBudget(ctx.ws);
  const id = newId();
  const tagName = checkpointTag(id);
  const tag = await store.putTag(ctx.ws.volumeId, tagName, input.at ?? 'head');
  try {
    const commit = await store.getCommit(ctx.ws.volumeId, tag.commitId);
    const [row] = await db
      .insert(checkpoints)
      .values({
        id,
        workspaceId: ctx.ws.id,
        name,
        note: input.note ?? '',
        tag: tagName,
        commitId: tag.commitId,
        auto: input.auto ?? false,
        createdBy: ctx.userId,
      })
      .returning();
    return toCheckpoint(row, commit);
  } catch (e) {
    await store.deleteTag(ctx.ws.volumeId, tagName).catch(() => {});
    throw e;
  }
}

/** Every checkpoint of the workspace (newest first) with sizes, plus the tag budget. */
export async function listCheckpoints(ws: WorkspaceCtx): Promise<CheckpointListResponse> {
  const rows = await db
    .select()
    .from(checkpoints)
    .where(eq(checkpoints.workspaceId, ws.id))
    .orderBy(desc(checkpoints.createdAt), desc(checkpoints.id));
  const [commits, budget] = await Promise.all([
    mapLimit(rows, 8, (r) => commitOrNull(ws.volumeId, r.commitId)),
    tagBudget(ws),
  ]);
  return { checkpoints: rows.map((r, i) => toCheckpoint(r, commits[i])), budget };
}

export async function getCheckpointRow(wsId: string, id: string): Promise<CheckpointRow | null> {
  const [row] = await db
    .select()
    .from(checkpoints)
    .where(and(eq(checkpoints.workspaceId, wsId), eq(checkpoints.id, id)));
  return row ?? null;
}

export async function updateCheckpoint(
  ws: WorkspaceCtx,
  id: string,
  patch: { name?: string; note?: string },
): Promise<{ before: CheckpointRow; checkpoint: Checkpoint }> {
  const before = await getCheckpointRow(ws.id, id);
  if (!before) throw new ApiError(404, 'not_found', 'No such checkpoint.');
  const set: Partial<Pick<CheckpointRow, 'name' | 'note'>> = {};
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.note !== undefined) set.note = patch.note;
  const [row] = await db
    .update(checkpoints)
    .set(set)
    .where(and(eq(checkpoints.workspaceId, ws.id), eq(checkpoints.id, id)))
    .returning();
  return { before, checkpoint: toCheckpoint(row, await commitOrNull(ws.volumeId, row.commitId)) };
}

/** Removes the tag (a tag already gone is fine) and the row. */
export async function deleteCheckpoint(ws: WorkspaceCtx, id: string): Promise<CheckpointRow> {
  const row = await getCheckpointRow(ws.id, id);
  if (!row) throw new ApiError(404, 'not_found', 'No such checkpoint.');
  try {
    await getStore().deleteTag(ws.volumeId, row.tag);
  } catch (e) {
    if (!isStoreError(e, 'not_found')) throw e;
  }
  await db.delete(checkpoints).where(and(eq(checkpoints.workspaceId, ws.id), eq(checkpoints.id, id)));
  return row;
}

/** commit id → checkpoints on it, for the given commits. */
export async function checkpointsByCommit(wsId: string, commitIds: string[]): Promise<Map<string, CheckpointRow[]>> {
  const out = new Map<string, CheckpointRow[]>();
  if (!commitIds.length) return out;
  const rows = await db
    .select()
    .from(checkpoints)
    .where(and(eq(checkpoints.workspaceId, wsId), inArray(checkpoints.commitId, [...new Set(commitIds)])))
    .orderBy(checkpoints.createdAt);
  for (const r of rows) {
    const l = out.get(r.commitId) ?? [];
    l.push(r);
    out.set(r.commitId, l);
  }
  return out;
}

/** Every checkpoint row of a workspace (oldest first). */
export async function allCheckpointRows(wsId: string): Promise<CheckpointRow[]> {
  return db.select().from(checkpoints).where(eq(checkpoints.workspaceId, wsId)).orderBy(checkpoints.createdAt);
}

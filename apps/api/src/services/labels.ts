// A drive's tags ("labels" here: services/tags.ts is the volume's own tags, the
// checkpoints and pinned links that keep versions). Every member sees them; the
// owner and editors create, rename, recolour and delete them, and put them on
// files and folders. An assignment names its item by path and follows it like a
// comment does (services/follow.ts).

import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { MAX_LABELS_PER_DRIVE, type FileEntry, type FileLabel, type LabelAssignment, type LabelColor, type LabelListResponse } from '@volumes/shared';
import { db } from '../db/client';
import { fileLabelAssignments, fileLabels, type FileLabelRow } from '../db/schema';
import { audit } from '../lib/audit';
import { ApiError } from '../lib/http';
import { newId } from '../lib/ids';
import type { WorkspaceCtx } from '../types';
import { statOrNull } from './tree';
import { mapLimit } from './versioning-util';

const LABEL_ID = /^[0-9a-z]{26}$/;

const nameTaken = () => new ApiError(409, 'conflict', 'A tag with that name already exists in this drive.');

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } } | null)?.code ?? (e as { cause?: { code?: string } } | null)?.cause?.code;
  return code === '23505';
}

function toLabel(row: FileLabelRow, n: number): FileLabel {
  return { id: row.id, name: row.name, color: row.color as LabelColor, count: n, createdAt: row.createdAt.toISOString() };
}

/** Live assignments per label. */
async function countsOf(wsId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ labelId: fileLabelAssignments.labelId, n: count() })
    .from(fileLabelAssignments)
    .where(and(eq(fileLabelAssignments.workspaceId, wsId), isNull(fileLabelAssignments.detachedAt)))
    .groupBy(fileLabelAssignments.labelId);
  return new Map(rows.map((r) => [r.labelId, Number(r.n)]));
}

/** The drive's tags (by name) and which items carry them now. */
export async function listLabels(ws: WorkspaceCtx): Promise<LabelListResponse> {
  const [labels, counts, rows] = await Promise.all([
    db.select().from(fileLabels).where(eq(fileLabels.workspaceId, ws.id)).orderBy(sql`lower(${fileLabels.name})`, asc(fileLabels.id)),
    countsOf(ws.id),
    db
      .select({ path: fileLabelAssignments.path, labelId: fileLabelAssignments.labelId })
      .from(fileLabelAssignments)
      .where(and(eq(fileLabelAssignments.workspaceId, ws.id), isNull(fileLabelAssignments.detachedAt)))
      .orderBy(asc(fileLabelAssignments.path), asc(fileLabelAssignments.createdAt)),
  ]);
  const byPath = new Map<string, string[]>();
  for (const r of rows) byPath.set(r.path, [...(byPath.get(r.path) ?? []), r.labelId]);
  const assignments: LabelAssignment[] = [...byPath].map(([path, labelIds]) => ({ path, labelIds }));
  return { labels: labels.map((l) => toLabel(l, counts.get(l.id) ?? 0)), assignments };
}

async function getLabel(ws: WorkspaceCtx, id: string): Promise<FileLabelRow> {
  if (!LABEL_ID.test(id)) throw new ApiError(404, 'not_found', 'Tag not found.');
  const [row] = await db
    .select()
    .from(fileLabels)
    .where(and(eq(fileLabels.id, id), eq(fileLabels.workspaceId, ws.id)))
    .limit(1);
  if (!row) throw new ApiError(404, 'not_found', 'Tag not found.');
  return row;
}

async function labelOut(ws: WorkspaceCtx, row: FileLabelRow): Promise<FileLabel> {
  return toLabel(row, (await countsOf(ws.id)).get(row.id) ?? 0);
}

export async function createLabel(c: Context | null, ws: WorkspaceCtx, userId: string, input: { name: string; color: LabelColor }): Promise<FileLabel> {
  const [{ n }] = await db.select({ n: count() }).from(fileLabels).where(eq(fileLabels.workspaceId, ws.id));
  if (Number(n) >= MAX_LABELS_PER_DRIVE) throw new ApiError(409, 'conflict', `A drive can have at most ${MAX_LABELS_PER_DRIVE} tags.`);
  let row: FileLabelRow;
  try {
    [row] = await db.insert(fileLabels).values({ id: newId(), workspaceId: ws.id, name: input.name, color: input.color, createdBy: userId }).returning();
  } catch (e) {
    if (isUniqueViolation(e)) throw nameTaken();
    throw e;
  }
  await audit(c, { kind: 'label.create', userId, workspaceId: ws.id, target: row.name, meta: { labelId: row.id, color: row.color } });
  return toLabel(row, 0);
}

export async function updateLabel(
  c: Context | null,
  ws: WorkspaceCtx,
  userId: string,
  id: string,
  input: { name?: string; color?: LabelColor },
): Promise<FileLabel> {
  const row = await getLabel(ws, id);
  const set: Partial<FileLabelRow> = {};
  if (input.name !== undefined && input.name !== row.name) set.name = input.name;
  if (input.color !== undefined && input.color !== row.color) set.color = input.color;
  if (!Object.keys(set).length) return labelOut(ws, row);
  let next: FileLabelRow;
  try {
    [next] = await db.update(fileLabels).set(set).where(eq(fileLabels.id, row.id)).returning();
  } catch (e) {
    if (isUniqueViolation(e)) throw nameTaken();
    throw e;
  }
  await audit(c, {
    kind: 'label.update',
    userId,
    workspaceId: ws.id,
    target: next.name,
    meta: { labelId: row.id, from: { name: row.name, color: row.color }, to: { name: next.name, color: next.color } },
  });
  return labelOut(ws, next);
}

/** Deletes a tag and takes it off every item. */
export async function deleteLabel(c: Context | null, ws: WorkspaceCtx, userId: string, id: string): Promise<void> {
  const row = await getLabel(ws, id);
  const items = (await countsOf(ws.id)).get(row.id) ?? 0;
  await db.delete(fileLabels).where(eq(fileLabels.id, row.id));
  await audit(c, { kind: 'label.delete', userId, workspaceId: ws.id, target: row.name, meta: { labelId: row.id, items } });
}

/** The items carrying a tag now, as listing entries (folders first, then by path). */
export async function labelItems(ws: WorkspaceCtx, id: string): Promise<FileEntry[]> {
  const label = await getLabel(ws, id);
  const rows = await db
    .select({ path: fileLabelAssignments.path })
    .from(fileLabelAssignments)
    .where(and(eq(fileLabelAssignments.labelId, label.id), isNull(fileLabelAssignments.detachedAt)))
    .orderBy(asc(fileLabelAssignments.path))
    .limit(2000);
  const stats = await mapLimit(rows, 8, (r) => statOrNull(ws, r.path));
  return stats
    .filter((st): st is NonNullable<typeof st> => !!st && (st.type === 'file' || st.type === 'dir'))
    .map(({ path, name, type, size, mtime }) => ({ path, name, type, size, mtime }));
}

/** Puts a tag on every named item (each must exist now), or takes it off. */
export async function assignLabel(ws: WorkspaceCtx, userId: string, input: { labelId: string; paths: string[]; assigned: boolean }): Promise<LabelListResponse> {
  const label = await getLabel(ws, input.labelId);
  const paths = [...new Set(input.paths)];
  if (paths.includes('/')) throw new ApiError(400, 'bad_request', 'Tag files and folders, not the whole drive.');
  if (input.assigned) {
    const missing = (await mapLimit(paths, 8, async (p) => ((await statOrNull(ws, p)) ? null : p))).filter((p): p is string => p !== null);
    if (missing.length) throw new ApiError(404, 'path_not_found', 'Some of those items do not exist any more.', { paths: missing.slice(0, 20) });
    await db
      .insert(fileLabelAssignments)
      .values(paths.map((path) => ({ id: newId(), workspaceId: ws.id, labelId: label.id, path, createdBy: userId })))
      .onConflictDoNothing();
  } else {
    await db
      .delete(fileLabelAssignments)
      .where(
        and(
          eq(fileLabelAssignments.workspaceId, ws.id),
          eq(fileLabelAssignments.labelId, label.id),
          inArray(fileLabelAssignments.path, paths),
          isNull(fileLabelAssignments.detachedAt),
        ),
      );
  }
  return listLabels(ws);
}

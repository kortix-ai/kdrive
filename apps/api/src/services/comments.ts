// Comments on files. Every member of a drive (owner, editors and viewers) reads
// and writes them; each person edits their own, deletes their own, and the
// drive's owner may delete any. A thread is a first comment and its replies (one
// level); anyone who can comment resolves or reopens it.
//
// A comment names its file by path and follows it (services/follow.ts): moves
// carry it along, a delete detaches it, and an undo or restore brings it back.

import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { decodeTime } from 'ulid';
import type { CommentCount, FileComment } from '@volumes/shared';
import { db } from '../db/client';
import { bauthUser, fileComments, type FileCommentRow } from '../db/schema';
import { audit } from '../lib/audit';
import { ApiError } from '../lib/http';
import { newId } from '../lib/ids';
import type { WorkspaceCtx } from '../types';
import { statOrNull } from './tree';

const COMMENT_ID = /^[0-9a-z]{26}$/;
/** A file takes at most this many comments (threads and replies). */
export const MAX_COMMENTS_PER_FILE = 1000;

type Author = { id: string | null; name: string | null; email: string | null; image: string | null };
type Viewer = { userId: string; ws: WorkspaceCtx };

/** When a `vc_<ulid>` commit was made (null for anything else). */
function commitTime(commitId: string | null): string | null {
  if (!commitId?.startsWith('vc_')) return null;
  try {
    return new Date(decodeTime(commitId.slice(3))).toISOString();
  } catch {
    return null;
  }
}

function toComment(row: FileCommentRow, author: Author, v: Viewer): FileComment {
  const own = !!row.userId && row.userId === v.userId;
  return {
    id: row.id,
    path: row.path,
    parentId: row.parentId,
    author,
    body: row.body,
    commitId: row.commitId,
    commitAt: commitTime(row.commitId),
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedBy: row.resolvedBy,
    canEdit: own,
    canDelete: own || v.ws.role === 'owner',
  };
}

const withAuthor = () =>
  db
    .select({ c: fileComments, id: bauthUser.id, name: bauthUser.name, email: bauthUser.email, image: bauthUser.image })
    .from(fileComments)
    .leftJoin(bauthUser, eq(bauthUser.id, fileComments.userId));

/** The comments on the file at `path` now, oldest first (the client groups threads by `parentId`). */
export async function listComments(ws: WorkspaceCtx, userId: string, path: string): Promise<FileComment[]> {
  const rows = await withAuthor()
    .where(and(eq(fileComments.workspaceId, ws.id), eq(fileComments.path, path), isNull(fileComments.detachedAt)))
    .orderBy(asc(fileComments.createdAt), asc(fileComments.id));
  return rows.map((r) => toComment(r.c, { id: r.id, name: r.name, email: r.email, image: r.image }, { userId, ws }));
}

/** Every file of the drive that has comments: how many, and how many threads are open. */
export async function commentCounts(ws: WorkspaceCtx): Promise<CommentCount[]> {
  const rows = await db
    .select({
      path: fileComments.path,
      count: count(),
      open: sql<number>`count(*) FILTER (WHERE ${fileComments.parentId} IS NULL AND ${fileComments.resolvedAt} IS NULL)`.mapWith(Number),
    })
    .from(fileComments)
    .where(and(eq(fileComments.workspaceId, ws.id), isNull(fileComments.detachedAt)))
    .groupBy(fileComments.path)
    .orderBy(asc(fileComments.path));
  return rows.map((r) => ({ path: r.path, count: Number(r.count), open: r.open }));
}

async function getLive(ws: WorkspaceCtx, id: string): Promise<FileCommentRow> {
  if (!COMMENT_ID.test(id)) throw new ApiError(404, 'not_found', 'Comment not found.');
  const [row] = await db
    .select()
    .from(fileComments)
    .where(and(eq(fileComments.id, id), eq(fileComments.workspaceId, ws.id), isNull(fileComments.detachedAt)))
    .limit(1);
  if (!row) throw new ApiError(404, 'not_found', 'Comment not found.');
  return row;
}

async function one(ws: WorkspaceCtx, userId: string, id: string): Promise<FileComment> {
  const [r] = await withAuthor().where(eq(fileComments.id, id)).limit(1);
  if (!r) throw new ApiError(404, 'not_found', 'Comment not found.');
  return toComment(r.c, { id: r.id, name: r.name, email: r.email, image: r.image }, { userId, ws });
}

/**
 * Adds a comment on the file at `path` (a reply when `parentId` names any comment
 * of a thread on that file). It records the file's current version.
 */
export async function addComment(ws: WorkspaceCtx, userId: string, input: { path: string; body: string; parentId?: string }): Promise<FileComment> {
  const st = await statOrNull(ws, input.path);
  if (!st) throw new ApiError(404, 'path_not_found', 'That file does not exist.', { path: input.path });
  if (st.type !== 'file') throw new ApiError(400, 'not_a_file', 'Only files take comments.');
  let parentId: string | null = null;
  if (input.parentId) {
    const parent = await getLive(ws, input.parentId);
    if (parent.path !== input.path) throw new ApiError(400, 'bad_request', 'That comment is on another file.');
    parentId = parent.parentId ?? parent.id;
  }
  const [{ n }] = await db
    .select({ n: count() })
    .from(fileComments)
    .where(and(eq(fileComments.workspaceId, ws.id), eq(fileComments.path, input.path), isNull(fileComments.detachedAt)));
  if (Number(n) >= MAX_COMMENTS_PER_FILE) {
    throw new ApiError(409, 'conflict', `This file already has ${MAX_COMMENTS_PER_FILE} comments.`);
  }
  const id = newId();
  await db.insert(fileComments).values({
    id,
    workspaceId: ws.id,
    path: input.path,
    parentId,
    userId,
    body: input.body,
    commitId: st.version ? `vc_${st.version}` : st.commitId,
  });
  // A reply to a resolved thread reopens it.
  if (parentId) await db.update(fileComments).set({ resolvedAt: null, resolvedBy: null }).where(eq(fileComments.id, parentId));
  return one(ws, userId, id);
}

/** Edits the body (the author only) and/or resolves or reopens the thread (a thread's first comment). */
export async function updateComment(ws: WorkspaceCtx, userId: string, id: string, input: { body?: string; resolved?: boolean }): Promise<FileComment> {
  const row = await getLive(ws, id);
  const set: Partial<FileCommentRow> = {};
  if (input.body !== undefined && input.body !== row.body) {
    if (row.userId !== userId) throw new ApiError(403, 'forbidden', 'You can only edit your own comments.');
    set.body = input.body;
    set.editedAt = new Date();
  }
  if (input.resolved !== undefined) {
    if (row.parentId) throw new ApiError(400, 'bad_request', 'Resolve the thread from its first comment.');
    if (input.resolved && !row.resolvedAt) Object.assign(set, { resolvedAt: new Date(), resolvedBy: userId });
    if (!input.resolved && row.resolvedAt) Object.assign(set, { resolvedAt: null, resolvedBy: null });
  }
  if (Object.keys(set).length) await db.update(fileComments).set(set).where(eq(fileComments.id, row.id));
  return one(ws, userId, row.id);
}

/** Deletes a comment (a thread's first comment takes its replies along). Own comments, or any for the drive's owner. */
export async function deleteComment(c: Context | null, ws: WorkspaceCtx, userId: string, id: string): Promise<void> {
  const row = await getLive(ws, id);
  const own = row.userId === userId;
  if (!own && ws.role !== 'owner') throw new ApiError(403, 'forbidden', 'You can only delete your own comments.');
  await db.delete(fileComments).where(eq(fileComments.id, row.id));
  if (!own) {
    await audit(c, { kind: 'comment.delete', userId, workspaceId: ws.id, target: row.path, meta: { commentId: row.id, authorId: row.userId } });
  }
}

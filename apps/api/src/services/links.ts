import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { basename, type CreateLinkRequest, type LinkKind, type ShareLink, type UpdateLinkRequest } from '@volumes/shared';
import { db } from '../db/client';
import { bauthUser, shareLinks, workspaces, type ShareLinkRow } from '../db/schema';
import { env } from '../env';
import { audit } from '../lib/audit';
import { ApiError } from '../lib/http';
import { newId, newToken } from '../lib/ids';
import { getStore } from '../storage';
import { isStoreError, type Ref } from '../storage/types';
import type { WorkspaceCtx } from '../types';
import { hashLinkPassword, mailLinkToPeople } from './link-access';
import { assertTagBudget, linkTag } from './tags';
import { statOrNull } from './tree';
import { ensureVolume, toCtx } from './workspaces';

/** Share tokens are 24 random bytes in base64url (32 chars). Anything else is unknown. */
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const LINK_ID = /^[0-9a-z]{26}$/;

export function shareUrl(token: string, kind: LinkKind = 'view'): string {
  return `${env.BETTER_AUTH_URL}/${kind === 'upload' ? 'u' : 's'}/${token}`;
}

export function toShareLink(row: ShareLinkRow): ShareLink {
  return {
    id: row.id,
    kind: row.kind,
    url: shareUrl(row.token, row.kind),
    token: row.token,
    path: row.path,
    targetType: row.targetType,
    mode: row.mode,
    commitId: row.commitId,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    detachedAt: row.detachedAt ? row.detachedAt.toISOString() : null,
    openCount: row.openCount,
    lastOpenedAt: row.lastOpenedAt ? row.lastOpenedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    hasPassword: !!row.passwordHash,
    allowDownload: row.allowDownload,
    allowedEmails: row.allowedEmails,
    ...(row.kind === 'upload'
      ? { maxFileBytes: row.maxFileBytes, maxFiles: row.maxFiles, uploadCount: row.uploadCount, uploadBytes: row.uploadBytes }
      : {}),
  };
}

/** An ISO expiry from the client: must be in the future. null = never expires. */
function parseExpiry(v: string | null | undefined): Date | null {
  if (v === undefined || v === null) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, 'bad_request', 'Invalid expiry date.');
  if (d.getTime() <= Date.now()) throw new ApiError(400, 'bad_request', 'The expiry date must be in the future.');
  return d;
}

/** Access fields as audit meta: never the password, only whether there is one. */
function accessMeta(row: Pick<ShareLinkRow, 'passwordHash' | 'allowDownload' | 'allowedEmails'>) {
  return { password: !!row.passwordHash, allowDownload: row.allowDownload, people: row.allowedEmails.length };
}

/** Mails the newly listed people (looks the sender up, so callers only pass the user id). */
async function mailNewPeople(row: ShareLinkRow, userId: string, workspaceName: string, emails: string[]): Promise<void> {
  if (!emails.length) return;
  const [sender] = await db.select({ name: bauthUser.name, email: bauthUser.email }).from(bauthUser).where(eq(bauthUser.id, userId)).limit(1);
  if (!sender) return;
  mailLinkToPeople(row, shareUrl(row.token, row.kind), linkDisplayName(row, workspaceName), sender, emails);
}

/**
 * Links of a workspace (optionally for one path), newest first. Revoked ones
 * are included (the UI badges them). For one path, links detached from a
 * deleted item are left out: they belong to that item, not to whatever sits
 * at the path now.
 */
export async function listLinks(ws: WorkspaceCtx, path?: string): Promise<ShareLink[]> {
  const where = path
    ? and(eq(shareLinks.workspaceId, ws.id), eq(shareLinks.path, path), isNull(shareLinks.detachedAt))
    : eq(shareLinks.workspaceId, ws.id);
  const rows = await db.select().from(shareLinks).where(where).orderBy(desc(shareLinks.createdAt), desc(shareLinks.id));
  return rows.map(toShareLink);
}

async function getOwnLink(ws: WorkspaceCtx, id: string): Promise<ShareLinkRow> {
  if (!LINK_ID.test(id)) throw new ApiError(404, 'not_found', 'Link not found.');
  const [row] = await db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.id, id), eq(shareLinks.workspaceId, ws.id)))
    .limit(1);
  if (!row) throw new ApiError(404, 'not_found', 'Link not found.');
  return row;
}

/**
 * Creates a live or pinned link. The target type comes from a stat at the
 * link's version. A pinned link tags its commit (`ln-<id>`) so retention keeps it.
 * An upload link is always live and names a folder.
 */
export async function createLink(
  c: Context | null,
  ws: WorkspaceCtx,
  userId: string,
  input: Pick<CreateLinkRequest, 'password' | 'allowDownload' | 'allowedEmails'> & {
    path: string;
    mode: 'live' | 'pinned';
    at?: Ref;
    expiresAt?: string | null;
    kind?: LinkKind;
    maxFileBytes?: number | null;
    maxFiles?: number | null;
  },
): Promise<ShareLink> {
  const store = getStore();
  const kind = input.kind ?? 'view';
  if (kind === 'upload' && input.mode !== 'live') throw new ApiError(400, 'bad_request', 'An upload link is always live.');
  const expiresAt = parseExpiry(input.expiresAt);
  const passwordHash = input.password ? await hashLinkPassword(input.password) : null;
  const allowedEmails = input.allowedEmails ?? [];
  const id = newId();

  let commitId: string | null = null;
  let statAt: Ref | undefined;
  if (input.mode === 'pinned') {
    // Resolve the ref (commit id, tag or head) to a concrete commit id.
    commitId = (await store.getCommit(ws.volumeId, input.at ?? 'head')).id;
    statAt = commitId;
  }
  const st = await statOrNull(ws, input.path, statAt);
  if (!st) {
    throw new ApiError(404, 'path_not_found', 'That file or folder does not exist at this version.', { path: input.path });
  }
  if (st.type !== 'file' && st.type !== 'dir') throw new ApiError(400, 'bad_request', 'Only files and folders can be shared.');
  if (kind === 'upload' && st.type !== 'dir') throw new ApiError(400, 'not_a_directory', 'Files can only be sent into a folder.');

  let tag: string | null = null;
  if (commitId) {
    await assertTagBudget(ws);
    tag = linkTag(id);
    await store.putTag(ws.volumeId, tag, commitId);
  }

  let row: ShareLinkRow;
  try {
    [row] = await db
      .insert(shareLinks)
      .values({
        id,
        token: newToken(),
        workspaceId: ws.id,
        userId,
        path: input.path,
        targetType: st.type,
        mode: input.mode,
        commitId,
        tag,
        expiresAt,
        passwordHash,
        allowDownload: kind === 'upload' ? true : (input.allowDownload ?? true), // nothing to download through an upload link
        allowedEmails,
        kind,
        maxFileBytes: kind === 'upload' ? (input.maxFileBytes ?? null) : null,
        maxFiles: kind === 'upload' ? (input.maxFiles ?? null) : null,
      })
      .returning();
  } catch (e) {
    if (tag) await store.deleteTag(ws.volumeId, tag).catch(() => {});
    throw e;
  }
  await audit(c, {
    kind: 'link.create',
    userId,
    workspaceId: ws.id,
    target: input.path,
    meta: { linkId: id, kind, mode: input.mode, commitId, expiresAt: expiresAt?.toISOString() ?? null, ...accessMeta(row) },
  });
  await mailNewPeople(row, userId, ws.name, allowedEmails);
  return toShareLink(row);
}

/**
 * Changes a (not revoked) link's expiry and access: absent fields stay as they
 * are. A new or removed password signs out everyone who unlocked it; people
 * added to the list get the link by mail.
 */
export async function updateLink(
  c: Context | null,
  ws: WorkspaceCtx,
  userId: string,
  id: string,
  input: Pick<UpdateLinkRequest, 'expiresAt' | 'password' | 'allowDownload' | 'allowedEmails'>,
): Promise<ShareLink> {
  const row = await getOwnLink(ws, id);
  if (row.revokedAt) throw new ApiError(409, 'conflict', 'This link was revoked and can no longer be changed.');
  const set: Partial<Pick<ShareLinkRow, 'expiresAt' | 'passwordHash' | 'allowDownload' | 'allowedEmails'>> = {};
  if (input.expiresAt !== undefined) set.expiresAt = parseExpiry(input.expiresAt);
  if (input.password !== undefined) set.passwordHash = input.password ? await hashLinkPassword(input.password) : null;
  if (input.allowDownload !== undefined) set.allowDownload = input.allowDownload;
  if (input.allowedEmails !== undefined) set.allowedEmails = input.allowedEmails;
  if (Object.keys(set).length === 0) return toShareLink(row);
  const [next] = await db.update(shareLinks).set(set).where(eq(shareLinks.id, row.id)).returning();
  await audit(c, {
    kind: 'link.update',
    userId,
    workspaceId: ws.id,
    target: row.path,
    meta: {
      linkId: row.id,
      from: row.expiresAt?.toISOString() ?? null,
      to: next.expiresAt?.toISOString() ?? null,
      ...accessMeta(next),
      ...(input.password !== undefined ? { passwordChanged: true } : {}),
    },
  });
  const added = next.allowedEmails.filter((e) => !row.allowedEmails.includes(e));
  await mailNewPeople(next, userId, ws.name, added);
  return toShareLink(next);
}

/** Revokes a link (idempotent) and frees a pinned link's tag. */
export async function revokeLink(c: Context | null, ws: WorkspaceCtx, userId: string, id: string): Promise<void> {
  const row = await getOwnLink(ws, id);
  if (!row.revokedAt) {
    await db.update(shareLinks).set({ revokedAt: new Date() }).where(and(eq(shareLinks.id, row.id), isNull(shareLinks.revokedAt)));
    await audit(c, { kind: 'link.revoke', userId, workspaceId: ws.id, target: row.path, meta: { linkId: row.id, mode: row.mode } });
  }
  if (row.tag) await untagQuietly(ws.volumeId, row.tag);
}

async function untagQuietly(volumeId: string, tag: string): Promise<void> {
  try {
    await getStore().deleteTag(volumeId, tag);
  } catch (e) {
    if (isStoreError(e, 'not_found') || isStoreError(e, 'volume_not_found')) return;
    throw e;
  }
}

export interface PublicLink {
  link: ShareLinkRow;
  ws: WorkspaceCtx;
  at: string | undefined;
  ownerName: string | null;
  workspaceName: string;
}

/**
 * resolvePublicLink plus the owner's display name (for the public page). A
 * token of the other kind is unknown here: an upload link never opens as a
 * view link, nor the reverse.
 */
export async function resolvePublicLinkFull(token: string, kind: LinkKind = 'view'): Promise<PublicLink> {
  if (!TOKEN.test(token)) throw new ApiError(404, 'not_found', 'This link does not exist.');
  const [hit] = await db
    .select({ link: shareLinks, ws: workspaces, ownerName: bauthUser.name })
    .from(shareLinks)
    .innerJoin(workspaces, eq(workspaces.id, shareLinks.workspaceId))
    .innerJoin(bauthUser, eq(bauthUser.id, shareLinks.userId))
    .where(and(eq(shareLinks.token, token), isNull(workspaces.deletedAt)))
    .limit(1);
  if (!hit) throw new ApiError(404, 'not_found', 'This link does not exist.');
  const { link } = hit;
  if (link.kind !== kind) throw new ApiError(404, 'not_found', 'This link does not exist.');
  if (link.revokedAt) throw new ApiError(410, 'link_revoked', 'This link was revoked by its owner.');
  // The shared item was deleted: whatever appears at that path later is not what was shared.
  if (link.detachedAt) throw new ApiError(404, 'not_found', 'Nothing is shared at this address.');
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) throw new ApiError(410, 'link_expired', 'This link has expired.');
  const ws = toCtx(await ensureVolume(hit.ws));
  return {
    link,
    ws,
    at: link.mode === 'pinned' && link.commitId ? link.commitId : undefined,
    ownerName: hit.ownerName ?? null,
    workspaceName: hit.ws.name,
  };
}

/** Resolves a public token: 404 unknown, 410 link_revoked / link_expired; `at` = pinned commit or undefined (live). */
export async function resolvePublicLink(token: string): Promise<{ link: ShareLinkRow; ws: WorkspaceCtx; at: string | undefined }> {
  const r = await resolvePublicLinkFull(token);
  return { link: r.link, ws: r.ws, at: r.at };
}

/** Counts one open of a link (the public meta route only). */
export async function recordLinkOpen(linkId: string): Promise<void> {
  await db
    .update(shareLinks)
    .set({ openCount: sql`${shareLinks.openCount} + 1`, lastOpenedAt: new Date() })
    .where(eq(shareLinks.id, linkId));
}

/** Display name of a link target: the item name, or the workspace name for the root. */
export function linkDisplayName(link: Pick<ShareLinkRow, 'path'>, workspaceName: string): string {
  return basename(link.path) || workspaceName;
}

/**
 * Drops every link of a workspace (used when the workspace is deleted). Tags go
 * with the volume, so only rows are removed here.
 */
export async function deleteWorkspaceLinks(workspaceId: string): Promise<number> {
  const rows = await db.delete(shareLinks).where(eq(shareLinks.workspaceId, workspaceId)).returning({ id: shareLinks.id });
  return rows.length;
}

// ── live links follow their item ─────────────────────────────────────────────
// A live link names a path, so every mutation that moves or removes an item
// updates the links rooted at or under it, inside the same workspace lock.
// Pinned links read their own commit and never change.

/** Links rooted at `p` or anywhere under it (never matches siblings like `/a b` for `/a`). */
const atOrUnder = (p: string) =>
  p === '/' ? sql`true` : sql`(${shareLinks.path} = ${p} OR starts_with(${shareLinks.path}, ${p + '/'}))`;

/** A move / rename: live links at or under `from` now point at the same item under `to`. */
export async function moveLiveLinks(wsId: string, from: string, to: string): Promise<void> {
  if (from === to || from === '/') return;
  await db.execute(sql`
    UPDATE share_links SET path = ${to} || substr(path, char_length(${from}) + 1)
    WHERE workspace_id = ${wsId} AND mode = 'live' AND revoked_at IS NULL AND detached_at IS NULL
      AND ${atOrUnder(from)}`);
}

/** The item at `path` is gone (deleted, replaced or removed by a restore): detach its live links. */
export async function detachLiveLinks(wsId: string, path: string, actionId: string): Promise<void> {
  await db.execute(sql`
    UPDATE share_links SET detached_at = now(), detached_by_action_id = ${actionId}
    WHERE workspace_id = ${wsId} AND mode = 'live' AND revoked_at IS NULL AND detached_at IS NULL
      AND ${atOrUnder(path)}`);
}

/** Undo of `actionId` put its items back: the links it detached work again. */
export async function reattachLinks(wsId: string, actionId: string): Promise<void> {
  await db
    .update(shareLinks)
    .set({ detachedAt: null, detachedByActionId: null })
    .where(and(eq(shareLinks.workspaceId, wsId), eq(shareLinks.detachedByActionId, actionId)));
}

/**
 * Undo of a move put the item back at `from`. The undo removed `to` (detaching
 * its links under the undo's own action id); move those links back and re-attach them.
 */
export async function unmoveLiveLinks(wsId: string, to: string, from: string, undoActionId: string): Promise<void> {
  if (from === to || to === '/') return;
  await db.execute(sql`
    UPDATE share_links SET path = ${from} || substr(path, char_length(${to}) + 1), detached_at = NULL, detached_by_action_id = NULL
    WHERE workspace_id = ${wsId} AND mode = 'live' AND revoked_at IS NULL
      AND (detached_at IS NULL OR detached_by_action_id = ${undoActionId})
      AND ${atOrUnder(to)}`);
}

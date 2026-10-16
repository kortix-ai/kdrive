// Drive members and invitations.
//
// A drive has one owner (workspaces.user_id) and any number of members, each an
// editor (changes files) or a viewer (reads only). Only the owner invites,
// changes roles and removes people; a member can leave. Nobody joins until the
// invitee, signed in with the invited (verified) address, accepts: so an
// invitation never reveals whether an address has an account, and nobody lands
// in a drive they did not ask for.
//
// A member's changes go into the owner's volume, so they count against the
// owner's quota (see quotaOwner in services/quota.ts and its callers).

import { and, asc, count, eq, gt, inArray, isNull, lte, ne } from 'drizzle-orm';
import type { Context } from 'hono';
import {
  INVITE_TTL_DAYS,
  MAX_DRIVE_PEOPLE,
  type DriveInvite,
  type DriveMember,
  type DriveRole,
  type Invitation,
  type MemberRole,
  type Person,
  type WorkspaceSummary,
} from '@volumes/shared';
import { appUrl } from '../auth/policy';
import { db } from '../db/client';
import { bauthUser, workspaceInvites, workspaceMembers, workspaces, type WorkspaceRow } from '../db/schema';
import { sendInBackground } from '../email/client';
import { renderDriveInvite } from '../email/templates/drive-invite';
import { audit } from '../lib/audit';
import { ApiError } from '../lib/http';
import { newId } from '../lib/ids';
import { checkRateLimitKey, limits } from '../middleware/rate-limit';
import type { SessionUser, WorkspaceCtx } from '../types';
import { ensureVolume, toCtx, toWorkspaceSummaries } from './workspaces';

const WS_ID = /^[0-9a-z]{26}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const notFound = () => new ApiError(404, 'not_found', 'Workspace not found.');
const ownerOnly = () => new ApiError(403, 'forbidden', 'Only the owner of this drive can manage its people.');

async function liveRow(wsId: string): Promise<WorkspaceRow | null> {
  if (!WS_ID.test(wsId)) return null;
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, wsId), isNull(workspaces.deletedAt)))
    .limit(1);
  return row ?? null;
}

async function memberRole(wsId: string, userId: string): Promise<MemberRole | null> {
  const [m] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, wsId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return m?.role ?? null;
}

/** The live drive and the user's role in it, or null when they have none (or it does not exist). */
async function access(userId: string, wsId: string): Promise<{ row: WorkspaceRow; role: DriveRole } | null> {
  const row = await liveRow(wsId);
  if (!row) return null;
  if (row.userId === userId) return { row, role: 'owner' };
  const role = await memberRole(row.id, userId);
  return role ? { row, role } : null;
}

/** The user's role in a live drive, or null. Cheap: never opens the volume. */
export async function driveRole(userId: string, wsId: string): Promise<DriveRole | null> {
  return (await access(userId, wsId))?.role ?? null;
}

/**
 * The workspace `wsId` if the user owns it or is a member, with their role; opens its volume.
 * Null for anything else, so other people's drives look the same as missing ones.
 */
export async function getWorkspaceAccess(userId: string, wsId: string): Promise<WorkspaceCtx | null> {
  const a = await access(userId, wsId);
  return a ? toCtx(await ensureVolume(a.row), a.role) : null;
}

/** Drives other people shared with the user, oldest membership first, as summaries carrying role and owner. */
export async function listSharedWorkspaceSummaries(userId: string): Promise<WorkspaceSummary[]> {
  const rows = await db
    .select({ ws: workspaces, role: workspaceMembers.role, owner: { id: bauthUser.id, name: bauthUser.name, email: bauthUser.email } })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .innerJoin(bauthUser, eq(bauthUser.id, workspaces.userId))
    .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)))
    .orderBy(asc(workspaceMembers.createdAt));
  // Provenance of someone else's drive would name their other drives: leave it out.
  const summaries = await toWorkspaceSummaries(rows.map((r) => ({ ...r.ws, forkedAtCommit: null, forkedFromWorkspaceId: null })));
  return summaries.map((s, i) => ({ ...s, isDefault: false, role: rows[i].role, owner: rows[i].owner }));
}

// ── people of one drive ─────────────────────────────────────────────────────

async function peopleCount(wsId: string): Promise<number> {
  const now = new Date();
  const [[m], [i]] = await Promise.all([
    db.select({ n: count() }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, wsId)),
    db.select({ n: count() }).from(workspaceInvites).where(and(eq(workspaceInvites.workspaceId, wsId), gt(workspaceInvites.expiresAt, now))),
  ]);
  return 1 + Number(m?.n ?? 0) + Number(i?.n ?? 0);
}

async function personById(id: string | null): Promise<Person | null> {
  if (!id) return null;
  const [u] = await db.select({ id: bauthUser.id, name: bauthUser.name, email: bauthUser.email }).from(bauthUser).where(eq(bauthUser.id, id));
  return u ?? null;
}

async function inviteViews(rows: (typeof workspaceInvites.$inferSelect)[]): Promise<DriveInvite[]> {
  const ids = [...new Set(rows.map((r) => r.invitedBy).filter((x): x is string => !!x))];
  const people = ids.length
    ? await db.select({ id: bauthUser.id, name: bauthUser.name, email: bauthUser.email }).from(bauthUser).where(inArray(bauthUser.id, ids))
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    invitedBy: (r.invitedBy && byId.get(r.invitedBy)) || null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Everyone with access (the owner first), plus the open invitations when the caller is the owner. */
export async function listPeople(userId: string, wsId: string): Promise<{ members: DriveMember[]; invites: DriveInvite[] }> {
  const a = await access(userId, wsId);
  if (!a) throw notFound();
  const owner = await personById(a.row.userId);
  const rows = await db
    .select({ id: bauthUser.id, name: bauthUser.name, email: bauthUser.email, role: workspaceMembers.role, since: workspaceMembers.createdAt })
    .from(workspaceMembers)
    .innerJoin(bauthUser, eq(bauthUser.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, a.row.id))
    .orderBy(asc(workspaceMembers.createdAt));
  const members: DriveMember[] = [
    ...(owner ? [{ ...owner, role: 'owner' as const, since: a.row.createdAt.toISOString() }] : []),
    ...rows.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, since: r.since.toISOString() })),
  ];
  if (a.role !== 'owner') return { members, invites: [] };
  const open = await db
    .select()
    .from(workspaceInvites)
    .where(and(eq(workspaceInvites.workspaceId, a.row.id), gt(workspaceInvites.expiresAt, new Date())))
    .orderBy(asc(workspaceInvites.createdAt));
  return { members, invites: await inviteViews(open) };
}

async function ownedRow(userId: string, wsId: string): Promise<WorkspaceRow> {
  const a = await access(userId, wsId);
  if (!a) throw notFound();
  if (a.role !== 'owner') throw ownerOnly();
  return a.row;
}

/**
 * Invites `email` as editor or viewer (owner only). Inviting the same address again
 * updates the role, restarts the expiry and sends the mail again.
 */
export async function inviteToWorkspace(c: Context | null, owner: SessionUser, wsId: string, input: { email: string; role: MemberRole }): Promise<DriveInvite> {
  const row = await ownedRow(owner.id, wsId);
  const email = input.email.trim().toLowerCase();
  if (email === owner.email.toLowerCase()) throw new ApiError(409, 'already_member', 'You own this drive.');
  const [existing] = await db
    .select({ id: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(bauthUser, eq(bauthUser.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, row.id), eq(bauthUser.email, email)))
    .limit(1);
  if (existing) throw new ApiError(409, 'already_member', `${email} already has access to this drive.`);
  // Every invitation is a mail to an address of the caller's choosing: bounded per owner and per address.
  checkRateLimitKey(limits.driveInvite, owner.id);
  checkRateLimitKey(limits.driveInviteEmail, email);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS);
  const saved = await db.transaction(async (tx) => {
    await tx.delete(workspaceInvites).where(and(eq(workspaceInvites.workspaceId, row.id), lte(workspaceInvites.expiresAt, now)));
    const [again] = await tx
      .select({ id: workspaceInvites.id })
      .from(workspaceInvites)
      .where(and(eq(workspaceInvites.workspaceId, row.id), eq(workspaceInvites.email, email)));
    if (!again && (await peopleCount(row.id)) >= MAX_DRIVE_PEOPLE) {
      throw new ApiError(409, 'too_many_people', `A drive can have at most ${MAX_DRIVE_PEOPLE} people, invitations included.`);
    }
    const [r] = await tx
      .insert(workspaceInvites)
      .values({ id: newId(), workspaceId: row.id, email, role: input.role, invitedBy: owner.id, createdAt: now, expiresAt })
      .onConflictDoUpdate({
        target: [workspaceInvites.workspaceId, workspaceInvites.email],
        set: { role: input.role, invitedBy: owner.id, createdAt: now, expiresAt },
      })
      .returning();
    return r;
  });

  const url = appUrl('/drive?invitations=1');
  const mail = renderDriveInvite({ email, inviterName: owner.name, inviterEmail: owner.email, driveName: row.name, role: input.role, url });
  sendInBackground({ to: email, ...mail, category: 'drive-invite', links: [url] });
  await audit(c, { kind: 'workspace.invite', userId: owner.id, workspaceId: row.id, target: email, meta: { role: input.role } });
  const [view] = await inviteViews([saved]);
  return view;
}

/** Withdraws an open invitation (owner only). */
export async function revokeInvite(c: Context | null, ownerId: string, wsId: string, inviteId: string): Promise<void> {
  const row = await ownedRow(ownerId, wsId);
  const [gone] = await db
    .delete(workspaceInvites)
    .where(and(eq(workspaceInvites.id, inviteId), eq(workspaceInvites.workspaceId, row.id)))
    .returning();
  if (!gone) throw new ApiError(404, 'not_found', 'Invitation not found.');
  await audit(c, { kind: 'workspace.invite_revoke', userId: ownerId, workspaceId: row.id, target: gone.email });
}

/** Changes a member's role (owner only; the owner's own role never changes). */
export async function updateMemberRole(c: Context | null, ownerId: string, wsId: string, memberId: string, role: MemberRole): Promise<DriveMember> {
  const row = await ownedRow(ownerId, wsId);
  const [m] = await db
    .update(workspaceMembers)
    .set({ role })
    .where(and(eq(workspaceMembers.workspaceId, row.id), eq(workspaceMembers.userId, memberId)))
    .returning();
  if (!m) throw new ApiError(404, 'not_found', 'This person is not a member of the drive.');
  const p = (await personById(memberId))!;
  await audit(c, { kind: 'workspace.member_update', userId: ownerId, workspaceId: row.id, target: p.email, meta: { role } });
  return { ...p, role, since: m.createdAt.toISOString() };
}

/** The owner removes a member, or a member leaves (removes themselves). The owner cannot leave. */
export async function removeMember(c: Context | null, actorId: string, wsId: string, memberId: string): Promise<void> {
  const a = await access(actorId, wsId);
  if (!a) throw notFound();
  const leaving = memberId === actorId;
  if (leaving && a.role === 'owner') throw new ApiError(400, 'bad_request', 'The owner cannot leave their own drive.');
  if (!leaving && a.role !== 'owner') throw ownerOnly();
  const [gone] = await db
    .delete(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, a.row.id), eq(workspaceMembers.userId, memberId)))
    .returning();
  if (!gone) throw new ApiError(404, 'not_found', 'This person is not a member of the drive.');
  const p = await personById(memberId);
  await audit(c, {
    kind: leaving ? 'workspace.member_leave' : 'workspace.member_remove',
    userId: actorId,
    workspaceId: a.row.id,
    target: p?.email ?? memberId,
  });
}

// ── the invitee's side ──────────────────────────────────────────────────────

/** Open invitations addressed to the user. Empty until their address is verified. */
export async function listInvitations(user: SessionUser): Promise<Invitation[]> {
  if (user.emailVerified === false) return [];
  const rows = await db
    .select({ inv: workspaceInvites, wsName: workspaces.name, ownerId: workspaces.userId })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .where(
      and(
        eq(workspaceInvites.email, user.email.toLowerCase()),
        gt(workspaceInvites.expiresAt, new Date()),
        isNull(workspaces.deletedAt),
        ne(workspaces.userId, user.id),
      ),
    )
    .orderBy(asc(workspaceInvites.createdAt));
  const views = await inviteViews(rows.map((r) => r.inv));
  return rows.map((r, i) => ({
    id: r.inv.id,
    workspaceId: r.inv.workspaceId,
    workspaceName: r.wsName,
    role: r.inv.role,
    invitedBy: views[i].invitedBy,
    createdAt: views[i].createdAt,
  }));
}

/** The invitation `id` if it is open and addressed to the user (404 otherwise, whatever the reason). */
async function myInvitation(user: SessionUser, id: string) {
  const mine = (await listInvitations(user)).find((i) => i.id === id);
  if (!mine) throw new ApiError(404, 'not_found', 'Invitation not found.');
  return mine;
}

/** Accepts: the user becomes a member with the invited role and the invitation is used up. */
export async function acceptInvitation(c: Context | null, user: SessionUser, id: string): Promise<WorkspaceSummary> {
  const inv = await myInvitation(user, id);
  await db.transaction(async (tx) => {
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: inv.workspaceId, userId: user.id, role: inv.role, addedBy: inv.invitedBy?.id ?? null })
      .onConflictDoUpdate({ target: [workspaceMembers.workspaceId, workspaceMembers.userId], set: { role: inv.role } });
    await tx.delete(workspaceInvites).where(eq(workspaceInvites.id, inv.id));
  });
  await audit(c, { kind: 'workspace.member_join', userId: user.id, workspaceId: inv.workspaceId, target: inv.workspaceName, meta: { role: inv.role } });
  const summary = (await listSharedWorkspaceSummaries(user.id)).find((w) => w.id === inv.workspaceId);
  if (!summary) throw notFound();
  return summary;
}

/** Declines: the invitation is removed (the owner can invite again). */
export async function declineInvitation(user: SessionUser, id: string): Promise<void> {
  const inv = await myInvitation(user, id);
  await db.delete(workspaceInvites).where(eq(workspaceInvites.id, inv.id));
}

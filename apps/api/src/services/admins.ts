import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import type { AdminEntry, AdminSource } from '@volumes/shared';
import { db } from '../db/client';
import { admins, bauthUser, type AdminRow } from '../db/schema';
import { env } from '../env';
import { audit } from '../lib/audit';
import { ApiError } from '../lib/http';

/**
 * Who administers the server, from two places:
 *  - VOLUMES_ADMIN_EMAILS (env.adminEmails): the source of truth. Always admins, may always
 *    create an account (even when sign-up is closed), and cannot be removed in the UI.
 *    reconcileEnvAdmins() mirrors them into the `admins` table on boot (added_by = ENV_ADDED_BY).
 *  - The `admins` table: extra admins added in Admin → Admins, removable there.
 * Checks read the union, the table part from a copy kept in memory for ADMIN_CACHE_MS: every
 * change made through this process refreshes it at once, and a change made by another API
 * process is seen within the TTL. Concurrent misses share one query.
 */
const ADMIN_CACHE_MS = 10_000;

/** The added_by of rows mirrored from VOLUMES_ADMIN_EMAILS. */
export const ENV_ADDED_BY = 'server config';

let cached: { emails: Set<string>; at: number } | null = null;
let loading: Promise<Set<string>> | null = null;

async function tableEmails(): Promise<Set<string>> {
  if (cached && Date.now() - cached.at < ADMIN_CACHE_MS) return cached.emails;
  loading ??= db
    .select({ email: admins.email })
    .from(admins)
    .then((rows) => {
      const emails = new Set(rows.map((r) => r.email));
      cached = { emails, at: Date.now() };
      return emails;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** True for an address listed in VOLUMES_ADMIN_EMAILS. */
export function isEnvAdminEmail(email: string | null | undefined): boolean {
  return !!email && env.adminEmails.includes(email.trim().toLowerCase());
}

/** Every admin address (lower-cased): the server config plus the table. */
export async function adminEmails(): Promise<Set<string>> {
  const fromTable = await tableEmails();
  if (!env.adminEmails.length) return fromTable;
  return new Set([...env.adminEmails, ...fromTable]);
}

/** Drops the in-memory list (after a change, and between tests). */
export function clearAdminCache(): void {
  cached = null;
}

export async function isAdminEmail(email: string | null | undefined): Promise<boolean> {
  return !!email && (isEnvAdminEmail(email) || (await adminEmails()).has(email.trim().toLowerCase()));
}

/**
 * Admin rights need a listed address the user has proven they own. Anyone can
 * sign up with a password for an unclaimed address, so the address alone never
 * makes an account privileged.
 */
export async function isAdminUser(u: { email: string | null | undefined; emailVerified?: boolean | null }): Promise<boolean> {
  return u.emailVerified === true && (await isAdminEmail(u.email));
}

/** Where an admin address comes from (env wins when it is in both). */
export function adminSource(email: string): AdminSource {
  return isEnvAdminEmail(email) ? 'env' : 'db';
}

/**
 * Mirrors VOLUMES_ADMIN_EMAILS into the `admins` table, idempotently (boot runs it every time):
 * a listed address without a row gets one (its account, existing or future, is an admin from
 * now on), and a row this mirror added for an address no longer listed is removed. Rows added
 * in the UI are never touched. Returns what changed.
 */
export async function reconcileEnvAdmins(): Promise<{ added: string[]; removed: string[] }> {
  const listed = env.adminEmails;
  const added = listed.length
    ? (
        await db
          .insert(admins)
          .values(listed.map((email) => ({ email, addedBy: ENV_ADDED_BY })))
          .onConflictDoNothing()
          .returning({ email: admins.email })
      ).map((r) => r.email)
    : [];
  const removed = (
    await db
      .delete(admins)
      .where(and(eq(admins.addedBy, ENV_ADDED_BY), listed.length ? notInArray(admins.email, listed) : undefined))
      .returning({ email: admins.email })
  ).map((r) => r.email);
  clearAdminCache();
  for (const e of added) await audit(null, { kind: 'admin.add', userId: null, actorEmail: ENV_ADDED_BY, target: e, meta: { via: 'env' } });
  for (const e of removed) await audit(null, { kind: 'admin.remove', userId: null, actorEmail: ENV_ADDED_BY, target: e, meta: { via: 'env' } });
  return { added, removed };
}

async function toEntries(rows: Pick<AdminRow, 'email' | 'addedBy' | 'createdAt'>[]): Promise<AdminEntry[]> {
  const accounts = rows.length
    ? await db
        .select({ id: bauthUser.id, email: bauthUser.email, name: bauthUser.name, emailVerified: bauthUser.emailVerified })
        .from(bauthUser)
        .where(inArray(sql`lower(${bauthUser.email})`, rows.map((r) => r.email)))
    : [];
  const byEmail = new Map(accounts.map((a) => [a.email.toLowerCase(), a]));
  return rows.map((r) => {
    const a = byEmail.get(r.email);
    return {
      email: r.email,
      source: adminSource(r.email),
      addedBy: r.addedBy,
      createdAt: r.createdAt.toISOString(),
      user: a ? { id: a.id, name: a.name, emailVerified: a.emailVerified } : null,
    };
  });
}

/**
 * GET /api/admin/admins: the server-config admins first (in the order listed), then the
 * rest oldest first, each with the matching account when one exists.
 */
export async function listAdmins(): Promise<AdminEntry[]> {
  const rows = await db.select().from(admins).orderBy(asc(admins.createdAt), asc(admins.email));
  const byEmail = new Map(rows.map((r) => [r.email, r]));
  const fromEnv = env.adminEmails.map((email) => byEmail.get(email) ?? { email, addedBy: ENV_ADDED_BY, createdAt: new Date(0) });
  const rest = rows.filter((r) => !isEnvAdminEmail(r.email));
  return toEntries([...fromEnv, ...rest]);
}

/** Adds an admin by address (409 when already one). The account may not exist yet. */
export async function addAdmin(c: Context | null, actor: { id: string; email: string }, email: string): Promise<AdminEntry> {
  const e = email.trim().toLowerCase();
  if (isEnvAdminEmail(e)) throw new ApiError(409, 'conflict', `${e} is already an admin (set in the server config).`);
  const [row] = await db.insert(admins).values({ email: e, addedBy: actor.email.toLowerCase() }).onConflictDoNothing().returning();
  if (!row) throw new ApiError(409, 'conflict', `${e} is already an admin.`);
  clearAdminCache();
  await audit(c, { kind: 'admin.add', userId: actor.id, target: e });
  const [entry] = await toEntries([row]);
  return entry;
}

/**
 * Removes an admin (yourself included). Refuses one set in the server config (it would come
 * back on the next boot; it is removed from VOLUMES_ADMIN_EMAILS instead) and the last one:
 * a server with no admin has nobody who could add one back. The admin rows are locked
 * first, so two admins removing each other at once cannot both succeed.
 */
export async function removeAdmin(c: Context | null, actor: { id: string }, email: string): Promise<void> {
  const e = email.trim().toLowerCase();
  if (isEnvAdminEmail(e)) {
    throw new ApiError(409, 'conflict', `${e} is set in the server config (VOLUMES_ADMIN_EMAILS). Remove it there.`, { locked: true });
  }
  await db.transaction(async (tx) => {
    const all = await tx.select({ email: admins.email }).from(admins).for('update');
    if (!all.some((a) => a.email === e)) throw new ApiError(404, 'not_found', `${e} is not an admin.`);
    const remaining = new Set([...env.adminEmails, ...all.map((a) => a.email)]);
    if (remaining.size <= 1) throw new ApiError(409, 'conflict', 'This is the last admin. Add another admin before removing this one.');
    await tx.delete(admins).where(eq(admins.email, e));
  });
  clearAdminCache();
  await audit(c, { kind: 'admin.remove', userId: actor.id, target: e });
}

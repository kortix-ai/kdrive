import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import type { AdminEntry } from '@volumes/shared';
import { db } from '../db/client';
import { admins, bauthUser, type AdminRow } from '../db/schema';
import { audit } from '../lib/audit';
import { ApiError } from '../lib/http';

/**
 * Admins live in the `admins` table (lower-cased addresses). Checks read a copy
 * of the list kept in memory for ADMIN_CACHE_MS: every change made through this
 * process refreshes it at once, and a change made by another API process is seen
 * within the TTL. Concurrent misses share one query.
 */
const ADMIN_CACHE_MS = 10_000;

let cached: { emails: Set<string>; at: number } | null = null;
let loading: Promise<Set<string>> | null = null;

/** Every admin address (lower-cased). */
export async function adminEmails(): Promise<Set<string>> {
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

/** Drops the in-memory list (after a change, and between tests). */
export function clearAdminCache(): void {
  cached = null;
}

export async function isAdminEmail(email: string | null | undefined): Promise<boolean> {
  return !!email && (await adminEmails()).has(email.trim().toLowerCase());
}

/**
 * Admin rights need a listed address the user has proven they own. Anyone can
 * sign up with a password for an unclaimed address, so the address alone never
 * makes an account privileged.
 */
export async function isAdminUser(u: { email: string | null | undefined; emailVerified?: boolean | null }): Promise<boolean> {
  return u.emailVerified === true && (await isAdminEmail(u.email));
}

async function toEntries(rows: AdminRow[]): Promise<AdminEntry[]> {
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
      addedBy: r.addedBy,
      createdAt: r.createdAt.toISOString(),
      user: a ? { id: a.id, name: a.name, emailVerified: a.emailVerified } : null,
    };
  });
}

/** GET /api/admin/admins: oldest first, with the matching account when one exists. */
export async function listAdmins(): Promise<AdminEntry[]> {
  return toEntries(await db.select().from(admins).orderBy(asc(admins.createdAt), asc(admins.email)));
}

/** Adds an admin by address (409 when already one). The account may not exist yet. */
export async function addAdmin(c: Context | null, actor: { id: string; email: string }, email: string): Promise<AdminEntry> {
  const e = email.trim().toLowerCase();
  const [row] = await db.insert(admins).values({ email: e, addedBy: actor.email.toLowerCase() }).onConflictDoNothing().returning();
  if (!row) throw new ApiError(409, 'conflict', `${e} is already an admin.`);
  clearAdminCache();
  await audit(c, { kind: 'admin.add', userId: actor.id, target: e });
  const [entry] = await toEntries([row]);
  return entry;
}

/**
 * Removes an admin (yourself included). Refuses the last one: a server with no
 * admin has nobody who could add one back. The admin rows are locked first, so
 * two admins removing each other at once cannot both succeed.
 */
export async function removeAdmin(c: Context | null, actor: { id: string }, email: string): Promise<void> {
  const e = email.trim().toLowerCase();
  await db.transaction(async (tx) => {
    const all = await tx.select({ email: admins.email }).from(admins).for('update');
    if (!all.some((a) => a.email === e)) throw new ApiError(404, 'not_found', `${e} is not an admin.`);
    if (all.length <= 1) throw new ApiError(409, 'conflict', 'This is the last admin. Add another admin before removing this one.');
    await tx.delete(admins).where(eq(admins.email, e));
  });
  clearAdminCache();
  await audit(c, { kind: 'admin.remove', userId: actor.id, target: e });
}

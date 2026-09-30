// Atomic capacity reservations: storage bytes and workspace slots per user,
// volume slots for the whole org.
//
// A check followed by a slow storage mutation is a race: two requests (in any
// API process) can both pass the check against the same usage. So a mutation
// that grows usage RESERVES what it needs first. The check and the reservation
// row happen in one Postgres transaction under an advisory lock (per user, or
// one for the org), so every concurrent reserver sees every other one. The row
// is deleted when the mutation ends (success or failure); while it runs its
// expiry is renewed, so a crashed process frees its rows within RESERVATION_TTL_MS.
//
// Usage:
//   await using hold = await reserveQuota(userId, bytes, 'copy');
//   ...mutate...                               // released when the scope ends
// or, when the amount is known only later:
//   await using hold = new Hold(userId, 'workspace.create');
//   await hold.reserve({ workspaces: 1 });
//   await hold.reserveVolume(workspaceId);
//
// Counting order: reservations are read before usage. A reservation released
// between the two reads belongs to a mutation that already landed, so usage
// includes it; one released later is counted as a reservation. (A mutation that
// landed and is not released yet counts twice for a moment: never too little.)
// Every query inside the lock goes through the transaction: a second pooled
// connection there could deadlock a full pool.

import { and, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { quotaReservations, workspaces } from '../db/schema';
import { env } from '../env';
import { ApiError } from '../lib/http';
import { newId } from '../lib/ids';
import { getStore } from '../storage';
import { getQuotaBytes, quotaExceeded, reservedBytes } from './quota';
import { workspaceUsage } from './workspaces';

/** A reservation lapses this long after its holder stopped renewing it (a crashed process). */
export const RESERVATION_TTL_MS = 5 * 60_000;
const RENEW_EVERY_MS = 60_000;

/** Advisory lock namespaces (pg_advisory_xact_lock(int4, int4)). */
const LOCK_USER = 0x51554f54; // user quota and workspace allowance
const LOCK_ORG = 0x51554f55; // org volume slots

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface UserClaim {
  /** logicalBytes growth (≤ 0 reserves nothing) */
  bytes?: number;
  /** live workspaces added */
  workspaces?: number;
  /** the workspace being created (its row stops counting as a reservation once it exists) */
  workspaceId?: string;
}

/** Live workspace rows of the user (the default and duplicates included). */
async function ownedWorkspaces(tx: Tx, userId: string) {
  return tx
    .select({ id: workspaces.id, volumeId: workspaces.volumeId })
    .from(workspaces)
    .where(and(eq(workspaces.userId, userId), isNull(workspaces.deletedAt)));
}

/** Workspace slots reserved by creates / duplicates whose row does not exist yet. */
async function heldWorkspaces(tx: Tx, userId: string): Promise<number> {
  const [r] = await tx
    .select({
      n: sql<string>`COALESCE(SUM(${quotaReservations.workspaces}) FILTER (WHERE ${quotaReservations.workspaceId} IS NULL OR NOT EXISTS (
        SELECT 1 FROM ${workspaces} w WHERE w.id = ${quotaReservations.workspaceId} AND w.deleted_at IS NULL)), 0)`,
    })
    .from(quotaReservations)
    .where(and(eq(quotaReservations.userId, userId), eq(quotaReservations.scope, 'user'), gt(quotaReservations.expiresAt, new Date())));
  return Number(r?.n ?? 0);
}

/** Volume slots reserved by creates / duplicates whose volume is not recorded yet. */
async function heldVolumes(tx: Tx): Promise<number> {
  const [r] = await tx
    .select({
      n: sql<string>`COALESCE(SUM(${quotaReservations.volumes}) FILTER (WHERE ${quotaReservations.workspaceId} IS NULL OR NOT EXISTS (
        SELECT 1 FROM ${workspaces} w WHERE w.id = ${quotaReservations.workspaceId} AND w.volume_id IS NOT NULL)), 0)`,
    })
    .from(quotaReservations)
    .where(and(eq(quotaReservations.scope, 'org'), gt(quotaReservations.expiresAt, new Date())));
  return Number(r?.n ?? 0);
}

/**
 * Holds reservations for one mutation. `reserve` / `reserveVolume` throw the
 * same errors the plain checks did (413 `quota_exceeded`, 409 `storage_limit`)
 * and reserve nothing then. `release` (or leaving an `await using` scope)
 * frees everything held; it never throws.
 */
export class Hold implements AsyncDisposable {
  private ids: string[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly userId: string,
    readonly kind: string,
  ) {}

  /** Reserves bytes and / or workspace slots of the user, or throws when they do not fit. */
  async reserve(claim: UserClaim): Promise<void> {
    const bytes = Math.max(0, claim.bytes ?? 0);
    const slots = Math.max(0, claim.workspaces ?? 0);
    if (!bytes && !slots) return;
    const id = newId();
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_USER}, hashtext(${this.userId}))`);
      const now = new Date();
      await tx.delete(quotaReservations).where(and(eq(quotaReservations.userId, this.userId), lte(quotaReservations.expiresAt, now)));
      if (slots) {
        const held = await heldWorkspaces(tx, this.userId);
        const owned = (await ownedWorkspaces(tx, this.userId)).length;
        if (owned + held + slots > env.maxWorkspacesPerUser) {
          throw new ApiError(409, 'storage_limit', `You can have at most ${env.maxWorkspacesPerUser} workspaces. Delete one to make another.`, {
            max: env.maxWorkspacesPerUser,
            used: owned,
          });
        }
      }
      if (bytes) {
        const [quotaBytes, reserved] = await Promise.all([getQuotaBytes(this.userId, tx), reservedBytes(this.userId, {}, tx)]);
        const rows = await ownedWorkspaces(tx, this.userId);
        const usage = (await Promise.all(rows.map((r) => workspaceUsage(r)))).reduce((a, b) => a + b, 0);
        const used = usage + reserved;
        if (used + bytes > quotaBytes) throw quotaExceeded(used, quotaBytes, bytes);
      }
      await tx.insert(quotaReservations).values({
        id,
        scope: 'user',
        userId: this.userId,
        workspaceId: claim.workspaceId ?? null,
        kind: this.kind,
        bytes,
        workspaces: slots,
        expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS),
      });
    });
    this.held(id);
  }

  /**
   * Reserves one volume of the shared org for `workspaceId`. An extra workspace
   * may not take the last `env.reservedVolumes` slots: those stay free for new
   * users' default workspaces, or one person could lock everyone else out.
   */
  async reserveVolume(workspaceId: string): Promise<void> {
    const id = newId();
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_ORG}, 0)`);
      const now = new Date();
      await tx.delete(quotaReservations).where(and(eq(quotaReservations.scope, 'org'), lte(quotaReservations.expiresAt, now)));
      const held = await heldVolumes(tx);
      const l = await getStore().limits();
      const usable = Math.max(0, l.maxVolumes - env.reservedVolumes);
      if (l.usedVolumes + held + 1 > usable) {
        throw new ApiError(409, 'storage_limit', 'No more workspaces can be created on this server right now.', {
          max: l.maxVolumes,
          used: l.usedVolumes,
        });
      }
      await tx.insert(quotaReservations).values({
        id,
        scope: 'org',
        userId: this.userId,
        workspaceId,
        kind: this.kind,
        volumes: 1,
        expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS),
      });
    });
    this.held(id);
  }

  private held(id: string): void {
    this.ids.push(id);
    if (!this.timer) {
      this.timer = setInterval(() => void this.renew(), RENEW_EVERY_MS);
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  private async renew(): Promise<void> {
    if (!this.ids.length) return;
    await db
      .update(quotaReservations)
      .set({ expiresAt: new Date(Date.now() + RESERVATION_TTL_MS) })
      .where(inArray(quotaReservations.id, this.ids))
      .catch(() => {});
  }

  private async drop(ids: string[]): Promise<void> {
    if (!ids.length) return;
    // A failed delete only means the rows lapse at their expiry.
    await db
      .delete(quotaReservations)
      .where(inArray(quotaReservations.id, ids))
      .catch(() => {});
  }

  async release(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const ids = this.ids;
    this.ids = [];
    await this.drop(ids);
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.release();
  }
}

/** Reserves `bytes` of the user's quota (nothing when ≤ 0); release it when the mutation ends. */
export async function reserveQuota(userId: string, bytes: number, kind: string): Promise<Hold> {
  const hold = new Hold(userId, kind);
  await hold.reserve({ bytes });
  return hold;
}

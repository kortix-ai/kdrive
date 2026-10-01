// Which blocks a user has proven they hold, and which an upload still owes.
//
// Platinum dedups blocks across the whole org, and every user shares one org,
// so the store's `missing` list answers "does ANYONE store this content?", and
// a store commit accepts any block the org holds. Neither may decide what a
// user can put in their drive, or one user could test for, and then copy,
// another user's file knowing only its block hashes.
//
// So a block is skipped only when content this user legitimately owns already
// lists it: a committed ledger row (upload, restore, move, copy or delete) of
// one of their workspaces, never a row of an upload plan that did not commit.
// Every other planned block is REQUIRED: the plan persists that set, each
// block PUT (hash-checked here and by the store) ticks one off, and the commit
// is refused until none is left. The store's own `missing` is only ever added
// to what the browser sends, so its answer never reaches the browser alone.
import { createHash } from 'node:crypto';
import { sql, type SQLWrapper } from 'drizzle-orm';
import { BLOCK_SIZE } from '@volumes/shared';
import { db } from '../db/client';

const CHUNK = 5000;

/** The all-zero 1 MiB block: anyone can produce it, and the store never asks for it. */
export const ZERO_BLOCK_SHA = createHash('sha256').update(new Uint8Array(BLOCK_SIZE)).digest('hex');

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * True for a ledger row that does NOT belong to an upload plan that never
 * committed. Plan rows are written at plan time (a later part of a multi-part
 * upload even joins an action that already committed), so until their own
 * upload commits, their block lists are claims, not content.
 */
export function notFromOpenPlan(actionId: SQLWrapper, path: SQLWrapper) {
  return sql`NOT EXISTS (
    SELECT 1 FROM uploads u
    WHERE u.action_id = ${actionId}
      AND u.status <> 'committed'
      AND u.plan -> 'files' @> jsonb_build_array(jsonb_build_object('path', ${path}::text)))`;
}

/** The subset of `shas` that appears in a committed ledger row of one of `userId`'s workspaces. */
export async function provenBlocks(userId: string, shas: Iterable<string>): Promise<Set<string>> {
  const want = [...new Set(shas)];
  const out = new Set<string>();
  for (let i = 0; i < want.length; i += CHUNK) {
    const chunk = want.slice(i, i + CHUNK);
    const rows = await db.execute<{ sha: string }>(sql`
      SELECT DISTINCT b.sha
      FROM action_paths ap
      JOIN actions a ON a.id = ap.action_id AND a.status = 'committed'
      JOIN workspaces w ON w.id = ap.workspace_id AND w.user_id = ${userId}
      CROSS JOIN LATERAL unnest(ap.block_hashes) AS b(sha)
      WHERE ap.block_hashes && ${sql.param(chunk)}::text[]
        AND b.sha = ANY(${sql.param(chunk)}::text[])
        AND ${notFromOpenPlan(sql`ap.action_id`, sql`ap.path`)}`);
    for (const r of rows as unknown as { sha: string }[]) out.add(r.sha);
  }
  return out;
}

/**
 * Blocks of `blocks` this user has not proven they hold, leaving out `known`
 * (already received in this upload) and the all-zero block. Sorted, unique.
 */
export async function unprovenBlocks(userId: string, blocks: Iterable<string>, known: Iterable<string> = []): Promise<string[]> {
  const skip = new Set(known);
  skip.add(ZERO_BLOCK_SHA);
  const ask = [...new Set(blocks)].filter((b) => !skip.has(b));
  const held = await provenBlocks(userId, ask);
  return ask.filter((b) => !held.has(b)).sort();
}

/** What a browser must send for a plan: every required block plus the store's own `missing`. Sorted, unique. */
export function missingForUser(required: string[], storeMissing: string[]): string[] {
  return [...new Set([...required, ...storeMissing])].sort();
}

// ── receipts ───────────────────────────────────────────────────────────────
//
// Required blocks not received yet, per upload (our id), in this process.
// The required set itself is persisted on the upload row; what arrived is
// kept here, because a row rewrite per block would not scale. After a
// restart nothing counts as received: the commit answers 409 {missing} and
// the browser sends those blocks again (the store accepts a repeat PUT).
// Upload slots are process-local too, so one process serves an upload.

/** Plans live at most 2 h in the store; an entry idle past that is dropped. */
const IDLE_MS = 2 * 60 * 60_000 + 15 * 60_000;

type Entry = { left: Promise<Set<string> | null>; touched: number };
const outstanding = new Map<string, Entry>();

function sweep(now: number): void {
  for (const [id, e] of outstanding) if (now - e.touched > IDLE_MS) outstanding.delete(id);
}

async function loadRequired(uploadId: string): Promise<Set<string> | null> {
  const rows = (await db.execute(sql`SELECT plan -> 'required' AS r FROM uploads WHERE id = ${uploadId}`)) as unknown as { r: unknown }[];
  const r = rows[0]?.r;
  return Array.isArray(r) ? new Set(r.map(String)) : null;
}

function entryOf(uploadId: string, seed?: string[] | null): Entry {
  const now = Date.now();
  sweep(now);
  let e = outstanding.get(uploadId);
  if (!e) {
    e = { left: seed !== undefined ? Promise.resolve(seed ? new Set(seed) : null) : loadRequired(uploadId), touched: now };
    outstanding.set(uploadId, e);
  }
  e.touched = now;
  return e;
}

/** Starts tracking a new plan's required blocks. */
export function trackRequired(uploadId: string, required: string[]): void {
  outstanding.set(uploadId, { left: Promise.resolve(new Set(required)), touched: Date.now() });
}

/** A block PUT the store accepted (its bytes hash to `sha`). */
export async function markReceived(uploadId: string, sha: string): Promise<void> {
  (await entryOf(uploadId).left)?.delete(sha);
}

/**
 * Required blocks of an upload that have not arrived (sorted), or null when
 * the row carries no required set (planned before this rule existed).
 */
export async function unreceivedBlocks(uploadId: string, required: string[] | undefined): Promise<string[] | null> {
  const left = await entryOf(uploadId, outstanding.has(uploadId) ? undefined : (required ?? null)).left;
  return left ? [...left].sort() : null;
}

/** The upload ended (committed, aborted, failed, expired). */
export function forgetUpload(uploadId: string): void {
  outstanding.delete(uploadId);
}

/** Tests: behave like a restarted process. */
export function forgetReceivedBlocksForTests(): void {
  outstanding.clear();
}

// The change ledger. Platinum commits carry only counts, so every user action
// records WHICH paths it touched here. Rule: write the intent before the
// Platinum call, finalise with the commit id after. See architecture §8.

import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNotNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import type { ActionKind, ActionSummary, AgentRef, PathOp } from '@volumes/shared';
import { db } from '../db/client';
import { actionPaths, actions, uploads, workspaces, type ActionPathRow, type ActionRow } from '../db/schema';
import { newId } from '../lib/ids';
import { withWorkspaceLock } from '../lib/lock';
import { getStore } from '../storage';
import { holdsChanges } from './commit-proof';
import { notFromOpenPlan } from './proven-blocks';
import { isStoreError, type CommitResult, type FileStat } from '../storage/types';
import type { WorkspaceCtx } from '../types';

export type { ActionPathRow, ActionRow };

/** Who performs an action: the signed-in user (default) or an AI agent acting for them. */
export type Actor = { kind: 'user' } | { kind: 'agent'; name: string; credential: string; proposalId?: string };

export interface ActionCtx {
  ws: WorkspaceCtx;
  userId: string;
  /** Absent = the user. */
  actor?: Actor;
}

export interface PathChange {
  op: PathOp;
  path: string;
  fromPath?: string;
  entryType: 'file' | 'dir';
  size?: number;
  prevSize?: number;
  blockHashes?: string[];
  contentHash?: string;
  mtime?: number;
}

export interface ActionSpec {
  kind: ActionKind;
  summary: string;
  paths: PathChange[];
  meta?: Record<string, unknown>;
  undoOfActionId?: string;
}

export interface ActionRecorder {
  actionId: string;
  baseCommitId: string;
  commit(r: CommitResult): Promise<void>;
  addPaths(p: PathChange[]): Promise<void>;
}

/** sha256 hex of the concatenated block hashes ('' for the empty file). */
export function contentHashOf(blockHashes: string[]): string {
  return createHash('sha256').update(blockHashes.join('')).digest('hex');
}

function pathRowsFor(actionId: string, wsId: string, paths: PathChange[]) {
  return paths.map((p) => ({
    actionId,
    workspaceId: wsId,
    op: p.op,
    path: p.path,
    fromPath: p.fromPath ?? null,
    entryType: p.entryType,
    size: p.size ?? null,
    prevSize: p.prevSize ?? null,
    contentHash: p.contentHash ?? (p.blockHashes ? contentHashOf(p.blockHashes) : null),
    blockHashes: p.blockHashes ?? null,
    mtime: p.mtime ?? null,
  }));
}

async function insertPaths(tx: Pick<typeof db, 'insert'>, actionId: string, wsId: string, paths: PathChange[]) {
  const rows = pathRowsFor(actionId, wsId, paths);
  for (let i = 0; i < rows.length; i += 1000) {
    await tx.insert(actionPaths).values(rows.slice(i, i + 1000));
  }
}

/** The agent that made an action (null for the user's own actions). */
export function agentOf(
  row: Pick<ActionRow, 'actorKind' | 'agentName' | 'agentCredential'> | null | undefined,
): AgentRef | null {
  if (!row || row.actorKind !== 'agent' || !row.agentCredential) return null;
  const credential = row.agentCredential;
  return { kind: credential.startsWith('pat:') ? 'token' : 'oauth', name: row.agentName ?? 'AI agent', credential };
}

export function toSummary(row: ActionRow): ActionSummary {
  return {
    id: row.id,
    kind: row.kind,
    summary: row.summary,
    status: row.status,
    headCommitId: row.headCommitId,
    baseCommitId: row.baseCommitId,
    createdAt: row.createdAt.toISOString(),
    itemCount: row.itemCount,
    bytesDelta: row.bytesDelta,
    undoable: row.status === 'committed',
    restoredTo: restoredToOf(row),
    agent: agentOf(row),
    proposalId: row.proposalId ?? null,
  };
}

/** When the version a restore went back to was made (meta.atCreatedAt); null for everything else, undos included. */
export function restoredToOf(row: Pick<ActionRow, 'kind' | 'meta'>): string | null {
  if (!row.kind.startsWith('restore.')) return null;
  const v = (row.meta as { atCreatedAt?: unknown }).atCreatedAt;
  return typeof v === 'string' ? v : null;
}

// ── low level ───────────────────────────────────────────────────────────────

/** Records a pending action with its paths; `baseCommitId` = the head before the action. */
export async function recordIntent(ctx: ActionCtx, spec: ActionSpec): Promise<{ actionId: string; baseCommitId: string }> {
  const head = (await getStore().getVolume(ctx.ws.volumeId)).headCommitId;
  const actionId = newId();
  const agent = ctx.actor?.kind === 'agent' ? ctx.actor : null;
  await db.transaction(async (tx) => {
    await tx.insert(actions).values({
      id: actionId,
      workspaceId: ctx.ws.id,
      userId: ctx.userId,
      kind: spec.kind,
      summary: spec.summary,
      status: 'pending',
      baseCommitId: head,
      undoOfActionId: spec.undoOfActionId ?? null,
      meta: spec.meta ?? {},
      actorKind: agent ? 'agent' : 'user',
      agentName: agent?.name ?? null,
      agentCredential: agent?.credential ?? null,
      proposalId: agent?.proposalId ?? null,
    });
    if (spec.paths.length) await insertPaths(tx, actionId, ctx.ws.id, spec.paths);
  });
  return { actionId, baseCommitId: head };
}

export async function appendPaths(actionId: string, wsId: string, paths: PathChange[]): Promise<void> {
  if (!paths.length) return;
  await insertPaths(db, actionId, wsId, paths);
}

/**
 * Adds the commit(s) a Platinum call produced. `noop` adds nothing; `queued`
 * adds nothing either (its head_commit_id is still the OLD head, which belongs
 * to the previous action), so the action stays pending until reconcilePending
 * finds the merge. `merged` records the side commit too: the uploaded entries
 * carry its version, and exact block lookups match on it.
 */
export async function attachCommit(actionId: string, r: CommitResult): Promise<void> {
  if (r.outcome === 'noop' || r.outcome === 'queued') return;
  const head = r.headCommitId || r.commitId;
  const ids = r.outcome === 'merged' && r.commitId && r.commitId !== head ? [r.commitId, head] : [head];
  let arr = sql`${actions.commitIds}`;
  for (const id of ids) arr = sql`CASE WHEN ${id} = ANY(${arr}) THEN ${arr} ELSE array_append(${arr}, ${id}) END`;
  await db
    .update(actions)
    .set({
      commitIds: arr,
      headCommitId: head,
      ...(r.outcome === 'merged' && (r.overwritten.length || r.skipped.length)
        ? { meta: sql`${actions.meta} || ${JSON.stringify({ merged: { overwritten: r.overwritten.slice(0, 100), skipped: r.skipped.slice(0, 100) } })}::jsonb` }
        : {}),
    })
    .where(eq(actions.id, actionId));
}

async function logicalBytesAt(volumeId: string, ref: string | null): Promise<number | null> {
  if (!ref) return null;
  try {
    return (await getStore().getCommit(volumeId, ref)).logicalBytes;
  } catch {
    return null;
  }
}

/**
 * Size change of an action from its own ledger rows, in real file bytes (the
 * list's sizes): new − old per file, what a copy adds, what a delete removes.
 * Folders count 0. null when a file row lacks its size.
 */
async function ledgerBytesDelta(actionId: string): Promise<number | null> {
  const [r] = await db.execute<{ delta: string | null; unknown: boolean | null }>(sql`
    SELECT
      SUM(CASE
        WHEN op = 'deleted' THEN -COALESCE(size, 0)
        WHEN op = 'moved' THEN -COALESCE(prev_size, 0)
        WHEN entry_type = 'dir' AND op <> 'copied' THEN 0
        ELSE COALESCE(size, 0) - COALESCE(prev_size, 0)
      END)::bigint AS delta,
      bool_or(entry_type = 'file' AND size IS NULL) AS unknown
    FROM action_paths WHERE action_id = ${actionId}`);
  if (!r || r.unknown) return null;
  return Number(r.delta ?? 0);
}

/**
 * Finalises an action. `committed` with no attached commit becomes `noop`.
 * bytesDelta = the ledger's real byte change (falls back to logicalBytes(head)
 * − logicalBytes(base) when the ledger lacks a size); itemCount = path rows.
 * A finished action never goes back: `failed`/`noop` apply only to a pending
 * action, and a committed one can only be re-finalised as committed (a later
 * plan of the same upload refreshing its totals).
 */
export async function finalize(actionId: string, status: 'committed' | 'noop' | 'failed', error?: string): Promise<ActionSummary> {
  const [row] = await db
    .select({ a: actions, volumeId: workspaces.volumeId })
    .from(actions)
    .innerJoin(workspaces, eq(workspaces.id, actions.workspaceId))
    .where(eq(actions.id, actionId));
  if (!row) throw new Error(`action ${actionId} not found`);
  const a = row.a;
  let final: 'committed' | 'noop' | 'failed' = status;
  if (status === 'committed' && a.commitIds.length === 0) final = 'noop';
  let bytesDelta = a.bytesDelta;
  if (final === 'committed') {
    const fromLedger = await ledgerBytesDelta(actionId);
    if (fromLedger !== null) bytesDelta = fromLedger;
    else if (row.volumeId) {
      const [h, b] = await Promise.all([logicalBytesAt(row.volumeId, a.headCommitId), logicalBytesAt(row.volumeId, a.baseCommitId)]);
      if (h !== null && b !== null) bytesDelta = h - b;
    }
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(actionPaths).where(eq(actionPaths.actionId, actionId));
  const allowed =
    final === 'committed' ? or(eq(actions.status, 'pending'), eq(actions.status, 'committed')) : eq(actions.status, 'pending');
  const [updated] = await db
    .update(actions)
    .set({ status: final, bytesDelta, itemCount: n, error: error ?? null, finalizedAt: new Date() })
    .where(and(eq(actions.id, actionId), allowed))
    .returning();
  if (updated) return toSummary(updated);
  const [current] = await db.select().from(actions).where(eq(actions.id, actionId));
  return toSummary(current);
}

/**
 * After a store call failed in a way that does not say whether it landed (a
 * timeout, a dropped connection, a 5xx), look at the head: the workspace lock
 * guarantees nobody else moves it, so a head that moved is this call's commit.
 * Returns that head, null when it did not move, or undefined when the head
 * could not be read either.
 */
export async function landedCommit(volumeId: string, lastHead: string, e: unknown): Promise<string | null | undefined> {
  if (!isAmbiguousFailure(e)) return null;
  try {
    const head = (await getStore().getVolume(volumeId)).headCommitId;
    return head && head !== lastHead ? head : null;
  } catch {
    return undefined;
  }
}

/** 4xx answers are refusals (nothing happened); timeouts, transport errors and 5xx may have committed. */
export function isAmbiguousFailure(e: unknown): boolean {
  if (isStoreError(e)) return e.status >= 500 || e.code === 'unavailable' || e.code === 'commit_failed' || e.code === 'internal';
  return !(e instanceof Error && 'status' in e && typeof (e as { status: unknown }).status === 'number' && (e as { status: number }).status < 500);
}

// ── high level ──────────────────────────────────────────────────────────────

/**
 * Runs one mutation as one action, under the workspace lock:
 * prepare (reads and checks, so they see the state the mutation will change)
 * → intent → run → finalise. On throw: `failed` when nothing was committed, else
 * `committed` with meta.partial = true; then rethrows. A failure that may have
 * landed (timeout, 5xx) is checked against the head first: a moved head is
 * attached as this action's commit; an unreadable head leaves the action
 * pending for reconcilePending instead of calling it failed.
 */
export async function withPreparedAction<P, T>(
  ctx: ActionCtx,
  prepare: () => Promise<{ spec: ActionSpec; data: P }>,
  run: (rec: ActionRecorder, data: P) => Promise<T>,
): Promise<{ result: T; action: ActionSummary; data: P }> {
  return withWorkspaceLock(ctx.ws.id, async () => {
    const { spec, data } = await prepare();
    const { actionId, baseCommitId } = await recordIntent(ctx, spec);
    let committed = false;
    let lastHead = baseCommitId;
    const rec: ActionRecorder = {
      actionId,
      baseCommitId,
      commit: async (r) => {
        await attachCommit(actionId, r);
        if (r.outcome !== 'noop' && r.outcome !== 'queued') {
          committed = true;
          lastHead = r.headCommitId || r.commitId;
        }
      },
      addPaths: (p) => appendPaths(actionId, ctx.ws.id, p),
    };
    try {
      const result = await run(rec, data);
      const action = await finalize(actionId, 'committed');
      return { result, action, data };
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 500) : String(e);
      try {
        const landed = await landedCommit(ctx.ws.volumeId, lastHead, e);
        if (landed) {
          await attachCommit(actionId, { commitId: landed, headCommitId: landed, outcome: 'fast', overwritten: [], skipped: [] });
          committed = true;
        }
        if (landed === undefined && !committed) {
          // Unknown outcome: reconcilePending decides once the head is readable again.
          await db.update(actions).set({ error: message }).where(eq(actions.id, actionId));
        } else if (committed) {
          await db
            .update(actions)
            .set({ meta: sql`${actions.meta} || '{"partial": true}'::jsonb` })
            .where(eq(actions.id, actionId));
          await finalize(actionId, 'committed', message);
        } else {
          await finalize(actionId, 'failed', message);
        }
      } catch (inner) {
        console.warn('[ledger] finalize after failure failed', inner instanceof Error ? inner.message : inner);
      }
      throw e;
    }
  });
}

/** withPreparedAction for a spec known up front. */
export async function withAction<T>(
  ctx: ActionCtx,
  spec: ActionSpec,
  run: (rec: ActionRecorder) => Promise<T>,
): Promise<{ result: T; action: ActionSummary }> {
  const r = await withPreparedAction(ctx, async () => ({ spec, data: undefined }), (rec) => run(rec));
  return { result: r.result, action: r.action };
}

// ── queries ─────────────────────────────────────────────────────────────────

export async function getAction(wsId: string, actionId: string): Promise<ActionRow | null> {
  const [row] = await db
    .select()
    .from(actions)
    .where(and(eq(actions.workspaceId, wsId), eq(actions.id, actionId)));
  return row ?? null;
}

/**
 * The newest committed action of this agent credential in a workspace that is
 * not itself an undo and has not been undone yet (the `undo` tool's default).
 */
export async function lastAgentAction(wsId: string, credential: string): Promise<ActionRow | null> {
  const [row] = await db
    .select()
    .from(actions)
    .where(
      and(
        eq(actions.workspaceId, wsId),
        eq(actions.actorKind, 'agent'),
        eq(actions.agentCredential, credential),
        eq(actions.status, 'committed'),
        ne(actions.kind, 'undo'),
        sql`NOT EXISTS (SELECT 1 FROM actions u WHERE u.workspace_id = ${wsId} AND u.undo_of_action_id = ${actions.id} AND u.status = 'committed')`,
      ),
    )
    .orderBy(desc(actions.createdAt), desc(actions.id))
    .limit(1);
  return row ?? null;
}

/** commit id → the action that produced it (via `commit_ids && $1`). */
export async function actionsByCommits(wsId: string, commitIds: string[]): Promise<Map<string, ActionRow>> {
  const out = new Map<string, ActionRow>();
  if (!commitIds.length) return out;
  const want = new Set(commitIds);
  const rows = await db
    .select()
    .from(actions)
    .where(and(eq(actions.workspaceId, wsId), sql`${actions.commitIds} && ${sql.param(commitIds)}::text[]`));
  for (const r of rows) for (const c of r.commitIds) if (want.has(c)) out.set(c, r);
  return out;
}

async function withPaths(rows: ActionRow[]): Promise<(ActionRow & { paths: ActionPathRow[] })[]> {
  if (!rows.length) return [];
  const paths = await db
    .select()
    .from(actionPaths)
    .where(inArray(actionPaths.actionId, rows.map((r) => r.id)))
    .orderBy(asc(actionPaths.id));
  const by = new Map<string, ActionPathRow[]>();
  for (const p of paths) {
    const l = by.get(p.actionId) ?? [];
    l.push(p);
    by.set(p.actionId, l);
  }
  return rows.map((r) => ({ ...r, paths: by.get(r.id) ?? [] }));
}

/** Committed actions created in (from, to], oldest first, with their paths. */
export async function actionsInRange(wsId: string, from: Date, to: Date): Promise<(ActionRow & { paths: ActionPathRow[] })[]> {
  const rows = await db
    .select()
    .from(actions)
    .where(and(eq(actions.workspaceId, wsId), eq(actions.status, 'committed'), gt(actions.createdAt, from), lte(actions.createdAt, to)))
    .orderBy(asc(actions.createdAt), asc(actions.id));
  return withPaths(rows);
}

/** Ledger rows touching `path` (as path or fromPath; optionally descendants), newest action first. */
export async function pathRows(
  wsId: string,
  path: string,
  opts: { includeDescendants?: boolean } = {},
): Promise<(ActionPathRow & { action: ActionRow })[]> {
  const prefix = path === '/' ? '/%' : `${path.replace(/[\\%_]/g, (m) => '\\' + m)}/%`;
  const match = opts.includeDescendants
    ? or(eq(actionPaths.path, path), eq(actionPaths.fromPath, path), sql`${actionPaths.path} LIKE ${prefix}`, sql`${actionPaths.fromPath} LIKE ${prefix}`)
    : or(eq(actionPaths.path, path), eq(actionPaths.fromPath, path));
  const rows = await db
    .select({ p: actionPaths, a: actions })
    .from(actionPaths)
    .innerJoin(actions, eq(actions.id, actionPaths.actionId))
    .where(and(eq(actionPaths.workspaceId, wsId), match))
    .orderBy(desc(actions.createdAt), desc(actionPaths.id));
  return rows.map((r) => ({ ...r.p, action: r.a }));
}

/**
 * Block lists recorded by the exact commit that wrote each entry, for many
 * entries at once. A ledger row is trusted only when its action produced the
 * entry's current version (`vc_<version>` ∈ action.commit_ids) and its size and
 * block count agree; anything else (a same-size older upload, a row written by
 * a restore that kept no blocks) is not proof of content and is ignored.
 */
export async function exactBlockLists(wsId: string, stats: FileStat[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const withVersion = stats.filter((s) => s.type === 'file' && s.version);
  for (let i = 0; i < withVersion.length; i += 1000) {
    const chunk = withVersion.slice(i, i + 1000);
    const commitIds = [...new Set(chunk.map((s) => `vc_${s.version}`))];
    const rows = await db
      .select({ path: actionPaths.path, blocks: actionPaths.blockHashes, size: actionPaths.size, commitIds: actions.commitIds })
      .from(actionPaths)
      .innerJoin(actions, eq(actions.id, actionPaths.actionId))
      .where(
        and(
          eq(actionPaths.workspaceId, wsId),
          inArray(
            actionPaths.path,
            chunk.map((s) => s.path),
          ),
          ne(actionPaths.op, 'deleted'),
          isNotNull(actionPaths.blockHashes),
          ne(actions.status, 'failed'),
          sql`${actions.commitIds} && ${sql.param(commitIds)}::text[]`,
          // A plan row whose own upload never committed is a claim, not content.
          notFromOpenPlan(actionPaths.actionId, actionPaths.path),
        ),
      );
    const want = new Map(chunk.map((s) => [s.path, s]));
    for (const r of rows) {
      const s = want.get(r.path);
      if (!s || !r.blocks || out.has(r.path)) continue;
      if (!r.commitIds.includes(`vc_${s.version}`)) continue;
      if ((r.size ?? -1) !== s.size || r.blocks.length !== Math.ceil(s.size / 1_048_576)) continue;
      out.set(r.path, r.blocks);
    }
  }
  return out;
}

/** Committed `deleted` rows, newest first. */
export async function deletedRows(wsId: string, limit: number): Promise<(ActionPathRow & { action: ActionRow })[]> {
  const rows = await db
    .select({ p: actionPaths, a: actions })
    .from(actionPaths)
    .innerJoin(actions, eq(actions.id, actionPaths.actionId))
    .where(and(eq(actionPaths.workspaceId, wsId), eq(actionPaths.op, 'deleted'), eq(actions.status, 'committed')))
    .orderBy(desc(actions.createdAt), desc(actionPaths.id))
    .limit(limit);
  return rows.map((r) => ({ ...r.p, action: r.a }));
}

/**
 * Pending actions older than 2 minutes (and not an upload still in flight):
 * when history holds exactly one commit after base_commit_id that no action
 * claims, and storage shows the action's recorded changes in it (see
 * holdsChanges), attach it and mark committed; otherwise mark failed. Everything is
 * re-read under the workspace lock, so an action that finished while this
 * waited is left alone (and finalize never downgrades a finished action).
 */
export async function reconcilePending(ws: WorkspaceCtx, opts: { olderThanMs?: number } = {}): Promise<void> {
  const cutoff = () => new Date(Date.now() - (opts.olderThanMs ?? 2 * 60_000));
  const stale = () =>
    db
      .select()
      .from(actions)
      .where(and(eq(actions.workspaceId, ws.id), eq(actions.status, 'pending'), lt(actions.createdAt, cutoff())))
      .orderBy(asc(actions.createdAt));
  // Cheap pre-check outside the lock: most timeline loads have nothing to do.
  if (!(await stale()).length) return;

  await withWorkspaceLock(ws.id, async () => {
    const pending = await stale();
    if (!pending.length) return;
    const live = await db
      .select({ actionId: uploads.actionId })
      .from(uploads)
      .where(
        and(
          eq(uploads.workspaceId, ws.id),
          inArray(uploads.status, ['planned', 'uploading']),
          sql`(${uploads.expiresAt} IS NULL OR ${uploads.expiresAt} > now())`,
        ),
      );
    const inFlight = new Set(live.map((l) => l.actionId).filter(Boolean));
    const { commits } = await getStore().history(ws.volumeId, { limit: 200 });
    const claimed = await actionsByCommits(
      ws.id,
      commits.map((c) => c.id),
    );
    for (const a of pending) {
      if (inFlight.has(a.id)) continue;
      const idx = commits.findIndex((c) => c.id === a.baseCommitId);
      const after = idx >= 0 ? commits.slice(0, idx) : [];
      const unclaimed = after.filter((c) => !claimed.has(c.id));
      // The one unclaimed commit is this action's only when it holds the
      // action's recorded changes: another lost write must not be taken for it.
      const rows = unclaimed.length === 1 ? await db.select().from(actionPaths).where(eq(actionPaths.actionId, a.id)) : [];
      if (idx >= 0 && unclaimed.length === 1 && (await holdsChanges(ws.volumeId, rows, unclaimed[0]))) {
        const c = unclaimed[0];
        await attachCommit(a.id, { commitId: c.id, headCommitId: c.id, outcome: 'fast', overwritten: [], skipped: [] });
        const summary = await finalize(a.id, 'committed');
        claimed.set(c.id, { ...a, status: summary.status, commitIds: [c.id] });
      } else {
        await finalize(a.id, 'failed', 'reconciled: no matching commit');
      }
    }
  });
}

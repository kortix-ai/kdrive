// The change ledger. Platinum commits carry only counts, so every user action
// records WHICH paths it touched here. Rule: write the intent before the
// Platinum call, finalise with the commit id after. See architecture §8.

import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNotNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import type { ActionKind, ActionSummary, PathOp } from '@volumes/shared';
import { db } from '../db/client';
import { actionPaths, actions, uploads, workspaces, type ActionPathRow, type ActionRow } from '../db/schema';
import { newId } from '../lib/ids';
import { withWorkspaceLock } from '../lib/lock';
import { getStore } from '../storage';
import type { CommitResult } from '../storage/types';
import type { WorkspaceCtx } from '../types';

export type { ActionPathRow, ActionRow };

export interface ActionCtx {
  ws: WorkspaceCtx;
  userId: string;
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
  };
}

// ── low level ───────────────────────────────────────────────────────────────

/** Records a pending action with its paths; `baseCommitId` = the head before the action. */
export async function recordIntent(ctx: ActionCtx, spec: ActionSpec): Promise<{ actionId: string; baseCommitId: string }> {
  const head = (await getStore().getVolume(ctx.ws.volumeId)).headCommitId;
  const actionId = newId();
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
    });
    if (spec.paths.length) await insertPaths(tx, actionId, ctx.ws.id, spec.paths);
  });
  return { actionId, baseCommitId: head };
}

export async function appendPaths(actionId: string, wsId: string, paths: PathChange[]): Promise<void> {
  if (!paths.length) return;
  await insertPaths(db, actionId, wsId, paths);
}

/** Adds the head commit a Platinum call produced (skips noop). */
export async function attachCommit(actionId: string, r: CommitResult): Promise<void> {
  if (r.outcome === 'noop') return;
  const head = r.headCommitId || r.commitId;
  await db
    .update(actions)
    .set({
      commitIds: sql`CASE WHEN ${head} = ANY(${actions.commitIds}) THEN ${actions.commitIds} ELSE array_append(${actions.commitIds}, ${head}) END`,
      headCommitId: head,
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
 * Finalises an action. `committed` with no attached commit becomes `noop`.
 * bytesDelta = logicalBytes(head) − logicalBytes(base); itemCount = number of path rows.
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
  if (final === 'committed' && row.volumeId) {
    const [h, b] = await Promise.all([logicalBytesAt(row.volumeId, a.headCommitId), logicalBytesAt(row.volumeId, a.baseCommitId)]);
    if (h !== null && b !== null) bytesDelta = h - b;
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(actionPaths).where(eq(actionPaths.actionId, actionId));
  const [updated] = await db
    .update(actions)
    .set({ status: final, bytesDelta, itemCount: n, error: error ?? null, finalizedAt: new Date() })
    .where(eq(actions.id, actionId))
    .returning();
  return toSummary(updated);
}

// ── high level ──────────────────────────────────────────────────────────────

/**
 * Runs one single-request mutation as one action, under the workspace lock:
 * intent → run → finalise. On throw: `failed` when nothing was committed, else
 * `committed` with meta.partial = true; then rethrows.
 */
export async function withAction<T>(
  ctx: ActionCtx,
  spec: ActionSpec,
  run: (rec: ActionRecorder) => Promise<T>,
): Promise<{ result: T; action: ActionSummary }> {
  return withWorkspaceLock(ctx.ws.id, async () => {
    const { actionId, baseCommitId } = await recordIntent(ctx, spec);
    let committed = false;
    const rec: ActionRecorder = {
      actionId,
      baseCommitId,
      commit: async (r) => {
        await attachCommit(actionId, r);
        if (r.outcome !== 'noop') committed = true;
      },
      addPaths: (p) => appendPaths(actionId, ctx.ws.id, p),
    };
    try {
      const result = await run(rec);
      const action = await finalize(actionId, 'committed');
      return { result, action };
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 500) : String(e);
      try {
        if (committed) {
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

// ── queries ─────────────────────────────────────────────────────────────────

export async function getAction(wsId: string, actionId: string): Promise<ActionRow | null> {
  const [row] = await db
    .select()
    .from(actions)
    .where(and(eq(actions.workspaceId, wsId), eq(actions.id, actionId)));
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
 * The newest committed ledger row for `path` with a known block list, from an
 * action created at or before `asOf`. The caller checks the size against stat.
 */
export async function lastKnownBlocks(wsId: string, path: string, asOf: Date): Promise<{ blocks: string[]; size: number } | null> {
  const [row] = await db
    .select({ blocks: actionPaths.blockHashes, size: actionPaths.size })
    .from(actionPaths)
    .innerJoin(actions, eq(actions.id, actionPaths.actionId))
    .where(
      and(
        eq(actionPaths.workspaceId, wsId),
        eq(actionPaths.path, path),
        ne(actionPaths.op, 'deleted'),
        isNotNull(actionPaths.blockHashes),
        eq(actions.status, 'committed'),
        lte(actions.createdAt, asOf),
      ),
    )
    .orderBy(desc(actions.createdAt), desc(actionPaths.id))
    .limit(1);
  if (!row || !row.blocks) return null;
  return { blocks: row.blocks, size: row.size ?? 0 };
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
 * claims, attach it and mark committed; otherwise mark failed.
 */
export async function reconcilePending(ws: WorkspaceCtx, opts: { olderThanMs?: number } = {}): Promise<void> {
  const cutoff = new Date(Date.now() - (opts.olderThanMs ?? 2 * 60_000));
  const pending = await db
    .select()
    .from(actions)
    .where(and(eq(actions.workspaceId, ws.id), eq(actions.status, 'pending'), lt(actions.createdAt, cutoff)))
    .orderBy(asc(actions.createdAt));
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

  await withWorkspaceLock(ws.id, async () => {
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
      if (idx >= 0 && unclaimed.length === 1) {
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

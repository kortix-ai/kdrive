// The timeline: one entry per user action, newest first, built from the
// volume history (what still exists) and the ledger (what each commit did).
// Owner: API-versioning. See architecture §9.2.
//
// - Commits of one action are grouped into one entry, keyed by the action's
//   newest surviving commit.
// - A surviving commit no action claims is `external`; a `fork` commit is
//   "Workspace duplicated from …"; `init` is hidden.
// - Committed actions whose commits were all thinned by retention merge into
//   the next newer surviving entry (`mergedCount`, paths added to the
//   preview), so no entry ever points at an unreadable version.

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { TimelineEntry, TimelineResponse } from '@volumes/shared';
import { bauthUser } from '../auth/schema';
import { db } from '../db/client';
import { actions, workspaces, type ActionRow } from '../db/schema';
import { getStore } from '../storage';
import type { Commit } from '../storage/types';
import type { WorkspaceCtx } from '../types';
import { checkpointsByCommit } from './checkpoints';
import { actionsByCommits, reconcilePending } from './ledger';
import { cmpCommitId } from './versioning-util';

const PREVIEW_PATHS = 5;
const MAX_HISTORY_PAGES = 50;

interface Group {
  commits: Commit[]; // newest first
  action: ActionRow | null;
  hidden: boolean;
}

/** Preview path rows (≤ 5 per action) for the given actions, in ledger order. */
async function previewPaths(actionIds: string[]): Promise<Map<string, { op: string; path: string; fromPath: string | null }[]>> {
  const out = new Map<string, { op: string; path: string; fromPath: string | null }[]>();
  if (!actionIds.length) return out;
  const rows = await db.execute<{ action_id: string; op: string; path: string; from_path: string | null }>(sql`
    SELECT action_id, op, path, from_path FROM (
      SELECT action_id, op, path, from_path, id,
             row_number() OVER (PARTITION BY action_id ORDER BY id) AS rn
      FROM action_paths
      WHERE action_id = ANY(${sql.param(actionIds)}::text[])
    ) t
    WHERE rn <= ${PREVIEW_PATHS}
    ORDER BY action_id, id`);
  for (const r of rows as unknown as { action_id: string; op: string; path: string; from_path: string | null }[]) {
    const l = out.get(r.action_id) ?? [];
    l.push({ op: r.op, path: r.path, fromPath: r.from_path });
    out.set(r.action_id, l);
  }
  return out;
}

/** Committed actions whose head commit lies strictly between `lower` and `upper` (commit-id order). */
async function actionsBetween(wsId: string, lower: string | null, upper: string): Promise<ActionRow[]> {
  const conds = [
    eq(actions.workspaceId, wsId),
    eq(actions.status, 'committed'),
    isNotNull(actions.headCommitId),
    sql`${actions.headCommitId} COLLATE "C" < ${upper}`,
  ];
  if (lower) conds.push(sql`${actions.headCommitId} COLLATE "C" > ${lower}`);
  return db.select().from(actions).where(and(...conds));
}

function groupCommits(commits: Commit[], actionOf: Map<string, ActionRow>, before: string | undefined): Group[] {
  const groups: Group[] = [];
  const byAction = new Map<string, Group>();
  for (const c of commits) {
    const a = actionOf.get(c.id) ?? null;
    if (a) {
      const g = byAction.get(a.id);
      if (g) {
        g.commits.push(c);
        continue;
      }
      // Safety net across pages: an action whose newer commits sit at or
      // above the cursor was already shown on an earlier page.
      if (before && a.commitIds.some((id) => cmpCommitId(id, before) >= 0)) continue;
      const ng: Group = { commits: [c], action: a, hidden: false };
      byAction.set(a.id, ng);
      groups.push(ng);
      continue;
    }
    groups.push({ commits: [c], action: null, hidden: c.kind === 'init' });
  }
  return groups;
}

/** Timeline entries (one per action, newest first). See architecture §9.2. */
export async function buildTimeline(ws: WorkspaceCtx, opts: { limit: number; before?: string }): Promise<TimelineResponse> {
  await reconcilePending(ws);
  const store = getStore();
  const limit = Math.min(Math.max(Math.trunc(opts.limit) || 50, 1), 200);
  const headCommitId = (await store.getVolume(ws.volumeId)).headCommitId;

  // Page history until we hold `limit` visible groups plus one more commit
  // (the lower bound of the last entry), or the history ends.
  const commits: Commit[] = [];
  const actionOf = new Map<string, ActionRow>();
  let cursor = opts.before;
  let exhausted = false;
  let groups: Group[] = [];
  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const r = await store.history(ws.volumeId, { limit: 200, before: cursor });
    commits.push(...r.commits);
    const claimed = await actionsByCommits(
      ws.id,
      r.commits.map((c) => c.id),
    );
    for (const [k, v] of claimed) actionOf.set(k, v);
    groups = groupCommits(commits, actionOf, opts.before);
    if (!r.nextCursor) {
      exhausted = true;
      break;
    }
    cursor = r.nextCursor;
    if (groups.filter((g) => !g.hidden).length > limit) break;
  }

  const visibleGroups = groups.filter((g) => !g.hidden);
  const taken = visibleGroups.slice(0, limit);
  const hasMore = visibleGroups.length > limit || !exhausted;
  const indexOf = new Map(commits.map((c, i) => [c.id, i]));
  const commitIdSet = new Set(commits.map((c) => c.id));

  // The commit just below each entry (its merge window's lower bound).
  const lowerOf = (g: Group): Commit | null => {
    const oldest = g.commits[g.commits.length - 1];
    const i = indexOf.get(oldest.id)!;
    return commits[i + 1] ?? null;
  };
  const lowerKnown = (g: Group) => lowerOf(g) !== null || exhausted;

  // Thinned actions → the next newer surviving entry.
  const merged = new Map<Group, ActionRow[]>();
  if (taken.length) {
    const upper = taken[0].commits[0].id;
    const last = taken[taken.length - 1];
    const lowest = lowerKnown(last) ? (lowerOf(last)?.id ?? null) : last.commits[last.commits.length - 1].id;
    const thinned = (await actionsBetween(ws.id, lowest, upper)).filter((a) => !a.commitIds.some((id) => commitIdSet.has(id)));
    for (const a of thinned) {
      const head = a.headCommitId!;
      // Oldest entry whose newest commit is newer than the action's head.
      for (let i = taken.length - 1; i >= 0; i--) {
        const g = taken[i];
        if (cmpCommitId(g.commits[0].id, head) > 0) {
          const lo = lowerOf(g);
          if (lo && cmpCommitId(head, lo.id) <= 0) break;
          if (!lo && !exhausted && cmpCommitId(head, g.commits[g.commits.length - 1].id) < 0) break;
          const l = merged.get(g) ?? [];
          l.push(a);
          merged.set(g, l);
          break;
        }
      }
    }
    for (const l of merged.values()) l.sort((x, y) => cmpCommitId(y.headCommitId!, x.headCommitId!));
  }

  // Side data: actors, preview paths, checkpoints, fork source.
  const allActions = [...taken.map((g) => g.action).filter((a): a is ActionRow => !!a), ...[...merged.values()].flat()];
  const userIds = [...new Set(allActions.map((a) => a.userId).filter((u): u is string => !!u))];
  const [users, paths, cps, forkSource] = await Promise.all([
    userIds.length
      ? db.select({ id: bauthUser.id, name: bauthUser.name, email: bauthUser.email }).from(bauthUser).where(inArray(bauthUser.id, userIds))
      : Promise.resolve([]),
    previewPaths(allActions.map((a) => a.id)),
    checkpointsByCommit(
      ws.id,
      taken.flatMap((g) => g.commits.map((c) => c.id)),
    ),
    taken.some((g) => !g.action && g.commits[0].kind === 'fork') ? forkSourceName(ws.id) : Promise.resolve(null),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));

  const entries: TimelineEntry[] = taken.map((g) => {
    const c = g.commits[0];
    const a = g.action;
    const m = merged.get(g) ?? [];
    const lower = lowerOf(g);
    const kind: TimelineEntry['kind'] = a ? a.kind : c.kind === 'fork' ? 'fork' : c.kind === 'init' ? 'init' : 'external';
    const summary = a
      ? a.summary
      : kind === 'fork'
        ? forkSource
          ? `Workspace duplicated from ${forkSource}`
          : 'Workspace duplicated'
        : 'Changed outside the app';
    const ownItems = a ? a.itemCount : kind === 'fork' ? c.fileCount : c.stats.changedPaths + c.stats.deletedPaths;
    const bytesDelta = lower
      ? c.logicalBytes - lower.logicalBytes
      : a
        ? a.bytesDelta + m.reduce((s, x) => s + x.bytesDelta, 0)
        : c.logicalBytes;
    const u = a?.userId ? userById.get(a.userId) : undefined;
    const preview = [...(a ? (paths.get(a.id) ?? []) : []), ...m.flatMap((x) => paths.get(x.id) ?? [])]
      .slice(0, PREVIEW_PATHS)
      .map((p) => ({ op: p.op as TimelineEntry['paths'][number]['op'], path: p.path, fromPath: p.fromPath }));
    return {
      id: a?.id ?? c.id,
      commitId: c.id,
      createdAt: c.createdAt,
      kind,
      summary,
      itemCount: ownItems + m.reduce((s, x) => s + x.itemCount, 0),
      bytesDelta,
      actor: u ? { name: u.name, email: u.email } : null,
      checkpoints: g.commits.flatMap((gc) => (cps.get(gc.id) ?? []).map((cp) => ({ id: cp.id, name: cp.name }))),
      mergedCount: m.length,
      isHead: g.commits.some((gc) => gc.id === headCommitId),
      undoable: a?.status === 'committed',
      actionId: a?.id ?? null,
      paths: preview,
    };
  });

  const lastTaken = taken[taken.length - 1];
  const nextCursor = hasMore && lastTaken ? lastTaken.commits[lastTaken.commits.length - 1].id : null;
  return { entries, nextCursor, headCommitId };
}

async function forkSourceName(wsId: string): Promise<string | null> {
  const [row] = await db.select({ from: workspaces.forkedFromWorkspaceId }).from(workspaces).where(eq(workspaces.id, wsId));
  if (!row?.from) return null;
  const [src] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, row.from));
  return src?.name ?? null;
}

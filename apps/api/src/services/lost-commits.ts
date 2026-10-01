// Upload commits whose response was lost. A commit can land in storage while
// the API never learns its id (a timeout or 5xx, and the head unreadable right
// after), leaving the upload's action pending with no commit. The upload row
// keeps the head its first commit attempt ran on (plan.commitHead); once the
// store answers again, the commit on the head chain after it that no action
// claims and that holds exactly this plan's writes (the planned bytes, not just
// the planned sizes) is this upload's, and the ledger records it. Until then nothing is assumed: storage must confirm it.
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { actionPaths, actions, uploads, type UploadRowPlan } from '../db/schema';
import { withWorkspaceLock } from '../lib/lock';
import { getStore } from '../storage';
import type { Commit } from '../storage/types';
import { blocksMatchAt, sample, statAt, writtenByCommit } from './commit-proof';
import type { WorkspaceCtx } from '../types';
import { actionsByCommits, attachCommit, finalize } from './ledger';
import { forgetUpload } from './proven-blocks';

/** How far back from the head the chain is walked looking for the landed commit. */
const MAX_WALK = 200;

type LostRow = { id: string; actionId: string | null; plan: UploadRowPlan };

/** The block list planned for each file of the upload (its ledger rows); a file without one cannot be proven. */
async function plannedBlocks(actionId: string | null): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!actionId) return out;
  const rows = await db
    .select({ path: actionPaths.path, blocks: actionPaths.blockHashes })
    .from(actionPaths)
    .where(and(eq(actionPaths.actionId, actionId), eq(actionPaths.entryType, 'file')));
  for (const r of rows) if (r.blocks) out.set(r.path, r.blocks);
  return out;
}

/**
 * Whether commit `c` is this plan's commit: every sampled planned file is there
 * at its planned size, was written by `c` (its version is `c`'s, or for a
 * merge commit, differs from the version before it) and holds exactly the
 * planned bytes (its block list); a folder-only plan's folders are there and at
 * least one is new. Returns the side commit id of a merge when the files name it.
 */
async function writtenBy(volumeId: string, plan: UploadRowPlan, blocks: Map<string, string[]>, c: Commit): Promise<{ side?: string } | null> {
  if (!c.parentId) return null;
  const files = sample(plan.files);
  if (files.length) {
    let side: string | undefined;
    for (const f of files) {
      const planned = blocks.get(f.path);
      if (!planned) return null;
      const [now, before] = await Promise.all([statAt(volumeId, f.path, c.id), statAt(volumeId, f.path, c.parentId)]);
      if (!now || now.type === 'dir' || now.size !== f.size || !writtenByCommit(c, now, before)) return null;
      if (c.kind === 'merge') {
        side ??= `vc_${now.version}`;
        if (side !== `vc_${now.version}`) return null;
      }
      // Same size is not the same upload: the bytes must be the planned ones.
      if (!(await blocksMatchAt(volumeId, f.path, c.id, planned, f.size))) return null;
    }
    return side && side !== c.id ? { side } : {};
  }
  const dirs = sample(plan.dirs);
  if (!dirs.length) return null;
  let added = false;
  for (const d of dirs) {
    const [now, before] = await Promise.all([statAt(volumeId, d, c.id), statAt(volumeId, d, c.parentId)]);
    if (!now || now.type !== 'dir') return null;
    if (!before) added = true;
  }
  return added ? {} : null;
}

/** Open uploads of the workspace (other than `exceptId`) that an earlier commit attempt left behind. */
function openAttempts(wsId: string, exceptId?: string) {
  return db
    .select({ id: uploads.id, actionId: uploads.actionId, plan: uploads.plan })
    .from(uploads)
    .where(
      and(
        eq(uploads.workspaceId, wsId),
        inArray(uploads.status, ['planned', 'uploading']),
        sql`${uploads.plan} ? 'commitHead'`,
        exceptId ? ne(uploads.id, exceptId) : undefined,
      ),
    )
    .orderBy(asc(uploads.createdAt));
}

/**
 * Whether another open upload's plan is also held exactly by `c` (the same
 * bytes at the same paths). Storage cannot then say whose commit it is, so it
 * is given to none: an unclaimed commit is treated as someone else's write,
 * which is the safe side for undo.
 */
async function claimedByAnother(ws: WorkspaceCtx, rowId: string | undefined, c: Commit): Promise<boolean> {
  for (const other of await openAttempts(ws.id, rowId)) {
    const w = await writtenBy(ws.volumeId, other.plan, await plannedBlocks(other.actionId), c).catch(() => null);
    if (w) return true;
  }
  return false;
}

/**
 * The commit a lost commit attempt of this upload produced, when storage shows
 * it: walks the head chain back to plan.commitHead and takes the commit no
 * action claims (and not in `taken`) that holds exactly this plan's writes.
 * A commit that another open upload's plan matches just as well is nobody's.
 * null when there is none, it is ambiguous, or the chain cannot be read.
 */
export async function findLandedUpload(
  ws: WorkspaceCtx,
  row: Pick<LostRow, 'plan' | 'actionId'> & { id?: string },
  head: string,
  taken: Set<string> = new Set(),
): Promise<{ commit: Commit; side?: string } | null> {
  const from = row.plan.commitHead;
  if (!from || head === from) return null;
  const store = getStore();
  const chain: Commit[] = [];
  let at: string | null = head;
  try {
    while (at && at !== from) {
      if (chain.length >= MAX_WALK) return null;
      const c: Commit = await store.getCommit(ws.volumeId, at);
      chain.push(c);
      at = c.parentId;
    }
  } catch {
    return null;
  }
  if (at !== from) return null;
  const claimed = await actionsByCommits(
    ws.id,
    chain.map((c) => c.id),
  );
  const blocks = await plannedBlocks(row.actionId);
  for (const c of chain.reverse()) {
    if (claimed.has(c.id) || taken.has(c.id)) continue;
    const w = await writtenBy(ws.volumeId, row.plan, blocks, c).catch(() => null);
    if (!w) continue;
    if (await claimedByAnother(ws, row.id, c)) return null;
    return { commit: c, ...w };
  }
  return null;
}

/** Records a landed commit for the upload (caller holds the workspace lock): the action gets it and is finalised; the upload is committed. */
export async function recordLandedUpload(row: Pick<LostRow, 'id' | 'actionId'>, landed: { commit: Commit; side?: string }): Promise<void> {
  const c = landed.commit;
  forgetUpload(row.id);
  await db.update(uploads).set({ status: 'committed', updatedAt: new Date() }).where(eq(uploads.id, row.id));
  if (!row.actionId) return;
  // The action's base is the head its commit was made on (a retry may have run on a newer head).
  if (c.parentId) {
    await db
      .update(actions)
      .set({ baseCommitId: c.parentId })
      .where(and(eq(actions.id, row.actionId), sql`cardinality(${actions.commitIds}) = 0`));
  }
  await attachCommit(
    row.actionId,
    landed.side
      ? { commitId: landed.side, headCommitId: c.id, outcome: 'merged', overwritten: [], skipped: [] }
      : { commitId: c.id, headCommitId: c.id, outcome: 'fast', overwritten: [], skipped: [] },
  );
  await finalize(row.actionId, 'committed');
}

/**
 * Records every upload commit of this workspace whose response was lost and
 * that storage now shows. Cheap when there is none; a store that still does
 * not answer leaves everything as it is for the next call.
 */
export async function reconcileLostCommits(ws: WorkspaceCtx): Promise<void> {
  const open = () => openAttempts(ws.id);
  if (!(await open()).length) return;
  await withWorkspaceLock(ws.id, async () => {
    const rows = await open();
    if (!rows.length) return;
    let head: string;
    try {
      head = (await getStore().getVolume(ws.volumeId)).headCommitId;
    } catch {
      return;
    }
    const taken = new Set<string>();
    for (const row of rows) {
      const landed = await findLandedUpload(ws, row, head, taken);
      if (!landed) continue;
      taken.add(landed.commit.id);
      await recordLandedUpload(row, landed);
    }
  });
}

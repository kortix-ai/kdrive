// Block upload relay: the browser hashes 1 MiB blocks and sends a plan; we
// check names, conflicts and quota BEFORE any bytes move, forward the plan to
// the store (which queues for one of the 4 org-wide upload slots), relay only
// the missing blocks, and commit the whole plan as one version (one action).
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  BLOCK_SIZE,
  EmptyBody,
  UploadCommitResponse,
  UploadPlanRequest,
  UploadPlanResponse,
  basename,
  dirname,
  type ActionSummary,
} from '@volumes/shared';
import { db } from '../db/client';
import { actions, uploads } from '../db/schema';
import { ApiError, noContent, ok, parseJson } from '../lib/http';
import { newId } from '../lib/ids';
import { withWorkspaceLock } from '../lib/lock';
import { checkRateLimit, limits } from '../middleware/rate-limit';
import { actionPaths } from '../db/schema';
import { appendPaths, attachCommit, finalize, getAction, isAmbiguousFailure, recordIntent, toSummary } from '../services/ledger';
import {
  forgetUpload,
  markReceived,
  missingForUser,
  sha256Hex,
  trackRequired,
  unprovenBlocks,
  unreceivedBlocks,
} from '../services/proven-blocks';
import { findLandedUpload, recordLandedUpload } from '../services/lost-commits';
import { planGrowth } from '../services/footprint';
import { assertQuota } from '../services/quota';
import { Hold, reserveQuota } from '../services/reservations';
import { statOrNull } from '../services/tree';
import { resolveUploadPlan, type ResolvedUploadPlan } from '../services/upload-plan';
import { getStore } from '../storage';
import { isStoreError, type CommitResult, type UploadPlan } from '../storage/types';
import type { AppEnv, WorkspaceCtx } from '../types';

export const uploadsRoutes = new Hono<AppEnv>();

const SHA = /^[0-9a-f]{64}$/;
const UPLOAD_ID = /^[0-9a-z]{26}$/;
const PLAN_TTL_MS = 15 * 60_000;
/** Renew `uploads.expires_at` at most once a minute while blocks stream in. */
const RENEW_EVERY_MS = 60_000;

const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Deepest common ancestor folder of normalised paths. */
function commonDir(paths: string[]): string {
  if (!paths.length) return '/';
  let common = paths[0].split('/').filter(Boolean);
  for (const p of paths.slice(1)) {
    const segs = p.split('/').filter(Boolean);
    let i = 0;
    while (i < common.length && i < segs.length && common[i] === segs[i]) i++;
    common = common.slice(0, i);
  }
  return '/' + common.join('/');
}

/**
 * Timeline text for an upload: "Uploaded a.txt", "Uploaded 3 files to /Photos",
 * "Uploaded folder Trip (120 files)", "Replaced a.txt", "Created folder x".
 * A folder upload is recognised by its files landing in a folder that does not exist yet.
 */
export async function uploadSummary(ws: WorkspaceCtx, r: Pick<ResolvedUploadPlan, 'plan' | 'replaced'>): Promise<string> {
  const files = r.plan.files.map((f) => f.path);
  const dirs = r.plan.dirs;
  if (!files.length) {
    if (dirs.length === 1) {
      const d = dirname(dirs[0]);
      return `Created folder ${basename(dirs[0])}${d === '/' ? '' : ` in ${d}`}`;
    }
    return `Created ${plural(dirs.length, 'folder')}`;
  }
  if (files.length === 1 && r.replaced.length === 1) return `Replaced ${basename(files[0])}`;
  // An uploaded dir is itself part of the upload, so it counts as a folder path, not its parent.
  const base = commonDir([...files.map((p) => dirname(p)), ...dirs]);
  // Climb to the topmost folder that does not exist yet: that is the uploaded folder.
  let top: string | null = null;
  for (let cur = base; cur !== '/'; cur = dirname(cur)) {
    if (await statOrNull(ws, cur)) break;
    top = cur;
  }
  if (top) {
    const into = dirname(top);
    return `Uploaded folder ${basename(top)} (${plural(files.length, 'file')})${into === '/' ? '' : ` to ${into}`}`;
  }
  if (files.length === 1) {
    const d = dirname(files[0]);
    return d === '/' ? `Uploaded ${basename(files[0])}` : `Uploaded ${basename(files[0])} to ${d}`;
  }
  return base === '/' ? `Uploaded ${plural(files.length, 'file')}` : `Uploaded ${plural(files.length, 'file')} to ${base}`;
}

type UploadRow = typeof uploads.$inferSelect;

async function loadUpload(ws: WorkspaceCtx, userId: string, id: string): Promise<UploadRow> {
  if (!UPLOAD_ID.test(id)) throw new ApiError(404, 'not_found', 'Upload not found.');
  const [row] = await db
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, id), eq(uploads.workspaceId, ws.id), eq(uploads.userId, userId)));
  if (!row) throw new ApiError(404, 'not_found', 'Upload not found.');
  return row;
}

/** An upload row without its plan JSON (a block PUT needs none of it). */
async function loadUploadForBlocks(ws: WorkspaceCtx, userId: string, id: string) {
  if (!UPLOAD_ID.test(id)) throw new ApiError(404, 'not_found', 'Upload not found.');
  const [row] = await db
    .select({ id: uploads.id, actionId: uploads.actionId, ptUploadId: uploads.ptUploadId, status: uploads.status, expiresAt: uploads.expiresAt })
    .from(uploads)
    .where(and(eq(uploads.id, id), eq(uploads.workspaceId, ws.id), eq(uploads.userId, userId)));
  if (!row) throw new ApiError(404, 'not_found', 'Upload not found.');
  return row;
}

async function setStatus(id: string, status: UploadRow['status'], extra: Partial<UploadRow> = {}): Promise<void> {
  await db
    .update(uploads)
    .set({ ...extra, status, updatedAt: new Date() })
    .where(eq(uploads.id, id));
}

/**
 * Fails the upload's action unless another plan of the same action already
 * committed (a multi-plan upload keeps what landed).
 */
async function failActionIfEmpty(actionId: string | null, reason: string): Promise<void> {
  if (!actionId) return;
  const [a] = await db.select().from(actions).where(eq(actions.id, actionId));
  if (!a || a.status === 'failed') return;
  if (a.commitIds.length > 0) {
    await finalize(actionId, 'committed');
    return;
  }
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(uploads)
    .where(and(eq(uploads.actionId, actionId), inArray(uploads.status, ['planned', 'uploading'])));
  if (n > 0) return; // another plan of this action is still live
  await finalize(actionId, 'failed', reason);
}

/** Store 404 `not_found` on an upload means Platinum dropped the plan (15 min idle). */
async function expired(row: Pick<UploadRow, 'id' | 'actionId'>): Promise<never> {
  forgetUpload(row.id);
  await setStatus(row.id, 'expired');
  await failActionIfEmpty(row.actionId, 'upload expired');
  throw new ApiError(404, 'not_found', 'This upload expired. Start it again.', { uploadId: row.id });
}

/** Reads a request body into memory, refusing more than `max` bytes. */
async function readBody(req: Request, max: number): Promise<Uint8Array> {
  const len = req.headers.get('content-length');
  if (len !== null && Number(len) > max) throw new ApiError(413, 'payload_too_large', 'A block is at most 1 MiB.', { max });
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new ApiError(413, 'payload_too_large', 'A block is at most 1 MiB.', { max });
    }
    chunks.push(value);
  }
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let off = 0;
  for (const ch of chunks) {
    out.set(ch, off);
    off += ch.length;
  }
  return out;
}

// ── plan ───────────────────────────────────────────────────────────────────

uploadsRoutes.post('/uploads', async (c) => {
  const user = c.get('user');
  const ws = c.get('ws');
  checkRateLimit({ ...limits.uploadPlan, key: () => user.id }, c);
  const req = await parseJson(c, UploadPlanRequest);

  // A later plan of a multi-plan upload (more than 10k files) joins the first plan's action.
  let joined: Awaited<ReturnType<typeof getAction>> = null;
  if (req.actionId) {
    joined = await getAction(ws.id, req.actionId);
    if (!joined || joined.userId !== user.id || (joined.kind !== 'upload' && joined.kind !== 'folder.create')) {
      throw new ApiError(404, 'not_found', 'Upload action not found.');
    }
    if (joined.status === 'failed' || joined.status === 'noop') {
      throw new ApiError(409, 'conflict', 'That upload already ended. Start it again.');
    }
  }

  // The head the conflicts are resolved against: a commit onto a newer head re-checks them.
  const head = (await getStore().getVolume(ws.volumeId)).headCommitId;
  const resolved = await resolveUploadPlan(ws, req, head);
  if (joined && resolved.plan.files.length) {
    // One file per path per action: the ledger row of a path is then the block
    // list of exactly one plan (what a re-plan, a restore and proof all read).
    const [dup] = await db
      .select({ path: actionPaths.path })
      .from(actionPaths)
      .where(
        and(
          eq(actionPaths.actionId, joined.id),
          eq(actionPaths.entryType, 'file'),
          inArray(
            actionPaths.path,
            resolved.plan.files.map((f) => f.path),
          ),
        ),
      )
      .limit(1);
    if (dup) throw new ApiError(400, 'bad_request', `"${dup.path}" is already part of this upload.`, { path: dup.path });
  }
  // Blocks this user must send whatever the store holds: every planned block
  // their own committed content does not already list.
  const required = await unprovenBlocks(
    user.id,
    resolved.plan.files.flatMap((f) => f.blocks),
  );
  // Quota is checked before anything is recorded or sent (413 with QuotaDetails),
  // counting what other in-flight uploads reserved. Checking and reserving happen
  // under one per-user lock, so two plans made at once cannot both fit.
  const id = newId();
  /** The action this plan belongs to: a later plan joins the first plan's action. */
  const recordPlan = async (): Promise<string> => {
    if (joined) {
      const actionId = joined.id;
      await appendPaths(actionId, ws.id, resolved.changes);
      const prevFiles = Number((joined.meta as { files?: number }).files ?? 0);
      const files = prevFiles + resolved.plan.files.length;
      const summary = files > 0 ? uploadSummaryForTotal(joined.summary, files) : joined.summary;
      await db
        .update(actions)
        .set({ summary, meta: sql`${actions.meta} || ${JSON.stringify({ files, plans: Number((joined.meta as { plans?: number }).plans ?? 1) + 1 })}::jsonb` })
        .where(eq(actions.id, actionId));
      return actionId;
    } else {
      const rec = await recordIntent(
        { ws, userId: user.id },
        {
          kind: resolved.plan.files.length ? 'upload' : 'folder.create',
          summary: await uploadSummary(ws, resolved),
          paths: resolved.changes,
          meta: { files: resolved.plan.files.length, plans: 1, renamed: resolved.renamed.length },
        },
      );
      return rec.actionId;
    }
  };

  let actionId = '';
  {
    // Reserved for the drive's owner in the database (any API process; a member's upload counts against the
    // owner's quota); once the upload row exists it carries the bytes.
    await using _quota = await reserveQuota(ws.userId, resolved.addedBytes, 'upload.plan');
    actionId = await recordPlan();
    await db.insert(uploads).values({
      id,
      workspaceId: ws.id,
      userId: user.id,
      actionId,
      ptUploadId: null,
      status: 'planned',
      plan: {
        files: resolved.plan.files.map((f) => ({ path: f.path, size: f.size })),
        dirs: resolved.plan.dirs,
        overwrite: resolved.plan.overwrite,
        renamed: resolved.renamed,
        baseCommitId: head,
        required,
      },
      totalBytes: resolved.totalBytes,
      addedBytes: Math.max(0, resolved.addedBytes),
      missingCount: 0,
      expiresAt: new Date(Date.now() + PLAN_TTL_MS),
    });
  }
  trackRequired(id, required);

  let planned;
  try {
    planned = await getStore().planUpload(ws.volumeId, resolved.plan);
  } catch (e) {
    forgetUpload(id);
    await setStatus(id, 'failed');
    if (!joined) await finalize(actionId, 'failed', e instanceof Error ? e.message.slice(0, 500) : String(e));
    throw e;
  }
  const expiresAt = new Date(planned.expiresAt);
  // Never reveal what OTHER users store: only blocks this user already holds are skipped.
  const missing = missingForUser(required, planned.missing);
  await setStatus(id, 'planned', {
    ptUploadId: planned.uploadId,
    missingCount: missing.length,
    expiresAt: Number.isFinite(expiresAt.getTime()) ? expiresAt : new Date(Date.now() + PLAN_TTL_MS),
  });

  return ok(c, UploadPlanResponse, {
    uploadId: id,
    actionId,
    missing,
    renamed: resolved.renamed,
    expiresAt: Number.isFinite(expiresAt.getTime()) ? expiresAt.toISOString() : new Date(Date.now() + PLAN_TTL_MS).toISOString(),
  });
});

/** Keeps a multi-plan summary truthful: "Uploaded 12,000 files to /Photos". */
function uploadSummaryForTotal(prev: string, files: number): string {
  const folder = /^Uploaded folder (.+?) \([\d,]+ files?\)(.*)$/.exec(prev);
  if (folder) return `Uploaded folder ${folder[1]} (${plural(files, 'file')})${folder[2]}`;
  const to = /^Uploaded [\d,]+ files? to (.+)$/.exec(prev);
  if (to) return `Uploaded ${plural(files, 'file')} to ${to[1]}`;
  return `Uploaded ${plural(files, 'file')}`;
}

// ── blocks ─────────────────────────────────────────────────────────────────

uploadsRoutes.put('/uploads/:id/blocks/:sha', async (c) => {
  const ws = c.get('ws');
  const sha = c.req.param('sha');
  if (!SHA.test(sha)) throw new ApiError(400, 'bad_request', 'A block is addressed by its lowercase sha256 hex digest.');
  const row = await loadUploadForBlocks(ws, c.get('user').id, c.req.param('id'));
  if (row.status !== 'planned' && row.status !== 'uploading') {
    throw new ApiError(409, 'conflict', `This upload is ${row.status}; no more blocks are accepted.`, { status: row.status });
  }
  if (!row.ptUploadId) throw new ApiError(409, 'conflict', 'This upload is not ready for blocks yet.');
  const bytes = await readBody(c.req.raw, BLOCK_SIZE);
  // The bytes are the proof of possession: check them here, whatever the store does.
  if (sha256Hex(bytes) !== sha) throw new ApiError(400, 'bad_request', 'These bytes do not match the block hash.');
  try {
    await getStore().putBlock(ws.volumeId, row.ptUploadId, sha, bytes);
  } catch (e) {
    if (isStoreError(e, 'not_found')) await expired(row);
    throw e;
  }
  await markReceived(row.id, sha);
  const now = Date.now();
  if (row.status === 'planned' || !row.expiresAt || row.expiresAt.getTime() < now + PLAN_TTL_MS - RENEW_EVERY_MS) {
    await setStatus(row.id, 'uploading', { expiresAt: new Date(now + PLAN_TTL_MS) });
  }
  return noContent(c);
});

// ── commit ─────────────────────────────────────────────────────────────────

/** The full store plan of an upload row, rebuilt from its ledger rows (sizes, block lists, mtimes). */
async function storePlanOf(row: UploadRow): Promise<UploadPlan | null> {
  if (!row.actionId) return null;
  const want = new Set(row.plan.files.map((f) => f.path));
  const rows = await db
    .select({ path: actionPaths.path, size: actionPaths.size, blocks: actionPaths.blockHashes, mtime: actionPaths.mtime })
    .from(actionPaths)
    .where(and(eq(actionPaths.actionId, row.actionId), eq(actionPaths.entryType, 'file')));
  const byPath = new Map(rows.filter((r) => want.has(r.path)).map((r) => [r.path, r]));
  const files: UploadPlan['files'] = [];
  for (const f of row.plan.files) {
    const r = byPath.get(f.path);
    if (!r?.blocks) return null;
    files.push({ path: f.path, size: f.size, blocks: r.blocks, ...(r.mtime !== null ? { mtime: r.mtime } : {}) });
  }
  return { files, dirs: row.plan.dirs, overwrite: row.plan.overwrite };
}

/**
 * Files this plan adds (not replaces) that exist at head now: something was
 * created there between plan and commit. They go back to the browser as a
 * conflict to resolve, instead of being silently overwritten.
 */
async function newConflicts(ws: WorkspaceCtx, row: UploadRow): Promise<string[]> {
  if (!row.actionId) return [];
  const planned = new Set(row.plan.files.map((f) => f.path));
  const added = await db
    .select({ path: actionPaths.path })
    .from(actionPaths)
    .where(and(eq(actionPaths.actionId, row.actionId), eq(actionPaths.op, 'added'), eq(actionPaths.entryType, 'file')));
  const out: string[] = [];
  for (const { path } of added) if (planned.has(path) && (await statOrNull(ws, path))) out.push(path);
  return out;
}

uploadsRoutes.post('/uploads/:id/commit', async (c) => {
  await parseJson(c, EmptyBody);
  const ws = c.get('ws');
  const user = c.get('user');
  const row = await loadUpload(ws, user.id, c.req.param('id'));
  const fileCount = row.plan.files.length;

  // A retried commit after success answers the same result.
  if (row.status === 'committed' && row.actionId) {
    const a = await getAction(ws.id, row.actionId);
    if (a) return ok(c, UploadCommitResponse, { action: toSummary(a), files: fileCount });
  }
  if (row.status !== 'planned' && row.status !== 'uploading') {
    throw new ApiError(409, 'conflict', `This upload is ${row.status}. Start it again.`, { status: row.status });
  }
  if (!row.ptUploadId || !row.actionId) throw new ApiError(409, 'conflict', 'This upload was never planned. Start it again.');
  const actionId = row.actionId;
  const store = getStore();

  const result = await withWorkspaceLock(ws.id, async () => {
    // Re-check under the lock: a concurrent commit of the same upload may have won.
    const [fresh] = await db.select().from(uploads).where(eq(uploads.id, row.id));
    if (fresh?.status === 'committed') return null;
    // An earlier attempt whose response was lost may have landed: storage decides.
    if (fresh?.plan.commitHead) {
      const landed = await findLandedUpload(ws, fresh, (await store.getVolume(ws.volumeId)).headCommitId);
      if (landed) {
        await recordLandedUpload(fresh, landed);
        return null;
      }
    }
    // Proof of possession: every block this user had not proven at plan time
    // must have arrived through this upload. The plan stays alive; the browser
    // sends what is listed and commits again.
    const required = fresh?.plan.required ?? row.plan.required;
    const left = await unreceivedBlocks(row.id, required);
    if (left === null) {
      throw new ApiError(409, 'conflict', 'This upload was started before an update. Start it again.', { uploadId: row.id });
    }
    if (left.length) throw new ApiError(409, 'conflict', 'Some blocks are still missing.', { missing: left, uploadId: row.id });
    let ptUploadId = fresh?.ptUploadId ?? row.ptUploadId!;
    const head = (await store.getVolume(ws.volumeId)).headCommitId;
    const planBase = row.plan.baseCommitId;

    if (planBase && head !== planBase) {
      // The head moved since the plan (another tab, a rename, a delete...).
      const clash = await newConflicts(ws, row);
      if (clash.length) {
        throw new ApiError(
          409,
          'conflict',
          clash.length === 1 ? `"${basename(clash[0])}" was created since this upload started.` : `${clash.length} items were created since this upload started.`,
          { conflicts: clash, uploadId: row.id },
        );
      }
    }
    // Quota again, against what is committed and reserved now (this upload
    // excluded: its row still holds its bytes). The plan's estimate is only
    // good for the head it was made on: on a newer head (a replaced file moved
    // away, a folder deleted...) the growth is measured again, and what it adds
    // beyond the row's bytes is reserved until the commit lands.
    const held = fresh?.addedBytes ?? row.addedBytes;
    const growth = planBase && head !== planBase ? await planGrowth(ws, head, row.plan.files, row.plan.dirs) : held;
    try {
      if (growth > held) {
        // Reserve the difference atomically, then let the row carry the whole growth (a retried commit keeps it).
        await using more = new Hold(ws.userId, 'upload.commit');
        await more.reserve({ bytes: growth - held });
        await db.update(uploads).set({ addedBytes: growth }).where(eq(uploads.id, row.id));
      } else await assertQuota(ws.userId, growth, { excludeUploadId: row.id });
    } catch (e) {
      store.releaseUpload(ptUploadId);
      forgetUpload(row.id);
      await setStatus(row.id, 'failed');
      await failActionIfEmpty(actionId, 'over quota at commit');
      throw e;
    }

    if (planBase && head !== planBase) {
      // Platinum would commit against the plan's base and merge (a hidden side
      // commit plus a `merge` head that retention thins). Every block is stored
      // by now, so a fresh plan on the current head commits at once, fast.
      const plan = await storePlanOf(row);
      // Re-plan only a plan whose every block is proven: received now, or held before.
      const unproven = plan ? await unprovenBlocks(user.id, plan.files.flatMap((f) => f.blocks), required) : [];
      if (plan && unproven.length === 0) {
        try {
          const fresh2 = await store.planUpload(ws.volumeId, plan, { waitMs: 0 });
          store.releaseUpload(ptUploadId);
          ptUploadId = fresh2.uploadId;
          await setStatus(row.id, 'uploading', { ptUploadId, plan: { ...row.plan, baseCommitId: head } });
        } catch {
          // No free slot: commit the original plan; a `merged` result is recorded as such.
        }
      }
    }

    // The head right before the FIRST commit attempt: the action's base (so undo
    // and the size delta cover exactly this upload), and how a lost response is
    // recognised on a retry.
    const firstHead = fresh?.plan.commitHead ?? head;
    if (!fresh?.plan.commitHead) {
      await db.update(uploads).set({ plan: { ...(fresh?.plan ?? row.plan), commitHead: head } }).where(eq(uploads.id, row.id));
      const [a] = await db.select({ commitIds: actions.commitIds }).from(actions).where(eq(actions.id, actionId));
      if (a && a.commitIds.length === 0) await db.update(actions).set({ baseCommitId: head }).where(eq(actions.id, actionId));
    }

    let r: CommitResult & { files: number };
    try {
      r = await store.commitUpload(ws.volumeId, ptUploadId);
    } catch (e) {
      // Blocks still missing: the plan stays alive; the browser sends them and commits again (409 {missing}).
      if (isStoreError(e, 'bad_request') && e.extra.missing?.length) throw e;
      // Created at commit time with overwrite off: a conflict the browser can resolve; the plan stays.
      if (isStoreError(e, 'path_exists')) {
        const p = e.extra.path ?? e.extra.paths?.[0];
        throw new ApiError(409, 'conflict', 'Something with that name was created since this upload started.', {
          conflicts: p ? [p] : [],
          uploadId: row.id,
        });
      }
      // A timeout / 5xx (or a plan gone after one) may have committed anyway: a
      // commit after the first attempt's head that no action claims and that
      // holds exactly this plan's writes is this upload. When the head cannot be
      // read either, the next look at the ledger records it once storage shows it.
      if (isAmbiguousFailure(e) || isStoreError(e, 'not_found')) {
        const now = await store.getVolume(ws.volumeId).then((v) => v.headCommitId).catch(() => null);
        const planNow = { ...(fresh?.plan ?? row.plan), commitHead: firstHead };
        const landed = now ? await findLandedUpload(ws, { id: row.id, plan: planNow, actionId }, now) : null;
        if (landed) {
          await recordLandedUpload(row, landed);
          return null;
        }
      }
      // Retryable (write ceiling, commit_failed, storage unreachable): keep the plan, the
      // slot and the pending action; the browser commits again.
      if (isStoreError(e, 'rate_limited') || isStoreError(e, 'commit_failed') || isStoreError(e, 'unavailable')) throw e;
      if (isStoreError(e, 'not_found')) await expired(row);
      store.releaseUpload(ptUploadId);
      forgetUpload(row.id);
      await setStatus(row.id, 'failed');
      await failActionIfEmpty(actionId, e instanceof Error ? e.message.slice(0, 500) : String(e));
      throw e;
    }
    return finish(r);

    async function finish(res: CommitResult & { files: number }) {
      forgetUpload(row.id);
      await setStatus(row.id, 'committed');
      await attachCommit(actionId, res);
      // `queued` (merge still running): the action stays pending; reconciliation attaches the merge.
      const summary: ActionSummary =
        res.outcome === 'queued' ? toSummary((await getAction(ws.id, actionId))!) : await finalize(actionId, 'committed');
      return { summary, files: res.files || fileCount };
    }
  });
  if (!result) {
    const a = await getAction(ws.id, actionId);
    if (!a) throw new ApiError(404, 'not_found', 'Upload action not found.');
    return ok(c, UploadCommitResponse, { action: toSummary(a), files: fileCount });
  }
  return ok(c, UploadCommitResponse, { action: result.summary, files: result.files });
});

// ── abort ──────────────────────────────────────────────────────────────────

uploadsRoutes.delete('/uploads/:id', async (c) => {
  const ws = c.get('ws');
  const row = await loadUpload(ws, c.get('user').id, c.req.param('id'));
  if (row.status === 'planned' || row.status === 'uploading') {
    // Platinum keeps the plan (and its org slot) until it expires; so do we.
    if (row.ptUploadId) getStore().releaseUpload(row.ptUploadId);
    forgetUpload(row.id);
    await setStatus(row.id, 'aborted');
    await failActionIfEmpty(row.actionId, 'aborted');
  }
  return noContent(c);
});

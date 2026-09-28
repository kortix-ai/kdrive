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
import { appendPaths, attachCommit, finalize, getAction, recordIntent, toSummary } from '../services/ledger';
import { assertQuota } from '../services/quota';
import { statOrNull } from '../services/tree';
import { resolveUploadPlan, type ResolvedUploadPlan } from '../services/upload-plan';
import { getStore } from '../storage';
import { isStoreError } from '../storage/types';
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
async function expired(row: UploadRow): Promise<never> {
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

  const resolved = await resolveUploadPlan(ws, req);
  // Quota is checked before anything is recorded or sent: 413 with QuotaDetails.
  await assertQuota(user.id, resolved.addedBytes);

  let actionId: string;
  if (joined) {
    actionId = joined.id;
    await appendPaths(actionId, ws.id, resolved.changes);
    const prevFiles = Number((joined.meta as { files?: number }).files ?? 0);
    const files = prevFiles + resolved.plan.files.length;
    const summary = files > 0 ? uploadSummaryForTotal(joined.summary, files) : joined.summary;
    await db
      .update(actions)
      .set({ summary, meta: sql`${actions.meta} || ${JSON.stringify({ files, plans: Number((joined.meta as { plans?: number }).plans ?? 1) + 1 })}::jsonb` })
      .where(eq(actions.id, actionId));
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
    actionId = rec.actionId;
  }

  const id = newId();
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
    },
    totalBytes: resolved.totalBytes,
    missingCount: 0,
    expiresAt: new Date(Date.now() + PLAN_TTL_MS),
  });

  let planned;
  try {
    planned = await getStore().planUpload(ws.volumeId, resolved.plan);
  } catch (e) {
    await setStatus(id, 'failed');
    if (!joined) await finalize(actionId, 'failed', e instanceof Error ? e.message.slice(0, 500) : String(e));
    throw e;
  }
  const expiresAt = new Date(planned.expiresAt);
  await setStatus(id, 'planned', {
    ptUploadId: planned.uploadId,
    missingCount: planned.missing.length,
    expiresAt: Number.isFinite(expiresAt.getTime()) ? expiresAt : new Date(Date.now() + PLAN_TTL_MS),
  });

  return ok(c, UploadPlanResponse, {
    uploadId: id,
    actionId,
    missing: planned.missing,
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
  const row = await loadUpload(ws, c.get('user').id, c.req.param('id'));
  if (row.status !== 'planned' && row.status !== 'uploading') {
    throw new ApiError(409, 'conflict', `This upload is ${row.status}; no more blocks are accepted.`, { status: row.status });
  }
  if (!row.ptUploadId) throw new ApiError(409, 'conflict', 'This upload is not ready for blocks yet.');
  const bytes = await readBody(c.req.raw, BLOCK_SIZE);
  try {
    await getStore().putBlock(ws.volumeId, row.ptUploadId, sha, bytes);
  } catch (e) {
    if (isStoreError(e, 'not_found')) await expired(row);
    throw e;
  }
  const now = Date.now();
  if (row.status === 'planned' || !row.expiresAt || row.expiresAt.getTime() < now + PLAN_TTL_MS - RENEW_EVERY_MS) {
    await setStatus(row.id, 'uploading', { expiresAt: new Date(now + PLAN_TTL_MS) });
  }
  return noContent(c);
});

// ── commit ─────────────────────────────────────────────────────────────────

uploadsRoutes.post('/uploads/:id/commit', async (c) => {
  await parseJson(c, EmptyBody);
  const ws = c.get('ws');
  const row = await loadUpload(ws, c.get('user').id, c.req.param('id'));
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
  const ptUploadId = row.ptUploadId;
  const actionId = row.actionId;
  const store = getStore();

  const result = await withWorkspaceLock(ws.id, async () => {
    // Re-check under the lock: a concurrent commit of the same upload may have won.
    const [fresh] = await db.select({ status: uploads.status }).from(uploads).where(eq(uploads.id, row.id));
    if (fresh?.status === 'committed') return null;
    let r;
    try {
      r = await store.commitUpload(ws.volumeId, ptUploadId);
    } catch (e) {
      // Blocks still missing: the plan stays alive; the browser sends them and commits again (409 {missing}).
      if (isStoreError(e, 'bad_request') && e.extra.missing?.length) throw e;
      store.releaseUpload(ptUploadId);
      if (isStoreError(e, 'not_found')) await expired(row);
      await setStatus(row.id, 'failed');
      await failActionIfEmpty(actionId, e instanceof Error ? e.message.slice(0, 500) : String(e));
      throw e;
    }
    // The store frees the slot on commit; make sure ours is free too (idempotent).
    store.releaseUpload(ptUploadId);
    await setStatus(row.id, 'committed');
    await attachCommit(actionId, r);
    const summary: ActionSummary = await finalize(actionId, 'committed');
    return { summary, files: r.files || fileCount };
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
    if (row.ptUploadId) getStore().releaseUpload(row.ptUploadId);
    await setStatus(row.id, 'aborted');
    await failActionIfEmpty(row.actionId, 'aborted');
  }
  return noContent(c);
});

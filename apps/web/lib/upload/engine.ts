// The upload engine (architecture §9.4, SPEC "Upload"):
//   sources → hash 1 MiB blocks in workers → plan (≤10k files / ≤1M blocks per
//   plan, same actionId) → PUT only `missing` (6 in parallel, 3 retries) → commit.
// One drop = one job = one timeline entry. A tab runs up to two jobs at once
// (a small drop never waits behind a big one), which still leaves the server's
// 4 org-wide upload slots to other people; the server queues and the engine
// retries `rate_limited` when they are busy. The job list lives
// in the app store (the tray survives navigation); File handles and hashes stay
// here, in module memory.
import {
  MAX_PLAN_BLOCKS,
  MAX_PLAN_FILES,
  normalizePath,
  validateName,
  type ActionSummary,
  type QuotaDetails,
  type UploadCommitResponse,
  type UploadPlanRequest,
  type UploadPlanResponse,
} from '@volumes/shared';
import { isApiError } from '../api/client';
import type { UploadFileState, UploadJob } from '../store';
import { HashAbortedError } from './hash-core';
import type { Hasher } from './hasher';
import type { ConflictAnswer } from './prompts';
import type { UploadSources } from './walk';

// ── pure helpers (unit-tested) ──────────────────────────────────────────────

export interface PlannedFile {
  id: string;
  /** Absolute destination path (updated when the server renames on keep-both). */
  path: string;
  file: Blob;
  size: number;
  mtime?: number;
  blocks?: string[];
}

export interface PreparedUpload {
  files: PlannedFile[];
  /** Absolute paths of directories that hold no file (the plan creates them). */
  dirs: string[];
  invalid: { relPath: string; error: string }[];
}

function checkRel(relPath: string): { segs: string[] } | { error: string } {
  const segs = relPath.split('/').filter((s) => s !== '' && s !== '.');
  if (!segs.length) return { error: 'Empty name.' };
  for (const s of segs) {
    const err = validateName(s);
    if (err) return { error: err };
  }
  return { segs };
}

/** Resolves destination paths under `basePath`, validates names, keeps only empty leaf dirs. */
export function prepareUpload(basePath: string, sources: UploadSources, makeId: () => string): PreparedUpload {
  const invalid: PreparedUpload['invalid'] = [];
  const byPath = new Map<string, PlannedFile>();
  for (const s of sources.files) {
    const r = checkRel(s.relPath);
    if ('error' in r) {
      invalid.push({ relPath: s.relPath, error: r.error });
      continue;
    }
    let path: string;
    try {
      path = normalizePath(`${basePath}/${r.segs.join('/')}`);
    } catch (e) {
      invalid.push({ relPath: s.relPath, error: e instanceof Error ? e.message : 'Invalid path.' });
      continue;
    }
    const f = s.file as Blob & { lastModified?: number };
    byPath.set(path, { id: makeId(), path, file: s.file, size: s.file.size, mtime: f.lastModified || undefined });
  }
  const files = [...byPath.values()];

  const occupied = new Set<string>();
  const addAncestors = (p: string, includeSelf: boolean) => {
    const segs = p.split('/').filter(Boolean);
    for (let i = includeSelf ? segs.length : segs.length - 1; i >= 1; i--) occupied.add('/' + segs.slice(0, i).join('/'));
  };
  for (const f of files) addAncestors(f.path, false);
  const dirSet = new Set<string>();
  for (const d of sources.dirs) {
    const r = checkRel(d);
    if ('error' in r) {
      invalid.push({ relPath: d, error: r.error });
      continue;
    }
    try {
      dirSet.add(normalizePath(`${basePath}/${r.segs.join('/')}`));
    } catch (e) {
      invalid.push({ relPath: d, error: e instanceof Error ? e.message : 'Invalid path.' });
    }
  }
  for (const d of dirSet) addAncestors(d, false);
  const dirs = [...dirSet].filter((d) => !occupied.has(d) && !byPath.has(d)).sort();
  return { files, dirs, invalid };
}

export interface PlanBatch {
  files: PlannedFile[];
  dirs: string[];
}

/** Platinum caps a plan's JSON body at 32 MiB; stay well under it. */
export const PLAN_BODY_BUDGET = 24 * 1024 * 1024;
/**
 * Bytes per plan. Storage reserves a plan's full size against its stored-bytes
 * budget for up to 48 h if the plan is abandoned, so a cancelled upload of a
 * huge folder should not reserve all of it at once.
 */
export const PLAN_BYTES_BUDGET = 2 * 1024 ** 3;

const utf8 = (s: string) => new TextEncoder().encode(s).length;
export function estimatePlanBytes(f: { path: string; blocks?: string[] }): number {
  return utf8(f.path) + 72 + (f.blocks?.length ?? 0) * 67;
}

/** Splits hashed files (+ empty dirs) into plans within the file, block and body limits. */
export function splitIntoPlans(
  files: PlannedFile[],
  dirs: string[],
  limits: { maxFiles: number; maxBlocks: number; maxBody: number; maxBytes?: number } = {
    maxFiles: MAX_PLAN_FILES,
    maxBlocks: MAX_PLAN_BLOCKS,
    maxBody: PLAN_BODY_BUDGET,
    maxBytes: PLAN_BYTES_BUDGET,
  },
): PlanBatch[] {
  const out: PlanBatch[] = [];
  let cur: PlanBatch = { files: [], dirs: [] };
  let blocks = 0;
  let body = 0;
  let bytes = 0;
  const maxBytes = limits.maxBytes ?? Infinity;
  const flush = () => {
    if (cur.files.length || cur.dirs.length) out.push(cur);
    cur = { files: [], dirs: [] };
    blocks = 0;
    body = 0;
    bytes = 0;
  };
  for (const f of files) {
    const b = f.blocks?.length ?? 0;
    const est = estimatePlanBytes(f);
    if (
      cur.files.length &&
      (cur.files.length + 1 > limits.maxFiles || blocks + b > limits.maxBlocks || body + est > limits.maxBody || bytes + f.size > maxBytes)
    )
      flush();
    cur.files.push(f);
    blocks += b;
    body += est;
    bytes += f.size;
  }
  // Empty dirs ride in the first plan when they fit, else in their own plans.
  let rest = dirs.slice();
  if (out.length === 0) {
    // everything so far is `cur`
    const room = limits.maxFiles - cur.dirs.length;
    cur.dirs.push(...rest.slice(0, room));
    rest = rest.slice(room);
    flush();
  } else {
    flush();
    const first = out[0];
    const room = Math.max(0, limits.maxFiles - first.dirs.length);
    first.dirs.push(...rest.slice(0, room));
    rest = rest.slice(room);
  }
  while (rest.length) {
    out.push({ files: [], dirs: rest.slice(0, limits.maxFiles) });
    rest = rest.slice(limits.maxFiles);
  }
  return out;
}

export interface BlockSource {
  file: PlannedFile;
  offset: number;
  length: number;
}

/** sha → the first (file, offset) that holds those bytes. */
export function blockSources(files: PlannedFile[], blockSize = 1_048_576): Map<string, BlockSource> {
  const m = new Map<string, BlockSource>();
  for (const f of files) {
    (f.blocks ?? []).forEach((sha, i) => {
      if (m.has(sha)) return;
      const offset = i * blockSize;
      m.set(sha, { file: f, offset, length: Math.min(blockSize, f.size - offset) });
    });
  }
  return m;
}

/** Status line for a file row in the tray (DESIGN §6.12). */
export function fileStatusLabel(f: UploadFileState, fmt: (n: number) => string): string {
  switch (f.status) {
    case 'queued':
      return 'Waiting for a free slot';
    case 'hashing':
      return `Hashing ${f.size ? Math.floor((f.hashed / f.size) * 100) : 100}%`;
    case 'planning':
      return 'Checking';
    case 'uploading':
      return `${fmt(f.sent)} / ${fmt(f.size)}`;
    case 'committing':
      return 'Saving version';
    case 'done':
      return f.sent === 0 && f.size > 0 ? 'Already stored' : '✓';
    case 'conflict':
      return 'Already exists';
    case 'error':
      return f.error ?? 'Failed';
  }
}

/** 0..1 progress of one file: half hashing, half sending (deduped files jump at commit). */
export function fileProgress(f: UploadFileState): number {
  if (f.status === 'done') return 1;
  if (!f.size) return f.status === 'committing' ? 0.9 : 0;
  return Math.min(1, (f.hashed / f.size) * 0.5 + (f.sent / f.size) * 0.5);
}

// ── runtime ─────────────────────────────────────────────────────────────────

export interface EngineStore {
  addUploadJob(job: UploadJob): void;
  updateUploadJob(id: string, patch: Partial<UploadJob>): void;
  refresh(): void;
  toast(t: { kind?: 'info' | 'success' | 'error'; message: string }): string;
  /** A finished upload is undoable like any other action (⌘Z undoes it, not whatever came before). */
  registerUndo?(e: { label: string; actionId: string; workspaceId?: string }): void;
}

export interface EngineApi {
  plan(ws: string, req: UploadPlanRequest): Promise<UploadPlanResponse>;
  putBlock(ws: string, uploadId: string, sha: string, bytes: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<void>;
  commit(ws: string, uploadId: string): Promise<UploadCommitResponse>;
  abort(ws: string, uploadId: string): Promise<void>;
}

export interface EngineDeps {
  api: EngineApi;
  hasher(): Hasher;
  store(): EngineStore;
  /** The person's choice for these conflicts; `all` = use it for the rest of THIS upload. */
  askConflict(paths: string[]): Promise<ConflictAnswer | null>;
  showQuota(d: QuotaDetails, fileCount: number): void;
  usage(): Promise<{ usedBytes: number; quotaBytes: number } | null>;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  putConcurrency?: number;
  retries?: number;
  backoffMs?(attempt: number): number;
  flushMs?: number;
  /** Max wait for a free server upload slot before the job fails (ms). */
  slotWaitMs?: number;
  /** Jobs this tab runs at once. */
  maxActiveJobs?: number;
}

export interface StartOptions {
  workspaceId: string;
  basePath: string;
  sources: UploadSources;
}

export interface JobInfo {
  dirCount: number;
  totalBytes: number;
  action: ActionSummary | null;
}

class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}
class HandledError extends Error {}

interface Runtime {
  job: UploadJob;
  files: UploadFileState[];
  index: Map<string, number>;
  entries: PlannedFile[];
  dirs: string[];
  dirsDone: boolean;
  controller: AbortController;
  actionId?: string;
  uploadId?: string;
  conflictMode?: ConflictAnswer['choice'];
  action: ActionSummary | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** The engine was reset (sign-out): the job no longer belongs to anyone in this tab. */
  detached?: boolean;
}

const retryable = (e: unknown) =>
  isApiError(e) && (e.status === 0 || e.status === 429 || e.status === 502 || e.status === 503 || e.status === 504 || e.code === 'rate_limited' || e.code === 'upstream_unavailable');

const isAbort = (e: unknown) => e instanceof CancelledError || e instanceof HashAbortedError || (e as Error)?.name === 'AbortError';

export function createUploadEngine(deps: EngineDeps) {
  const PUT_CONCURRENCY = deps.putConcurrency ?? 6;
  const RETRIES = deps.retries ?? 3;
  const backoff = deps.backoffMs ?? ((a: number) => 400 * 3 ** a);
  const FLUSH_MS = deps.flushMs ?? 120;
  const SLOT_WAIT_MS = deps.slotWaitMs ?? 10 * 60_000;
  const MAX_ACTIVE = deps.maxActiveJobs ?? 2;
  const runtimes = new Map<string, Runtime>();
  const queue: Runtime[] = [];
  const active = new Set<Runtime>();
  let seq = 0;
  const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

  const flush = (rt: Runtime) => {
    if (rt.flushTimer) {
      clearTimeout(rt.flushTimer);
      rt.flushTimer = null;
    }
    deps.store().updateUploadJob(rt.job.id, { files: rt.files.slice() });
  };
  const touch = (rt: Runtime) => {
    if (rt.flushTimer) return;
    rt.flushTimer = setTimeout(() => {
      rt.flushTimer = null;
      flush(rt);
    }, FLUSH_MS);
  };
  const patchFile = (rt: Runtime, id: string, patch: Partial<UploadFileState>, now = false) => {
    const i = rt.index.get(id);
    if (i === undefined) return;
    rt.files[i] = { ...rt.files[i], ...patch };
    if (now) flush(rt);
    else touch(rt);
  };
  const setStatus = (rt: Runtime, ids: Iterable<string>, status: UploadFileState['status'], extra: Partial<UploadFileState> = {}) => {
    for (const id of ids) {
      const i = rt.index.get(id);
      if (i === undefined || rt.files[i].status === 'done') continue;
      rt.files[i] = { ...rt.files[i], status, ...extra };
    }
    flush(rt);
  };
  const setJob = (rt: Runtime, patch: Partial<UploadJob>) => {
    rt.job = { ...rt.job, ...patch };
    deps.store().updateUploadJob(rt.job.id, patch);
  };

  const waitRetry = async (rt: Runtime, e: unknown, attempt: number) => {
    const ra = isApiError(e) && e.retryAfterSeconds ? e.retryAfterSeconds * 1000 : 0;
    await deps.sleep(Math.max(ra, isApiError(e) && e.status === 429 ? 1000 : backoff(Math.min(attempt, 4))), rt.controller.signal);
    if (rt.controller.signal.aborted) throw new CancelledError();
  };

  async function hashAll(rt: Runtime) {
    const hasher = deps.hasher();
    const todo = rt.entries.filter((f) => !f.blocks);
    await Promise.all(
      todo.map(async (f) => {
        if (f.size === 0) {
          f.blocks = [];
          patchFile(rt, f.id, { status: 'planning', hashed: 0 });
          return;
        }
        patchFile(rt, f.id, { status: 'hashing', hashed: 0 });
        f.blocks = await hasher.hash(
          f.file,
          (hashed) => patchFile(rt, f.id, { status: 'hashing', hashed }),
          rt.controller.signal,
        );
        patchFile(rt, f.id, { status: 'planning', hashed: f.size });
      }),
    );
    flush(rt);
  }

  async function putBlocks(rt: Runtime, batch: PlanBatch, missing: string[], uploadId: string) {
    const ws = rt.job.workspaceId;
    const sources = blockSources(batch.files);
    const tasks = [...new Set(missing)].map((sha) => ({ sha, src: sources.get(sha) })).filter((t): t is { sha: string; src: BlockSource } => !!t.src);
    const needing = new Set(tasks.map((t) => t.src.file.id));
    setStatus(rt, batch.files.filter((f) => needing.has(f.id)).map((f) => f.id), 'uploading');
    setStatus(rt, batch.files.filter((f) => !needing.has(f.id)).map((f) => f.id), 'committing');
    let next = 0;
    const worker = async () => {
      while (next < tasks.length) {
        if (rt.controller.signal.aborted) throw new CancelledError();
        const { sha, src } = tasks[next++];
        // Read the slice into memory: some runtimes stream a sliced Blob's whole parent buffer.
        const bytes = new Uint8Array(await src.file.file.slice(src.offset, src.offset + src.length).arrayBuffer());
        for (let attempt = 0; ; attempt++) {
          try {
            await deps.api.putBlock(ws, uploadId, sha, bytes, rt.controller.signal);
            break;
          } catch (e) {
            if (isAbort(e) || rt.controller.signal.aborted) throw new CancelledError();
            const rate = isApiError(e) && e.status === 429;
            if ((retryable(e) && attempt < RETRIES) || (rate && attempt < RETRIES + 20)) {
              await waitRetry(rt, e, attempt);
              continue;
            }
            if (isApiError(e) && e.status === 400) {
              throw Object.assign(new Error(`${basename(src.file.path)} changed while uploading. Try again.`), { cause: e });
            }
            throw e;
          }
        }
        const i = rt.index.get(src.file.id)!;
        const cur = rt.files[i];
        patchFile(rt, src.file.id, { sent: Math.min(cur.size, cur.sent + src.length) });
      }
    };
    await Promise.all(Array.from({ length: Math.min(PUT_CONCURRENCY, Math.max(1, tasks.length)) }, worker));
    setStatus(rt, batch.files.map((f) => f.id), 'committing');
  }

  /** Asks about conflicts; the answer applies to this plan, and to the rest of the job when `all`. */
  async function resolveConflicts(rt: Runtime, batch: PlanBatch, conflicts: string[]): Promise<ConflictAnswer['choice']> {
    const set = new Set(conflicts);
    setStatus(rt, batch.files.filter((f) => set.has(f.path)).map((f) => f.id), 'conflict');
    if (rt.controller.signal.aborted) throw new CancelledError();
    const answer = await deps.askConflict(conflicts);
    if (rt.controller.signal.aborted) throw new CancelledError();
    if (!answer) throw new CancelledError();
    if (answer.all) rt.conflictMode = answer.choice;
    return answer.choice;
  }

  async function runBatch(rt: Runtime, batch: PlanBatch) {
    const ws = rt.job.workspaceId;
    const ids = batch.files.map((f) => f.id);
    let mode: UploadPlanRequest['conflict'] = rt.conflictMode ?? 'ask';
    // A conflict can surface at plan time or, when something was created meanwhile, at commit time.
    for (;;) {
      let plan: UploadPlanResponse | null = null;
      const started = Date.now();
      for (let attempt = 0; !plan; attempt++) {
        if (rt.controller.signal.aborted) throw new CancelledError();
        setStatus(rt, ids, 'planning');
        try {
          plan = await deps.api.plan(ws, {
            files: batch.files.map((f) => ({ path: f.path, size: f.size, blocks: f.blocks ?? [], ...(f.mtime ? { mtime: f.mtime } : {}) })),
            dirs: batch.dirs,
            conflict: mode,
            ...(rt.actionId ? { actionId: rt.actionId } : {}),
          });
        } catch (e) {
          if (isApiError(e) && e.status === 409 && e.code === 'conflict' && Array.isArray(e.details.conflicts)) {
            mode = await resolveConflicts(rt, batch, (e.details.conflicts as unknown[]).map(String));
            continue;
          }
          if (isApiError(e) && e.status === 413 && e.code === 'quota_exceeded') {
            const d = e.details as Partial<QuotaDetails> & { limit?: string };
            // The person's own quota carries the numbers for the dialog; a storage-side
            // limit (a workspace's size cap, a full history) has only its message.
            if (rt.controller.signal.aborted) throw new CancelledError();
            if (typeof d.usedBytes === 'number' && typeof d.quotaBytes === 'number') {
              deps.showQuota(
                {
                  usedBytes: Number(d.usedBytes),
                  quotaBytes: Number(d.quotaBytes),
                  requestedBytes: Number(d.requestedBytes ?? 0),
                  overBytes: Number(d.overBytes ?? 0),
                },
                rt.entries.length,
              );
              throw new HandledError('Over your storage quota. Nothing was sent.');
            }
            throw new Error(e.message || 'Storage refused this upload.');
          }
          if (retryable(e) && Date.now() - started < SLOT_WAIT_MS) {
            setStatus(rt, ids, 'queued');
            await waitRetry(rt, e, attempt);
            continue;
          }
          throw e;
        }
      }
      rt.actionId = plan.actionId;
      rt.uploadId = plan.uploadId;
      setJob(rt, { actionId: plan.actionId });
      if (plan.renamed.length) {
        const map = new Map(plan.renamed.map((r) => [r.from, r.to]));
        for (const f of batch.files) {
          const to = map.get(f.path);
          if (to) {
            f.path = to;
            patchFile(rt, f.id, { path: to });
          }
        }
      }
      await putBlocks(rt, batch, plan.missing, plan.uploadId);
      let conflictAtCommit: string[] | null = null;
      for (let round = 0; ; round++) {
        if (rt.controller.signal.aborted) throw new CancelledError();
        try {
          const r = await deps.api.commit(ws, plan.uploadId);
          rt.action = r.action;
          break;
        } catch (e) {
          if (isApiError(e) && e.status === 409 && Array.isArray(e.details.missing) && round < 3) {
            await putBlocks(rt, batch, (e.details.missing as unknown[]).map(String), plan.uploadId);
            continue;
          }
          if (isApiError(e) && e.status === 409 && e.code === 'conflict' && Array.isArray(e.details.conflicts)) {
            conflictAtCommit = (e.details.conflicts as unknown[]).map(String);
            break;
          }
          if (retryable(e) && round < 12) {
            await waitRetry(rt, e, round);
            continue;
          }
          throw e;
        }
      }
      if (conflictAtCommit) {
        // Something took one of these names since the plan: drop this plan, ask, plan again.
        const stale = plan.uploadId;
        rt.uploadId = undefined;
        await deps.api.abort(ws, stale).catch(() => {});
        mode = await resolveConflicts(rt, batch, conflictAtCommit);
        continue;
      }
      rt.uploadId = undefined;
      setStatus(rt, ids, 'done');
      rt.dirsDone = rt.dirsDone || batch.dirs.length > 0;
      return;
    }
  }

  async function run(rt: Runtime) {
    const store = deps.store();
    setJob(rt, { status: 'active' });
    try {
      // No client-side quota refusal: only the server knows what a plan replaces
      // (a replace of a 3 GiB file needs ~0 more bytes), and it answers 413 with
      // the exact amount before any byte is sent.
      await hashAll(rt);
      const todo = rt.entries.filter((f) => rt.files[rt.index.get(f.id)!].status !== 'done');
      const batches = splitIntoPlans(todo, rt.dirsDone ? [] : rt.dirs);
      for (const b of batches) await runBatch(rt, b);
      // Signed out while the last commit was in flight: nothing more is said to anyone.
      if (rt.detached) throw new CancelledError();
      flush(rt);
      setJob(rt, { status: 'done' });
      if (rt.action?.undoable && rt.action.status === 'committed') {
        store.registerUndo?.({ label: rt.action.summary || 'Uploaded', actionId: rt.action.id, workspaceId: rt.job.workspaceId });
      }
      store.refresh();
    } catch (e) {
      const cancelled = isAbort(e) || rt.controller.signal.aborted;
      if (rt.uploadId) {
        const id = rt.uploadId;
        rt.uploadId = undefined;
        void deps.api.abort(rt.job.workspaceId, id).catch(() => {});
      }
      const message = cancelled ? 'Cancelled' : e instanceof Error ? e.message : 'Upload failed.';
      setStatus(
        rt,
        rt.files.filter((f) => f.status !== 'done').map((f) => f.id),
        'error',
        { error: message },
      );
      setJob(rt, { status: cancelled ? 'cancelled' : 'error' });
      if (rt.detached) return;
      if (!cancelled && !(e instanceof HandledError)) store.toast({ kind: 'error', message: `Upload failed: ${message}` });
      if (rt.files.some((f) => f.status === 'done')) store.refresh();
    } finally {
      if (rt.flushTimer) clearTimeout(rt.flushTimer);
      rt.flushTimer = null;
    }
  }

  const pump = () => {
    while (active.size < MAX_ACTIVE && queue.length) {
      const next = queue.shift()!;
      active.add(next);
      void run(next).finally(() => {
        active.delete(next);
        pump();
      });
    }
  };

  const enqueue = (rt: Runtime) => {
    queue.push(rt);
    pump();
  };

  return {
    /** Starts (queues) an upload; returns the job id, or null when there is nothing to send. */
    start(opts: StartOptions): string | null {
      const prep = prepareUpload(opts.basePath, opts.sources, () => uid('uf_'));
      const store = deps.store();
      if (prep.invalid.length) {
        const first = prep.invalid[0];
        store.toast({
          kind: 'error',
          message:
            prep.invalid.length === 1
              ? `Skipped "${first.relPath}": ${first.error}`
              : `Skipped ${prep.invalid.length} items with names that can't be stored (${first.error})`,
        });
      }
      if (!prep.files.length && !prep.dirs.length) return null;
      const job: UploadJob = {
        id: uid('uj_'),
        workspaceId: opts.workspaceId,
        basePath: opts.basePath,
        files: prep.files.map((f) => ({ id: f.id, path: f.path, size: f.size, hashed: 0, sent: 0, status: 'queued' })),
        status: 'active',
        createdAt: Date.now(),
      };
      const rt: Runtime = {
        job,
        files: job.files.slice(),
        index: new Map(job.files.map((f, i) => [f.id, i])),
        entries: prep.files,
        dirs: prep.dirs,
        dirsDone: false,
        controller: new AbortController(),
        action: null,
        flushTimer: null,
      };
      runtimes.set(job.id, rt);
      store.addUploadJob(job);
      enqueue(rt);
      return job.id;
    },

    cancel(jobId: string): void {
      const rt = runtimes.get(jobId);
      if (!rt) return;
      const qi = queue.indexOf(rt);
      if (qi >= 0) {
        queue.splice(qi, 1);
        setStatus(rt, rt.files.filter((f) => f.status !== 'done').map((f) => f.id), 'error', { error: 'Cancelled' });
        setJob(rt, { status: 'cancelled' });
        return;
      }
      rt.controller.abort();
    },

    cancelAll(): void {
      for (const rt of [...queue]) this.cancel(rt.job.id);
      for (const rt of [...active]) this.cancel(rt.job.id);
    },

    /**
     * Sign-out: cancels every job (queued and running) and forgets them all. A job whose
     * commit lands afterwards registers no undo, shows no toast and refreshes nothing.
     */
    reset(): void {
      for (const rt of runtimes.values()) rt.detached = true;
      for (const rt of [...queue, ...active]) rt.detached = true;
      this.cancelAll();
      runtimes.clear();
    },

    /** Re-runs a failed or cancelled job (hashes are kept; committed plans are skipped). */
    retry(jobId: string): void {
      const rt = runtimes.get(jobId);
      if (!rt || active.has(rt) || queue.includes(rt)) return;
      if (rt.job.status !== 'error' && rt.job.status !== 'cancelled') return;
      rt.controller = new AbortController();
      rt.conflictMode = undefined;
      for (let i = 0; i < rt.files.length; i++) {
        const f = rt.files[i];
        if (f.status !== 'done') rt.files[i] = { ...f, status: 'queued', error: undefined, sent: 0 };
      }
      flush(rt);
      setJob(rt, { status: 'active' });
      enqueue(rt);
    },

    /** Forgets finished jobs (the tray's close button). */
    forget(jobId: string): void {
      const rt = runtimes.get(jobId);
      if (rt && (active.has(rt) || queue.includes(rt))) return;
      runtimes.delete(jobId);
    },

    info(jobId: string): JobInfo | null {
      const rt = runtimes.get(jobId);
      if (!rt) return null;
      return { dirCount: rt.dirs.length, totalBytes: rt.entries.reduce((n, f) => n + f.size, 0), action: rt.action };
    },

    isBusy(): boolean {
      return active.size > 0 || queue.length > 0;
    },
  };
}

export type UploadEngine = ReturnType<typeof createUploadEngine>;

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

/** Abortable sleep. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

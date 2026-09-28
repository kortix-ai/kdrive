// Platinum driver: the real storage. Volume lifecycle goes through the SDK's
// `volumes` API; everything that needs raw wire access (paged listings with
// cursors, reads with Range/ETag, the browser-driven block upload protocol)
// goes through the SDK's public low-level `request`, which adds the bearer
// token and converts non-2xx answers into typed errors.
// The token is never logged and never leaves this process.

import { Platinum, PlatinumError, RateLimitError, Volume, type VolumeCommit, type VolumeData } from '@platinum-dev/sdk';
import { TAG_BUDGET, MAX_UPLOADS_IN_FLIGHT } from '@volumes/shared';
import {
  type Commit,
  type CommitKind,
  type CommitResult,
  type FileEntry,
  type FileStat,
  type ListPage,
  type PathReason,
  type PlannedUpload,
  type ReadOptions,
  type ReadResult,
  type Ref,
  type StoreErrorCode,
  type StoreErrorExtra,
  type StoreLimits,
  type Tag,
  type UploadPlan,
  type VolumeInfo,
  type VolumeStore,
  VolumeStoreError,
} from './types';
import { UploadSlots, uploadSlots as sharedSlots } from './upload-slots';

const KNOWN_CODES = new Set<StoreErrorCode>([
  'bad_request',
  'unauthorized',
  'insufficient_scope',
  'quota_exceeded',
  'volume_not_found',
  'not_found',
  'path_not_found',
  'volume_exists',
  'volume_busy',
  'path_exists',
  'not_a_file',
  'not_a_directory',
  'directory_not_empty',
  'conflict',
  'payload_too_large',
  'rate_limited',
  'commit_failed',
  'unavailable',
  'internal',
]);

const STATUS_CODE: Record<number, StoreErrorCode> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'insufficient_scope',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  416: 'range_not_satisfiable',
  429: 'rate_limited',
  503: 'unavailable',
};

/** Converts any SDK / transport error into a VolumeStoreError (never leaks the token). */
export function toStoreError(e: unknown): VolumeStoreError {
  if (e instanceof VolumeStoreError) return e;
  if (e instanceof PlatinumError) {
    const body = (e.body && typeof e.body === 'object' ? e.body : {}) as Record<string, unknown>;
    const status = e.status || 0;
    let code: StoreErrorCode;
    if (status === 416) code = 'range_not_satisfiable';
    else if (status === 0) code = 'unavailable';
    else if (e.code && KNOWN_CODES.has(e.code as StoreErrorCode)) code = e.code as StoreErrorCode;
    else code = STATUS_CODE[status] ?? (status >= 500 ? 'unavailable' : 'internal');
    const retryAfter =
      (e instanceof RateLimitError ? e.retryAfterSeconds : undefined) ??
      num(body.retryAfterSeconds) ??
      num(body.retry_after);
    const extra: StoreErrorExtra = {};
    if (typeof body.path === 'string') extra.path = body.path;
    if (Array.isArray(body.paths)) extra.paths = body.paths.filter((p): p is string => typeof p === 'string');
    if (Array.isArray(body.missing)) extra.missing = body.missing.filter((p): p is string => typeof p === 'string');
    if (typeof body.limit === 'string') extra.limit = body.limit as StoreErrorExtra['limit'];
    if (num(body.max) !== undefined) extra.max = num(body.max);
    if (num(body.max_bytes) !== undefined) extra.max = num(body.max_bytes);
    if (num(body.bytes) !== undefined) extra.bytes = num(body.bytes);
    if (retryAfter !== undefined) extra.retryAfterSeconds = retryAfter;
    if (typeof body.retryable === 'boolean') extra.retryable = body.retryable;
    if (typeof body.reason === 'string') extra.reason = body.reason;
    if (code === 'unavailable' || code === 'commit_failed') extra.retryable = true;
    const message = typeof body.error === 'string' ? body.error : e.message || code;
    return new VolumeStoreError(status || 503, code, message, extra);
  }
  const message = e instanceof Error ? e.message : String(e);
  return new VolumeStoreError(503, 'unavailable', `storage unreachable: ${message}`, { retryable: true });
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The org-wide upload slots are full: waiting here (holding a local slot) would not free one. */
const isOrgUploadsFull = (e: VolumeStoreError) => e.code === 'rate_limited' && e.extra.reason === 'org_uploads';

// ── wire shapes (snake_case) ────────────────────────────────────────────────

interface WireEntry {
  path: string;
  type: FileEntry['type'];
  size: number;
  mtime: number;
}
interface WireStat extends WireEntry {
  mode: number;
  uid: number;
  gid: number;
  symlink_target: string | null;
  version: string | null;
  commit_id: string;
}
interface WireCommitResult {
  commit_id: string;
  outcome: CommitResult['outcome'];
  head_commit_id: string;
  overwritten?: PathReason[];
  skipped?: PathReason[];
}

const nameOf = (p: string) => (p === '/' ? '' : p.slice(p.lastIndexOf('/') + 1));

function toEntry(e: WireEntry): FileEntry {
  return { path: e.path, name: nameOf(e.path), type: e.type, size: e.size ?? 0, mtime: e.mtime ?? 0 };
}

function toInfo(d: VolumeData): VolumeInfo {
  return {
    id: d.id,
    name: d.name,
    headCommitId: d.head_commit_id,
    sizeLimitBytes: d.size_limit_bytes,
    logicalBytes: d.logical_bytes,
    fileCount: d.file_count,
    forkedFrom: d.forked_from ? { volumeId: d.forked_from.volume_id, commitId: d.forked_from.commit_id } : null,
    createdAt: d.created_at,
    lastCommitAt: d.last_commit_at,
  };
}

function toCommit(c: VolumeCommit): Commit {
  return {
    id: c.id,
    seq: c.seq,
    onHead: c.on_head,
    kind: c.kind as CommitKind,
    parentId: c.parent_id,
    baseId: c.base_id,
    createdAt: c.created_at,
    logicalBytes: c.logical_bytes,
    fileCount: c.file_count,
    tags: c.tags ?? [],
    stats: {
      changedPaths: c.stats?.changed_paths ?? 0,
      deletedPaths: c.stats?.deleted_paths ?? 0,
      uploadedBlocks: c.stats?.uploaded_blocks ?? 0,
      uploadedBytes: c.stats?.uploaded_bytes ?? 0,
    },
  };
}

function toResult(r: WireCommitResult): CommitResult {
  return {
    commitId: r.commit_id,
    outcome: r.outcome,
    headCommitId: r.head_commit_id,
    overwritten: r.overwritten ?? [],
    skipped: r.skipped ?? [],
  };
}

export interface PlatinumStoreOptions {
  url: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  slots?: UploadSlots;
  slotWaitMs?: number;
  /** Total time planUpload keeps retrying rate_limited / unavailable. */
  planRetryMs?: number;
  /** Total time a mutation keeps retrying the org write ceiling (429 rate_limited). */
  writeRetryMs?: number;
  /** How long an upload commit answered `queued` is polled for its merge. */
  mergeWaitMs?: number;
}

export class PlatinumStore implements VolumeStore {
  readonly driver = 'platinum' as const;
  private readonly pt: Platinum;
  private readonly slots: UploadSlots;
  private readonly slotWaitMs: number;
  private readonly planRetryMs: number;
  private readonly writeRetryMs: number;
  private readonly mergeWaitMs: number;

  constructor(opts: PlatinumStoreOptions) {
    this.pt = new Platinum({ url: opts.url, token: opts.token, timeoutMs: opts.timeoutMs ?? 60_000, fetch: opts.fetch });
    this.slots = opts.slots ?? sharedSlots;
    this.slotWaitMs = opts.slotWaitMs ?? 30_000;
    this.planRetryMs = opts.planRetryMs ?? 60_000;
    this.writeRetryMs = opts.writeRetryMs ?? 20_000;
    this.mergeWaitMs = opts.mergeWaitMs ?? 60_000;
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw toStoreError(e);
    }
  }

  /**
   * A mutation (POST/PUT/PATCH/DELETE). Every one shares the org-wide write
   * ceiling (20/s, burst 60, all users of the deployment), which Platinum
   * enforces before the route runs, so a 429 is safe to retry: wait
   * Retry-After (with jitter), up to writeRetryMs in total.
   */
  private async mutate<T>(fn: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + this.writeRetryMs;
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        const se = toStoreError(e);
        if (se.code !== 'rate_limited' || isOrgUploadsFull(se) || Date.now() >= deadline) throw se;
        const base = (se.extra.retryAfterSeconds ?? 2 ** Math.min(attempt, 3)) * 1000;
        await sleep(Math.min(base + Math.random() * 250, Math.max(0, deadline - Date.now())));
      }
    }
  }

  private v(id: string) {
    return `/v1/volumes/${encodeURIComponent(id)}`;
  }

  // ── volumes ───────────────────────────────────────────────────────────────

  async openVolume(name: string): Promise<VolumeInfo> {
    // PUT /v1/volumes/:name answers 503 unavailable while storage initialises: retry briefly.
    for (let attempt = 0; ; attempt++) {
      try {
        const vol = await this.pt.volumes.open(name);
        return toInfo(vol.data as VolumeData);
      } catch (e) {
        const se = toStoreError(e);
        if ((se.code === 'unavailable' || (se.code === 'rate_limited' && !isOrgUploadsFull(se))) && attempt < 4) {
          await sleep((se.extra.retryAfterSeconds ?? 1) * 1000);
          continue;
        }
        throw se;
      }
    }
  }

  async createVolume(name: string): Promise<VolumeInfo> {
    return this.mutate(async () => toInfo((await this.pt.volumes.create(name)).data as VolumeData));
  }

  async getVolume(id: string): Promise<VolumeInfo> {
    return this.call(async () => toInfo((await this.pt.volumes.get(id)).data as VolumeData));
  }

  async deleteVolume(id: string, opts: { missingOk?: boolean } = {}): Promise<void> {
    await this.mutate(() => this.pt.volumes.delete(id, { missingOk: opts.missingOk }));
  }

  async forkVolume(id: string, newName: string, at?: Ref): Promise<VolumeInfo> {
    return this.mutate(async () => {
      const d = await this.pt.request<VolumeData>('POST', `${this.v(id)}/fork`, at ? { name: newName, at } : { name: newName });
      return toInfo(d);
    });
  }

  async restoreVolume(id: string, to: Ref): Promise<Commit> {
    return this.mutate(async () => toCommit(await this.pt.request<VolumeCommit>('POST', `${this.v(id)}/restore`, { to })));
  }

  async limits(): Promise<StoreLimits> {
    return this.call(async () => {
      const l = await this.pt.volumes.limits();
      return {
        maxVolumes: l.max_volumes,
        usedVolumes: l.used_volumes,
        maxBytesPerVolume: l.max_bytes_per_volume,
        maxTagsPerVolume: TAG_BUDGET,
        maxUploadsInFlight: MAX_UPLOADS_IN_FLIGHT,
      };
    });
  }

  // ── reads ─────────────────────────────────────────────────────────────────

  async list(
    id: string,
    path: string,
    opts: { at?: Ref; recursive?: boolean; limit?: number; cursor?: string } = {},
  ): Promise<ListPage> {
    return this.call(async () => {
      const r = await this.pt.request<{ entries: WireEntry[]; next_cursor: string | null; commit_id: string }>(
        'GET',
        `${this.v(id)}/files`,
        undefined,
        {
          query: {
            path,
            recursive: opts.recursive ? 'true' : undefined,
            limit: opts.limit,
            cursor: opts.cursor,
            at: opts.at,
          },
        },
      );
      return { entries: r.entries.map(toEntry), nextCursor: r.next_cursor, commitId: r.commit_id };
    });
  }

  async stat(id: string, path: string, opts: { at?: Ref } = {}): Promise<FileStat> {
    return this.call(async () => {
      const s = await this.pt.request<WireStat>('GET', `${this.v(id)}/files/stat`, undefined, { query: { path, at: opts.at } });
      return {
        ...toEntry(s),
        mode: s.mode,
        version: s.version || null,
        commitId: s.commit_id,
        symlinkTarget: s.symlink_target ?? null,
      };
    });
  }

  async read(id: string, path: string, opts: ReadOptions = {}): Promise<ReadResult> {
    return this.call(async () => {
      const res = await this.pt.request<Response>('GET', `${this.v(id)}/files/content`, undefined, {
        query: { path, at: opts.at },
        headers: opts.range ? { range: opts.range } : {},
        rawResponse: true,
        signal: opts.signal,
        timeoutMs: 10 * 60_000,
      });
      const len = Number(res.headers.get('content-length') ?? '0');
      return {
        status: res.status === 206 ? 206 : 200,
        body: res.body ?? new ReadableStream({ start: (c) => c.close() }),
        contentLength: Number.isFinite(len) ? len : 0,
        contentRange: res.headers.get('content-range'),
        etag: res.headers.get('etag'),
        commitId: res.headers.get('x-pt-commit') ?? '',
      };
    });
  }

  // ── mutations ─────────────────────────────────────────────────────────────

  async write(
    id: string,
    path: string,
    data: Uint8Array,
    opts: { overwrite?: boolean; mode?: number } = {},
  ): Promise<CommitResult & { version: string | null }> {
    return this.mutate(async () => {
      const r = await this.pt.request<WireCommitResult & { version?: string | null }>('PUT', `${this.v(id)}/files/content`, undefined, {
        query: {
          path,
          overwrite: opts.overwrite === undefined ? undefined : String(opts.overwrite),
          mode: opts.mode === undefined ? undefined : opts.mode.toString(8).padStart(4, '0'),
        },
        rawBody: data,
        headers: { 'content-type': 'application/octet-stream' },
      });
      return { ...toResult(r), version: r.version ?? null };
    });
  }

  async copy(id: string, src: string, dst: string, opts: { recursive?: boolean; overwrite?: boolean } = {}): Promise<CommitResult> {
    return this.mutate(async () =>
      toResult(
        await this.pt.request<WireCommitResult>('POST', `${this.v(id)}/files/copy`, {
          src,
          dst,
          recursive: !!opts.recursive,
          overwrite: !!opts.overwrite,
        }),
      ),
    );
  }

  async move(id: string, src: string, dst: string, opts: { overwrite?: boolean } = {}): Promise<CommitResult> {
    return this.mutate(async () =>
      toResult(await this.pt.request<WireCommitResult>('POST', `${this.v(id)}/files/move`, { src, dst, overwrite: !!opts.overwrite })),
    );
  }

  async remove(id: string, path: string, opts: { recursive?: boolean } = {}): Promise<CommitResult> {
    return this.mutate(async () =>
      toResult(
        await this.pt.request<WireCommitResult>('DELETE', `${this.v(id)}/files`, undefined, {
          query: { path, recursive: opts.recursive ? 'true' : undefined },
        }),
      ),
    );
  }

  // ── block upload protocol ─────────────────────────────────────────────────

  async planUpload(id: string, plan: UploadPlan, opts: { waitMs?: number } = {}): Promise<PlannedUpload> {
    const tempId = `pending_${crypto.randomUUID()}`;
    await this.slots.acquire(tempId, { waitMs: opts.waitMs ?? this.slotWaitMs });
    const deadline = Date.now() + this.planRetryMs;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await this.pt.request<{ upload_id: string; missing: string[]; expires_at: string }>(
            'POST',
            `${this.v(id)}/files/upload`,
            {
              overwrite: plan.overwrite,
              files: plan.files.map((f) => ({
                path: f.path,
                size: f.size,
                blocks: f.blocks,
                ...(f.mode !== undefined ? { mode: f.mode } : {}),
                ...(f.mtime !== undefined ? { mtime: f.mtime } : {}),
              })),
              dirs: plan.dirs,
            },
            { timeoutMs: 180_000 },
          );
          this.slots.rename(tempId, r.upload_id);
          return { uploadId: r.upload_id, missing: r.missing ?? [], expiresAt: r.expires_at };
        } catch (e) {
          const se = toStoreError(e);
          const retryable = (se.code === 'rate_limited' && !isOrgUploadsFull(se)) || se.code === 'unavailable';
          // org_uploads: Platinum holds plans we no longer count (e.g. from before a restart);
          // fail fast with its Retry-After instead of sleeping while holding a local slot.
          if (!retryable || Date.now() >= deadline) throw se;
          const wait = Math.min((se.extra.retryAfterSeconds ?? 2 ** Math.min(attempt, 4)) * 1000, Math.max(0, deadline - Date.now()));
          await sleep(wait);
        }
      }
    } catch (e) {
      this.slots.release(tempId);
      throw e;
    }
  }

  async putBlock(id: string, uploadId: string, sha: string, bytes: Uint8Array): Promise<void> {
    await this.call(() =>
      this.pt.request('PUT', `${this.v(id)}/files/upload/${encodeURIComponent(uploadId)}/blocks/${sha}`, undefined, {
        rawBody: bytes,
        headers: { 'content-type': 'application/octet-stream' },
      }),
    );
    this.slots.touch(uploadId);
  }

  async commitUpload(id: string, uploadId: string): Promise<CommitResult & { files: number }> {
    const deadline = Date.now() + 30_000;
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await this.pt.request<WireCommitResult & { files: number }>(
          'POST',
          `${this.v(id)}/files/upload/${encodeURIComponent(uploadId)}/commit`,
          {},
          { timeoutMs: 600_000 },
        );
        // The commit consumed the plan: its org slot is free again.
        this.slots.release(uploadId);
        const out = { ...toResult(r), files: r.files ?? 0 };
        return out.outcome === 'queued' ? { ...(await this.awaitMerge(id, out)), files: out.files } : out;
      } catch (e) {
        const se = toStoreError(e);
        // commit_failed is always retryable; the write ceiling refuses before the route runs.
        const retry =
          (se.code === 'commit_failed' && attempt < 3) || (se.code === 'rate_limited' && !isOrgUploadsFull(se) && Date.now() < deadline);
        if (retry) {
          await sleep((se.extra.retryAfterSeconds ?? 0) * 1000 || 500 * 2 ** Math.min(attempt, 4));
          continue;
        }
        // The plan is gone only when Platinum says so; otherwise it still holds its org
        // slot (no abort exists), so the local slot stays taken until it expires.
        if (se.code === 'not_found') this.slots.release(uploadId);
        throw se;
      }
    }
  }

  /**
   * `queued`: the merge had not finished after 30 s and head_commit_id is
   * still the OLD head. Poll the volume until the head moves (the merge that
   * holds our side commit); if it does not in time, stay `queued` and let the
   * ledger's reconciliation attach it later.
   */
  private async awaitMerge(id: string, r: CommitResult): Promise<CommitResult> {
    const deadline = Date.now() + this.mergeWaitMs;
    while (Date.now() < deadline) {
      await sleep(2000);
      try {
        const head = (await this.getVolume(id)).headCommitId;
        if (head && head !== r.headCommitId) return { ...r, outcome: 'merged', headCommitId: head };
      } catch {
        /* keep polling */
      }
    }
    return r;
  }

  releaseUpload(_uploadId: string): void {
    // Platinum has no abort endpoint: an uncommitted plan keeps its org slot
    // until it expires (15 min after its last use). Keep the local slot too,
    // so we never plan into a slot Platinum still counts; UploadSlots frees it
    // on the same idle timeout.
  }

  // ── history & tags ────────────────────────────────────────────────────────

  private handle(id: string): Volume {
    // A handle without an extra GET; only `id` is read by the methods we use.
    return new Volume(this.pt, { id, name: id } as VolumeData);
  }

  async history(id: string, opts: { limit?: number; before?: string } = {}): Promise<{ commits: Commit[]; nextCursor: string | null }> {
    return this.call(async () => {
      const r = await this.pt.request<{ commits: VolumeCommit[]; next_cursor: string | null }>('GET', `${this.v(id)}/commits`, undefined, {
        query: { limit: opts.limit, before: opts.before },
      });
      return { commits: r.commits.map(toCommit), nextCursor: r.next_cursor };
    });
  }

  async getCommit(id: string, ref: Ref): Promise<Commit & { overwritten: PathReason[]; skipped: PathReason[] }> {
    return this.call(async () => {
      const c = await this.pt.request<VolumeCommit & { overwritten?: PathReason[]; skipped?: PathReason[] }>(
        'GET',
        `${this.v(id)}/commits/${encodeURIComponent(ref)}`,
      );
      return { ...toCommit(c), overwritten: c.overwritten ?? [], skipped: c.skipped ?? [] };
    });
  }

  async listTags(id: string): Promise<Tag[]> {
    return this.call(async () => {
      const tags = await this.handle(id).tags();
      return tags.map((t) => ({ name: t.name, commitId: t.commit_id, createdAt: t.created_at }));
    });
  }

  async putTag(id: string, name: string, commit?: Ref): Promise<Tag> {
    return this.mutate(async () => {
      const t = await this.handle(id).tag(name, commit);
      return { name: t.name, commitId: t.commit_id, createdAt: t.created_at };
    });
  }

  async deleteTag(id: string, name: string): Promise<void> {
    await this.mutate(() => this.handle(id).untag(name));
  }
}

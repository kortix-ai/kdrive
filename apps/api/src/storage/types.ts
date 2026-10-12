// The VolumeStore contract. Both drivers (platinum, emulated) implement it
// identically and throw only VolumeStoreError with Platinum's codes.
// FROZEN: builders code against this file; do not change signatures.

export type Ref = string; // 'head' | 'vc_…' | tag
export type EntryType = 'file' | 'dir' | 'symlink' | 'other';

export interface VolumeInfo {
  id: string;
  name: string;
  headCommitId: string;
  sizeLimitBytes: number;
  logicalBytes: number;
  fileCount: number;
  forkedFrom: { volumeId: string; commitId: string } | null;
  createdAt: string;
  lastCommitAt: string | null;
}

export interface FileEntry {
  path: string;
  name: string;
  type: EntryType;
  size: number;
  /** unix ms */
  mtime: number;
}

export interface FileStat extends FileEntry {
  mode: number;
  /** ULID of the commit that last wrote this entry; `vc_` + version is that commit id. */
  version: string | null;
  commitId: string;
  symlinkTarget: string | null;
}

export interface ListPage {
  entries: FileEntry[];
  nextCursor: string | null;
  commitId: string;
}

export type CommitOutcome = 'fast' | 'merged' | 'queued' | 'noop';
export interface PathReason {
  path: string;
  reason: string;
}
export interface CommitResult {
  commitId: string;
  outcome: CommitOutcome;
  headCommitId: string;
  overwritten: PathReason[];
  skipped: PathReason[];
}

export type CommitKind = 'init' | 'api' | 'restore' | 'fork' | 'fast' | 'merge' | 'side' | 'import' | 'orphan';

export interface Commit {
  id: string;
  seq: number | null;
  onHead: boolean;
  kind: CommitKind;
  parentId: string | null;
  baseId: string | null;
  createdAt: string;
  logicalBytes: number;
  fileCount: number;
  tags: string[];
  stats: { changedPaths: number; deletedPaths: number; uploadedBlocks: number; uploadedBytes: number };
}

export interface Tag {
  name: string;
  commitId: string;
  createdAt: string;
}

export interface UploadPlanFile {
  path: string;
  size: number;
  blocks: string[];
  mode?: number;
  mtime?: number;
}
export interface UploadPlan {
  files: UploadPlanFile[];
  dirs: string[];
  overwrite: boolean;
}
export interface PlannedUpload {
  uploadId: string;
  missing: string[];
  expiresAt: string;
}

export interface ReadOptions {
  at?: Ref;
  /** raw `bytes=…` header */
  range?: string;
  signal?: AbortSignal;
}
export interface ReadResult {
  status: 200 | 206;
  body: ReadableStream<Uint8Array>;
  /** Bytes in `body`, or null when the store did not say (e.g. a chunked or compressed upstream response). */
  contentLength: number | null;
  contentRange: string | null;
  /** `"<version>"` */
  etag: string | null;
  commitId: string;
}

export interface StoreLimits {
  maxVolumes: number;
  usedVolumes: number;
  maxBytesPerVolume: number;
  maxTagsPerVolume: number;
  maxUploadsInFlight: number;
}

export interface VolumeStore {
  readonly driver: 'platinum' | 'emulated';
  /** get-or-create by name */
  openVolume(name: string): Promise<VolumeInfo>;
  /** throws volume_exists when the name is taken */
  createVolume(name: string): Promise<VolumeInfo>;
  getVolume(id: string): Promise<VolumeInfo>;
  deleteVolume(id: string, opts?: { missingOk?: boolean }): Promise<void>;
  forkVolume(id: string, newName: string, at?: Ref): Promise<VolumeInfo>;
  restoreVolume(id: string, to: Ref): Promise<Commit>;
  limits(): Promise<StoreLimits>;
  list(id: string, path: string, opts?: { at?: Ref; recursive?: boolean; limit?: number; cursor?: string }): Promise<ListPage>;
  stat(id: string, path: string, opts?: { at?: Ref }): Promise<FileStat>;
  read(id: string, path: string, opts?: ReadOptions): Promise<ReadResult>;
  write(
    id: string,
    path: string,
    data: Uint8Array,
    opts?: { overwrite?: boolean; mode?: number },
  ): Promise<CommitResult & { version: string | null }>;
  copy(id: string, src: string, dst: string, opts?: { recursive?: boolean; overwrite?: boolean }): Promise<CommitResult>;
  move(id: string, src: string, dst: string, opts?: { overwrite?: boolean }): Promise<CommitResult>;
  remove(id: string, path: string, opts?: { recursive?: boolean }): Promise<CommitResult>;
  /** `waitMs`: how long to queue for a free upload slot (default 30 s). */
  planUpload(id: string, plan: UploadPlan, opts?: { waitMs?: number }): Promise<PlannedUpload>;
  putBlock(id: string, uploadId: string, sha: string, bytes: Uint8Array): Promise<void>;
  commitUpload(id: string, uploadId: string): Promise<CommitResult & { files: number }>;
  /**
   * Gives up on a plan that will not be committed. Platinum has no abort
   * endpoint: the plan keeps one of the org's upload slots until it expires
   * (15 min after its last use), so the local slot is kept until then too.
   * After a successful commit this is a no-op (the commit already freed it).
   */
  releaseUpload(uploadId: string): void;
  history(id: string, opts?: { limit?: number; before?: string }): Promise<{ commits: Commit[]; nextCursor: string | null }>;
  getCommit(id: string, ref: Ref): Promise<Commit & { overwritten: PathReason[]; skipped: PathReason[] }>;
  listTags(id: string): Promise<Tag[]>;
  putTag(id: string, name: string, commit?: Ref): Promise<Tag>;
  deleteTag(id: string, name: string): Promise<void>;
}

export type StoreErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'insufficient_scope'
  | 'quota_exceeded'
  | 'volume_not_found'
  | 'not_found'
  | 'path_not_found'
  | 'volume_exists'
  | 'volume_busy'
  | 'path_exists'
  | 'not_a_file'
  | 'not_a_directory'
  | 'directory_not_empty'
  | 'conflict'
  | 'payload_too_large'
  | 'range_not_satisfiable'
  | 'rate_limited'
  | 'commit_failed'
  | 'unavailable'
  | 'internal';

export interface StoreErrorExtra {
  path?: string;
  paths?: string[];
  missing?: string[];
  limit?: 'volumes' | 'bytes' | 'stored_bytes' | 'tags' | 'mounts';
  max?: number;
  bytes?: number;
  retryAfterSeconds?: number;
  retryable?: boolean;
  /** Platinum's reason for a 429 / 503 (e.g. `org_uploads`, `gateway_busy`). */
  reason?: string;
}

export class VolumeStoreError extends Error {
  constructor(
    public status: number,
    public code: StoreErrorCode,
    message: string,
    public extra: StoreErrorExtra = {},
  ) {
    super(message);
    this.name = 'VolumeStoreError';
  }
}

export const isStoreError = (e: unknown, code?: StoreErrorCode): e is VolumeStoreError =>
  e instanceof VolumeStoreError && (!code || e.code === code);

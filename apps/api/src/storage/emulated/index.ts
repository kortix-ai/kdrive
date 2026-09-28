// On-disk emulator of Platinum volume semantics. Used by tests and by local
// dev when VOLUMES_STORAGE=emulated. It reproduces the fidelity checklist in
// notes/platinum-api.md §10: whole-volume commits, `at` reads, tags, restore,
// fork, a deduplicating block store with `missing`, logicalBytes, retention
// thinning and Platinum's error codes.
//
// Layout under <dir>/emulated:
//   blocks/<sha[0:2]>/<sha>                org-wide block store (dedup)
//   volumes/<vol_id>/volume.json           volume doc (+ tags)
//   volumes/<vol_id>/commits/<vc_id>.json  commit doc (+ full tree)
//   names.json                             lowercased name -> vol_id

import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { monotonicFactory } from 'ulid';
import { BLOCK_SIZE, GiB, MAX_PLAN_BLOCKS, MAX_PLAN_FILES, MAX_WRITE_BYTES, TAG_BUDGET, MAX_UPLOADS_IN_FLIGHT } from '@volumes/shared';
import {
  type Commit,
  type CommitKind,
  type CommitResult,
  type EntryType,
  type FileEntry,
  type FileStat,
  type ListPage,
  type PathReason,
  type PlannedUpload,
  type ReadOptions,
  type ReadResult,
  type Ref,
  type StoreLimits,
  type Tag,
  type UploadPlan,
  type VolumeInfo,
  type VolumeStore,
  VolumeStoreError,
} from '../types';
import { UploadSlots, uploadSlots as sharedSlots } from '../upload-slots';
import { BlockStore, ZERO_BLOCK_SHA, blocksOf, readJson, sha256Hex, writeJson } from './fs';
import { parseRange } from './range';
import { KEEP_LAST, RETENTION_DAYS, TRASH_MS, computeRetained } from './retention';

// ── docs ────────────────────────────────────────────────────────────────────

type FileNode = { type: 'file'; size: number; mtime: number; mode: number; blocks: string[]; version: string };
type DirNode = { type: 'dir'; mtime: number; mode: number; version: string };
type Node = FileNode | DirNode;
type Tree = Record<string, Node>; // absolute path (never '/') -> node

interface VolumeDoc {
  id: string;
  name: string;
  createdAt: string;
  headCommitId: string;
  forkedFrom: { volumeId: string; commitId: string } | null;
  deletedAt: string | null;
  nextSeq: number;
  tags: Record<string, { commitId: string; createdAt: string }>;
}

interface CommitDoc {
  id: string;
  seq: number;
  kind: CommitKind;
  parentId: string | null;
  baseId: string | null;
  createdAt: string;
  expiredAt: string | null;
  purged: boolean;
  logicalBytes: number;
  fileCount: number;
  stats: Commit['stats'];
  tree: Tree | null; // null once purged
}

interface Plan {
  uploadId: string;
  volumeId: string;
  baseCommitId: string;
  plan: UploadPlan;
  /** sha -> expected byte length */
  blockLen: Map<string, number>;
  expiresAt: number;
  uploadedBlocks: number;
  uploadedBytes: number;
}

export interface EmulatedStoreOptions {
  /** Root data dir; the emulator writes under `<dir>/emulated`. */
  dir: string;
  now?: () => number;
  maxVolumes?: number;
  maxBytesPerVolume?: number;
  /** Upload slot semaphore (defaults to the process-wide one). */
  slots?: UploadSlots;
  slotWaitMs?: number;
}

const VOLUME_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const TAG_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const COMMIT_ID = /^vc_[0-9A-HJKMNP-TV-Z]{26}$/;
const SHA = /^[0-9a-f]{64}$/;
const PLAN_TTL_MS = 15 * 60_000;
const MAX_BLOCK = BLOCK_SIZE;

const err = (status: number, code: VolumeStoreError['code'], message: string, extra: VolumeStoreError['extra'] = {}) =>
  new VolumeStoreError(status, code, message, extra);

// ── path helpers (store-side normalisation, like Platinum's server) ──────────

function normPath(p: string): string {
  if (typeof p !== 'string' || p.includes('\0')) throw err(400, 'bad_request', 'invalid path');
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!out.length) throw err(400, 'bad_request', 'path escapes the root');
      out.pop();
      continue;
    }
    if (Buffer.byteLength(seg) > 255) throw err(400, 'bad_request', 'path component too long');
    out.push(seg);
  }
  const r = '/' + out.join('/');
  if (Buffer.byteLength(r) > 4096) throw err(400, 'bad_request', 'path too long');
  return r;
}

const parentOf = (p: string) => {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
};
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const within = (root: string, p: string) => root === '/' || p === root || p.startsWith(root + '/');
const cmpPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function logicalBytesOf(tree: Tree): { logicalBytes: number; fileCount: number } {
  let bytes = 0;
  let files = 0;
  for (const n of Object.values(tree)) {
    if (n.type === 'file') {
      bytes += Math.ceil(n.size / 4096) * 4096;
      files++;
    } else bytes += 4096;
  }
  return { logicalBytes: bytes, fileCount: files };
}

function sameNode(a: Node | undefined, b: Node | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.type !== b.type || a.mode !== b.mode) return false;
  if (a.type === 'file' && b.type === 'file') {
    return a.size === b.size && a.mtime === b.mtime && a.blocks.length === b.blocks.length && a.blocks.every((s, i) => s === b.blocks[i]);
  }
  return true;
}

function diffStats(prev: Tree, next: Tree): { changed: number; deleted: number } {
  let changed = 0;
  let deleted = 0;
  for (const [p, n] of Object.entries(next)) if (!sameNode(prev[p], n)) changed++;
  for (const p of Object.keys(prev)) if (!(p in next)) deleted++;
  return { changed, deleted };
}

// ── store ───────────────────────────────────────────────────────────────────

export class EmulatedStore implements VolumeStore {
  readonly driver = 'emulated' as const;
  private readonly root: string;
  private readonly blocks: BlockStore;
  private readonly now: () => number;
  private readonly maxVolumes: number;
  private readonly maxBytesPerVolume: number;
  private readonly slots: UploadSlots;
  private readonly slotWaitMs: number;
  private readonly ulid = monotonicFactory();

  private names: Record<string, string> | null = null;
  private volumes = new Map<string, VolumeDoc>();
  private commits = new Map<string, Map<string, CommitDoc>>(); // volId -> commits (all loaded)
  private plans = new Map<string, Plan>();
  private locks = new Map<string, Promise<unknown>>();
  private globalLock: Promise<unknown> = Promise.resolve();

  constructor(opts: EmulatedStoreOptions) {
    this.root = path.join(opts.dir, 'emulated');
    this.blocks = new BlockStore(this.root);
    this.now = opts.now ?? Date.now;
    this.maxVolumes = opts.maxVolumes ?? 25;
    this.maxBytesPerVolume = opts.maxBytesPerVolume ?? 50 * GiB;
    this.slots = opts.slots ?? sharedSlots;
    this.slotWaitMs = opts.slotWaitMs ?? 30_000;
  }

  // ── infrastructure ────────────────────────────────────────────────────────

  private newId(prefix: 'vol_' | 'vc_' | 'vu_'): string {
    return prefix + this.ulid(this.now());
  }

  private iso(ms = this.now()): string {
    return new Date(ms).toISOString();
  }

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const chained = prev.then(() => gate);
    this.locks.set(key, chained);
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chained) this.locks.delete(key);
    }
  }

  private async withGlobal<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.globalLock;
    let release!: () => void;
    this.globalLock = new Promise<void>((r) => (release = r));
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private volDir(id: string) {
    return path.join(this.root, 'volumes', id);
  }

  private async loadNames(): Promise<Record<string, string>> {
    if (!this.names) this.names = (await readJson<Record<string, string>>(path.join(this.root, 'names.json'))) ?? {};
    return this.names;
  }

  private async saveNames(): Promise<void> {
    await writeJson(path.join(this.root, 'names.json'), this.names ?? {});
  }

  private async loadVolume(id: string): Promise<VolumeDoc | null> {
    const cached = this.volumes.get(id);
    if (cached) return cached;
    if (!/^vol_[0-9A-Z]{26}$/.test(id)) return null;
    const doc = await readJson<VolumeDoc>(path.join(this.volDir(id), 'volume.json'));
    if (doc) this.volumes.set(id, doc);
    return doc;
  }

  private async saveVolume(doc: VolumeDoc): Promise<void> {
    this.volumes.set(doc.id, doc);
    await writeJson(path.join(this.volDir(doc.id), 'volume.json'), doc);
  }

  /** Resolves a volume by id or (case-insensitive) name; throws volume_not_found. */
  private async vol(idOrName: string): Promise<VolumeDoc> {
    let doc = await this.loadVolume(idOrName);
    if (!doc) {
      const names = await this.loadNames();
      const id = names[idOrName.toLowerCase()];
      if (id) doc = await this.loadVolume(id);
    }
    if (!doc || doc.deletedAt) throw err(404, 'volume_not_found', `volume ${idOrName} not found`);
    return doc;
  }

  private async commitsOf(volId: string): Promise<Map<string, CommitDoc>> {
    let m = this.commits.get(volId);
    if (m) return m;
    m = new Map();
    const dir = path.join(this.volDir(volId), 'commits');
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      files = [];
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const c = await readJson<CommitDoc>(path.join(dir, f));
      if (c) m.set(c.id, c);
    }
    this.commits.set(volId, m);
    return m;
  }

  private async saveCommit(volId: string, c: CommitDoc): Promise<void> {
    (await this.commitsOf(volId)).set(c.id, c);
    await writeJson(path.join(this.volDir(volId), 'commits', `${c.id}.json`), c);
  }

  /** Resolves `at` (head / vc_ id / tag) to a readable commit doc. */
  private async resolve(v: VolumeDoc, ref: Ref | undefined, opts: { allowPurged?: boolean } = {}): Promise<CommitDoc> {
    const commits = await this.commitsOf(v.id);
    const r = ref === undefined || ref === '' ? 'head' : ref;
    let id: string | undefined;
    if (r === 'head') id = v.headCommitId;
    else if (COMMIT_ID.test(r)) id = r;
    else id = v.tags[r]?.commitId;
    const c = id ? commits.get(id) : undefined;
    if (!c) throw err(404, 'not_found', `commit ${r} not found`);
    if (c.purged && !opts.allowPurged) throw err(404, 'not_found', `commit ${r} was purged`);
    return c;
  }

  private info(v: VolumeDoc, head: CommitDoc): VolumeInfo {
    return {
      id: v.id,
      name: v.name,
      headCommitId: v.headCommitId,
      sizeLimitBytes: this.maxBytesPerVolume,
      logicalBytes: head.logicalBytes,
      fileCount: head.fileCount,
      forkedFrom: v.forkedFrom,
      createdAt: v.createdAt,
      lastCommitAt: head.kind === 'init' ? null : head.createdAt,
    };
  }

  private toCommit(v: VolumeDoc, c: CommitDoc): Commit {
    return {
      id: c.id,
      seq: c.seq,
      onHead: true,
      kind: c.kind,
      parentId: c.parentId,
      baseId: c.baseId,
      createdAt: c.createdAt,
      logicalBytes: c.logicalBytes,
      fileCount: c.fileCount,
      tags: Object.entries(v.tags)
        .filter(([, t]) => t.commitId === c.id)
        .map(([n]) => n)
        .sort(),
      stats: { ...c.stats },
    };
  }

  private async liveVolumeCount(): Promise<number> {
    const names = await this.loadNames();
    return Object.keys(names).length;
  }

  private validateVolumeName(name: string): void {
    if (!VOLUME_NAME.test(name) || /^(vol_|tmp-)/i.test(name) || name.toLowerCase() === 'limits') {
      throw err(400, 'bad_request', `invalid volume name "${name}"`);
    }
  }

  /** Creates the volume doc + first commit. Caller holds the global lock and checked the name. */
  private async createVolumeDoc(
    name: string,
    first: { kind: 'init' | 'fork'; tree: Tree; baseId: string | null; forkedFrom: VolumeDoc['forkedFrom'] },
  ): Promise<VolumeDoc> {
    if ((await this.liveVolumeCount()) >= this.maxVolumes) {
      throw err(403, 'quota_exceeded', `volume limit reached (${this.maxVolumes})`, { limit: 'volumes', max: this.maxVolumes });
    }
    const id = this.newId('vol_');
    const commitId = this.newId('vc_');
    const createdAt = this.iso();
    const lb = logicalBytesOf(first.tree);
    const commit: CommitDoc = {
      id: commitId,
      seq: 1,
      kind: first.kind,
      parentId: null,
      baseId: first.baseId,
      createdAt,
      expiredAt: null,
      purged: false,
      ...lb,
      stats: { changedPaths: 0, deletedPaths: 0, uploadedBlocks: 0, uploadedBytes: 0 },
      tree: first.tree,
    };
    const doc: VolumeDoc = {
      id,
      name,
      createdAt,
      headCommitId: commitId,
      forkedFrom: first.forkedFrom,
      deletedAt: null,
      nextSeq: 2,
      tags: {},
    };
    this.commits.set(id, new Map());
    await this.saveCommit(id, commit);
    await this.saveVolume(doc);
    const names = await this.loadNames();
    names[name.toLowerCase()] = id;
    await this.saveNames();
    return doc;
  }

  /**
   * Applies a mutation to the head tree as one commit. `mutate` edits a copy of
   * the tree and returns the new tree; no change means `noop` (commit id = head).
   */
  private async commitTree(
    v: VolumeDoc,
    kind: CommitKind,
    mutate: (tree: Tree, version: string, now: number) => Tree | Promise<Tree>,
    extra: { uploadedBlocks?: number; uploadedBytes?: number } = {},
  ): Promise<CommitResult & { version: string }> {
    const head = await this.resolve(v, 'head');
    const commitId = this.newId('vc_');
    const version = commitId.slice(3);
    const now = this.now();
    const prev = head.tree ?? {};
    const next = await mutate(structuredClone(prev), version, now);
    const d = diffStats(prev, next);
    if (d.changed === 0 && d.deleted === 0 && kind === 'api') {
      return { commitId: head.id, outcome: 'noop', headCommitId: head.id, overwritten: [], skipped: [], version: '' };
    }
    const lb = logicalBytesOf(next);
    const c: CommitDoc = {
      id: commitId,
      seq: v.nextSeq,
      kind,
      parentId: head.id,
      baseId: head.id,
      createdAt: this.iso(now),
      expiredAt: null,
      purged: false,
      ...lb,
      stats: {
        changedPaths: d.changed,
        deletedPaths: d.deleted,
        uploadedBlocks: extra.uploadedBlocks ?? 0,
        uploadedBytes: extra.uploadedBytes ?? 0,
      },
      tree: next,
    };
    await this.saveCommit(v.id, c);
    v.nextSeq += 1;
    v.headCommitId = c.id;
    await this.saveVolume(v);
    return { commitId: c.id, outcome: 'fast', headCommitId: c.id, overwritten: [], skipped: [], version };
  }

  /** Ensures every ancestor dir of `p` exists in `tree`; a file in the way is not_a_directory. */
  private mkParents(tree: Tree, p: string, version: string, now: number): void {
    const parts = p.split('/').filter(Boolean);
    let cur = '';
    for (let i = 0; i < parts.length - 1; i++) {
      cur += '/' + parts[i];
      const n = tree[cur];
      if (!n) tree[cur] = { type: 'dir', mtime: now, mode: 0o755, version };
      else if (n.type !== 'dir') throw err(409, 'not_a_directory', `${cur} is not a directory`, { path: cur });
    }
  }

  private subtree(tree: Tree, root: string): string[] {
    return Object.keys(tree).filter((k) => within(root, k));
  }

  private async runRetention(v: VolumeDoc): Promise<void> {
    const commits = await this.commitsOf(v.id);
    const now = this.now();
    const pinned = new Set<string>(Object.values(v.tags).map((t) => t.commitId));
    for (const p of this.plans.values()) if (p.volumeId === v.id && p.expiresAt > now) pinned.add(p.baseCommitId);
    pinned.add(v.headCommitId);
    const live = [...commits.values()].filter((c) => !c.purged);
    const keep = computeRetained(
      live.map((c) => ({ id: c.id, seq: c.seq, onHead: true, kind: c.kind, createdAt: Date.parse(c.createdAt) })),
      pinned,
      now,
      { keepLast: KEEP_LAST, days: RETENTION_DAYS },
    );
    for (const c of live) {
      if (!keep.has(c.id) && !c.expiredAt) {
        c.expiredAt = this.iso(now);
        await this.saveCommit(v.id, c);
      } else if (keep.has(c.id) && c.expiredAt) {
        c.expiredAt = null;
        await this.saveCommit(v.id, c);
      }
    }
    for (const c of live) {
      if (c.expiredAt && Date.parse(c.expiredAt) < now - TRASH_MS) {
        c.purged = true;
        c.tree = null;
        await this.saveCommit(v.id, c);
      }
    }
  }

  /** Using an expired commit (tag, restore, fork) claims it back. */
  private async revive(v: VolumeDoc, c: CommitDoc): Promise<void> {
    if (c.expiredAt && !c.purged) {
      c.expiredAt = null;
      await this.saveCommit(v.id, c);
    }
  }

  private livePlanCount(): number {
    const now = this.now();
    let n = 0;
    for (const [id, p] of this.plans) {
      if (p.expiresAt <= now) {
        this.plans.delete(id);
        this.slots.release(id);
      } else n++;
    }
    return n;
  }

  /** Test hook: runs retention for one volume now. */
  async gc(volumeId: string): Promise<void> {
    const v = await this.vol(volumeId);
    await this.withLock(v.id, () => this.runRetention(v));
  }

  // ── volumes ───────────────────────────────────────────────────────────────

  async openVolume(name: string): Promise<VolumeInfo> {
    this.validateVolumeName(name);
    return this.withGlobal(async () => {
      const names = await this.loadNames();
      const id = names[name.toLowerCase()];
      let v = id ? await this.loadVolume(id) : null;
      if (!v || v.deletedAt) v = await this.createVolumeDoc(name, { kind: 'init', tree: {}, baseId: null, forkedFrom: null });
      return this.info(v, await this.resolve(v, 'head'));
    });
  }

  async createVolume(name: string): Promise<VolumeInfo> {
    this.validateVolumeName(name);
    return this.withGlobal(async () => {
      const names = await this.loadNames();
      if (names[name.toLowerCase()]) throw err(409, 'volume_exists', `volume ${name} already exists`);
      const v = await this.createVolumeDoc(name, { kind: 'init', tree: {}, baseId: null, forkedFrom: null });
      return this.info(v, await this.resolve(v, 'head'));
    });
  }

  async getVolume(id: string): Promise<VolumeInfo> {
    const v = await this.vol(id);
    return this.info(v, await this.resolve(v, 'head'));
  }

  async deleteVolume(id: string, opts: { missingOk?: boolean } = {}): Promise<void> {
    await this.withGlobal(async () => {
      let v: VolumeDoc;
      try {
        v = await this.vol(id);
      } catch (e) {
        if (opts.missingOk) return;
        throw e;
      }
      v.deletedAt = this.iso();
      await this.saveVolume(v);
      const names = await this.loadNames();
      delete names[v.name.toLowerCase()];
      await this.saveNames();
      for (const [pid, p] of this.plans) if (p.volumeId === v.id) this.releaseUpload(pid);
    });
  }

  async forkVolume(id: string, newName: string, at?: Ref): Promise<VolumeInfo> {
    this.validateVolumeName(newName);
    const src = await this.vol(id);
    const c = await this.resolve(src, at);
    await this.revive(src, c);
    return this.withGlobal(async () => {
      const names = await this.loadNames();
      if (names[newName.toLowerCase()]) throw err(409, 'volume_exists', `volume ${newName} already exists`);
      const v = await this.createVolumeDoc(newName, {
        kind: 'fork',
        tree: structuredClone(c.tree ?? {}),
        baseId: c.id,
        forkedFrom: { volumeId: src.id, commitId: c.id },
      });
      return this.info(v, await this.resolve(v, 'head'));
    });
  }

  async restoreVolume(id: string, to: Ref): Promise<Commit> {
    if (!to) throw err(400, 'bad_request', 'to is required');
    const v = await this.vol(id);
    return this.withLock(v.id, async () => {
      const target = await this.resolve(v, to);
      await this.revive(v, target);
      const r = await this.commitTree(v, 'restore', () => structuredClone(target.tree ?? {}));
      const c = (await this.commitsOf(v.id)).get(r.commitId)!;
      c.baseId = target.id;
      await this.saveCommit(v.id, c);
      return this.toCommit(v, c);
    });
  }

  async limits(): Promise<StoreLimits> {
    return {
      maxVolumes: this.maxVolumes,
      usedVolumes: await this.liveVolumeCount(),
      maxBytesPerVolume: this.maxBytesPerVolume,
      maxTagsPerVolume: TAG_BUDGET,
      maxUploadsInFlight: MAX_UPLOADS_IN_FLIGHT,
    };
  }

  // ── reads ─────────────────────────────────────────────────────────────────

  private entryOf(p: string, n: Node): FileEntry {
    return { path: p, name: nameOf(p), type: n.type as EntryType, size: n.type === 'file' ? n.size : 0, mtime: n.mtime };
  }

  async list(
    id: string,
    rawPath: string,
    opts: { at?: Ref; recursive?: boolean; limit?: number; cursor?: string } = {},
  ): Promise<ListPage> {
    const v = await this.vol(id);
    const c = await this.resolve(v, opts.at);
    const p = normPath(rawPath);
    const tree = c.tree ?? {};
    if (p !== '/') {
      const n = tree[p];
      if (!n) throw err(404, 'path_not_found', `${p} not found`, { path: p });
      if (n.type !== 'dir') throw err(409, 'not_a_directory', `${p} is not a directory`, { path: p });
    }
    const limit = Math.min(Math.max(opts.limit ?? 1000, 1), 10_000);
    let keys = Object.keys(tree).filter((k) => k !== p && within(p, k) && (opts.recursive || parentOf(k) === p));
    keys.sort(cmpPath);
    if (opts.cursor) {
      if (!opts.cursor.startsWith('/')) throw err(400, 'bad_request', 'invalid cursor');
      keys = keys.filter((k) => k > opts.cursor!);
    }
    const page = keys.slice(0, limit);
    return {
      entries: page.map((k) => this.entryOf(k, tree[k])),
      nextCursor: keys.length > limit ? page[page.length - 1] : null,
      commitId: c.id,
    };
  }

  async stat(id: string, rawPath: string, opts: { at?: Ref } = {}): Promise<FileStat> {
    const v = await this.vol(id);
    const c = await this.resolve(v, opts.at);
    const p = normPath(rawPath);
    if (p === '/') {
      return {
        path: '/',
        name: '',
        type: 'dir',
        size: 0,
        mtime: Date.parse(c.createdAt),
        mode: 0o755,
        version: null,
        commitId: c.id,
        symlinkTarget: null,
      };
    }
    const n = (c.tree ?? {})[p];
    if (!n) throw err(404, 'path_not_found', `${p} not found`, { path: p });
    return { ...this.entryOf(p, n), mode: n.mode, version: n.version || null, commitId: c.id, symlinkTarget: null };
  }

  async read(id: string, rawPath: string, opts: ReadOptions = {}): Promise<ReadResult> {
    const v = await this.vol(id);
    const c = await this.resolve(v, opts.at);
    const p = normPath(rawPath);
    const n = p === '/' ? ({ type: 'dir' } as const) : (c.tree ?? {})[p];
    if (!n) throw err(404, 'path_not_found', `${p} not found`, { path: p });
    if (n.type !== 'file') throw err(409, 'not_a_file', `${p} is not a file`, { path: p });
    const range = parseRange(opts.range, n.size);
    const start = range?.start ?? 0;
    const end = range ? range.end : n.size - 1;
    const length = n.size === 0 ? 0 : end - start + 1;
    const blocks = n.blocks.slice();
    const store = this.blocks;
    let blockIdx = Math.floor(start / BLOCK_SIZE);
    let offset = start;
    const stop = start + length;
    const signal = opts.signal;
    const body = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        if (signal?.aborted || offset >= stop) {
          ctrl.close();
          return;
        }
        const bytes = await store.get(blocks[blockIdx]);
        const blockStart = blockIdx * BLOCK_SIZE;
        const from = offset - blockStart;
        const to = Math.min(bytes.length, stop - blockStart);
        ctrl.enqueue(bytes.slice(from, to));
        offset = blockStart + to;
        blockIdx++;
      },
    });
    return {
      status: range ? 206 : 200,
      body,
      contentLength: length,
      contentRange: range ? `bytes ${start}-${end}/${n.size}` : null,
      etag: n.version ? `"${n.version}"` : null,
      commitId: c.id,
    };
  }

  // ── mutations ─────────────────────────────────────────────────────────────

  async write(
    id: string,
    rawPath: string,
    data: Uint8Array,
    opts: { overwrite?: boolean; mode?: number } = {},
  ): Promise<CommitResult & { version: string | null }> {
    const v = await this.vol(id);
    const p = normPath(rawPath);
    if (p === '/') throw err(400, 'bad_request', 'cannot write the root');
    if (data.length > MAX_WRITE_BYTES) {
      throw err(413, 'payload_too_large', `write exceeds ${MAX_WRITE_BYTES} bytes`, { max: MAX_WRITE_BYTES });
    }
    const chunks = blocksOf(data);
    for (const b of chunks) await this.blocks.put(b.sha, b.bytes);
    return this.withLock(v.id, async () => {
      const head = await this.resolve(v, 'head');
      const cur = (head.tree ?? {})[p];
      const overwrite = opts.overwrite ?? true;
      if (cur && !overwrite) throw err(409, 'path_exists', `${p} already exists`, { path: p });
      if (cur && cur.type === 'dir') throw err(409, 'not_a_file', `${p} is a directory`, { path: p });
      const mode = (opts.mode ?? (cur?.mode ?? 0o644)) & 0o1777;
      const blocks = chunks.map((b) => b.sha);
      if (cur && cur.type === 'file' && cur.size === data.length && cur.mode === mode && cur.blocks.join() === blocks.join()) {
        return { commitId: head.id, outcome: 'noop', headCommitId: head.id, overwritten: [], skipped: [], version: cur.version };
      }
      const r = await this.commitTree(
        v,
        'api',
        (tree, version, now) => {
          this.mkParents(tree, p, version, now);
          tree[p] = { type: 'file', size: data.length, mtime: now, mode, blocks, version };
          return tree;
        },
        { uploadedBlocks: chunks.length, uploadedBytes: data.length },
      );
      return { ...r, version: r.outcome === 'noop' ? null : r.version };
    });
  }

  async copy(id: string, rawSrc: string, rawDst: string, opts: { recursive?: boolean; overwrite?: boolean } = {}): Promise<CommitResult> {
    const v = await this.vol(id);
    const src = normPath(rawSrc);
    const dst = normPath(rawDst);
    if (src === '/' || dst === '/') throw err(400, 'bad_request', 'cannot copy the root');
    return this.withLock(v.id, async () => {
      const r = await this.commitTree(v, 'api', (tree, version, now) => {
        const s = tree[src];
        if (!s) throw err(404, 'path_not_found', `${src} not found`, { path: src });
        if (s.type === 'dir' && !opts.recursive) throw err(400, 'bad_request', 'src is a directory; set recursive');
        if (s.type === 'dir' && within(src, dst)) throw err(400, 'bad_request', 'cannot copy a directory into itself');
        if (src === dst) throw err(409, 'path_exists', `${dst} already exists`, { path: dst });
        if (tree[dst]) {
          if (!opts.overwrite) throw err(409, 'path_exists', `${dst} already exists`, { path: dst });
          for (const k of this.subtree(tree, dst)) delete tree[k];
        }
        this.mkParents(tree, dst, version, now);
        for (const k of this.subtree(tree, src)) {
          const target = dst + k.slice(src.length);
          tree[target] = { ...structuredClone(tree[k]), version };
        }
        return tree;
      });
      return strip(r);
    });
  }

  async move(id: string, rawSrc: string, rawDst: string, opts: { overwrite?: boolean } = {}): Promise<CommitResult> {
    const v = await this.vol(id);
    const src = normPath(rawSrc);
    const dst = normPath(rawDst);
    if (src === '/' || dst === '/') throw err(400, 'bad_request', 'cannot move the root');
    return this.withLock(v.id, async () => {
      const r = await this.commitTree(v, 'api', (tree, version, now) => {
        const s = tree[src];
        if (!s) throw err(404, 'path_not_found', `${src} not found`, { path: src });
        if (src === dst) return tree;
        if (s.type === 'dir' && within(src, dst)) throw err(400, 'bad_request', 'cannot move a directory into itself');
        if (tree[dst]) {
          if (!opts.overwrite) throw err(409, 'path_exists', `${dst} already exists`, { path: dst });
          for (const k of this.subtree(tree, dst)) delete tree[k];
        }
        this.mkParents(tree, dst, version, now);
        for (const k of this.subtree(tree, src).sort(cmpPath)) {
          const node = tree[k];
          delete tree[k];
          tree[dst + k.slice(src.length)] = { ...node, version };
        }
        return tree;
      });
      return strip(r);
    });
  }

  async remove(id: string, rawPath: string, opts: { recursive?: boolean } = {}): Promise<CommitResult> {
    const v = await this.vol(id);
    const p = normPath(rawPath);
    if (p === '/') throw err(400, 'bad_request', 'cannot remove the root');
    return this.withLock(v.id, async () => {
      const r = await this.commitTree(v, 'api', (tree) => {
        const n = tree[p];
        if (!n) throw err(404, 'path_not_found', `${p} not found`, { path: p });
        const sub = this.subtree(tree, p);
        if (n.type === 'dir' && sub.length > 1 && !opts.recursive) {
          throw err(409, 'directory_not_empty', `${p} is not empty`, { path: p });
        }
        for (const k of sub) delete tree[k];
        return tree;
      });
      return strip(r);
    });
  }

  // ── block upload protocol ─────────────────────────────────────────────────

  async planUpload(id: string, plan: UploadPlan): Promise<PlannedUpload> {
    const v = await this.vol(id);
    if (plan.files.length > MAX_PLAN_FILES) throw err(400, 'bad_request', `at most ${MAX_PLAN_FILES} files per upload`);
    const seen = new Set<string>();
    const blockLen = new Map<string, number>();
    let totalBlocks = 0;
    let totalBytes = 0;
    const files = plan.files.map((f) => {
      const p = normPath(f.path);
      if (p === '/') throw err(400, 'bad_request', 'cannot upload to the root');
      if (seen.has(p)) throw err(400, 'bad_request', `duplicate path ${p}`);
      seen.add(p);
      if (!Number.isSafeInteger(f.size) || f.size < 0) throw err(400, 'bad_request', `bad size for ${p}`);
      const expected = Math.ceil(f.size / BLOCK_SIZE);
      if (!Array.isArray(f.blocks) || f.blocks.length !== expected) {
        throw err(400, 'bad_request', `${p}: expected ${expected} blocks, got ${f.blocks?.length ?? 0}`);
      }
      f.blocks.forEach((sha, i) => {
        if (!SHA.test(sha)) throw err(400, 'bad_request', `${p}: bad block hash`);
        const len = i < expected - 1 ? BLOCK_SIZE : f.size - i * BLOCK_SIZE;
        blockLen.set(sha, len);
      });
      totalBlocks += expected;
      totalBytes += f.size;
      return { ...f, path: p, mode: (f.mode ?? 0o644) & 0o1777 };
    });
    if (totalBlocks > MAX_PLAN_BLOCKS) throw err(400, 'bad_request', `at most ${MAX_PLAN_BLOCKS} blocks per upload`);
    const dirs = plan.dirs.map((d) => {
      const p = normPath(d);
      if (p === '/') throw err(400, 'bad_request', 'cannot create the root');
      return p;
    });
    if (totalBytes > this.maxBytesPerVolume) {
      throw err(403, 'quota_exceeded', 'upload is larger than the volume', { limit: 'bytes', max: this.maxBytesPerVolume });
    }
    const head = await this.resolve(v, 'head');
    if (!plan.overwrite) {
      const tree = head.tree ?? {};
      const clash = files.filter((f) => tree[f.path]).map((f) => f.path);
      if (clash.length) throw err(409, 'path_exists', `${clash.length} path(s) already exist`, { paths: clash.slice(0, 1000) });
    }

    const tempId = `pending_${this.newId('vu_')}`;
    await this.slots.acquire(tempId, { waitMs: this.slotWaitMs });
    if (this.livePlanCount() >= MAX_UPLOADS_IN_FLIGHT) {
      this.slots.release(tempId);
      throw err(429, 'rate_limited', 'too many uploads in progress', { retryAfterSeconds: 30, retryable: true });
    }
    const uploadId = this.newId('vu_');
    this.slots.rename(tempId, uploadId);
    const expiresAt = this.now() + PLAN_TTL_MS;
    this.plans.set(uploadId, {
      uploadId,
      volumeId: v.id,
      baseCommitId: head.id,
      plan: { files, dirs, overwrite: plan.overwrite },
      blockLen,
      expiresAt,
      uploadedBlocks: 0,
      uploadedBytes: 0,
    });
    const missing = await this.blocks.missing(blockLen.keys());
    return { uploadId, missing, expiresAt: this.iso(expiresAt) };
  }

  private livePlan(volumeId: string, uploadId: string): Plan {
    const p = this.plans.get(uploadId);
    if (!p || p.volumeId !== volumeId || p.expiresAt <= this.now()) {
      if (p && p.expiresAt <= this.now()) this.releaseUpload(uploadId);
      throw err(404, 'not_found', 'upload not found or expired');
    }
    return p;
  }

  async putBlock(id: string, uploadId: string, sha: string, bytes: Uint8Array): Promise<void> {
    const v = await this.vol(id);
    const p = this.livePlan(v.id, uploadId);
    if (bytes.length > MAX_BLOCK) throw err(413, 'payload_too_large', 'block exceeds 1 MiB', { max: MAX_BLOCK });
    const expected = p.blockLen.get(sha);
    if (expected === undefined) throw err(400, 'bad_request', 'block is not part of this upload');
    if (bytes.length !== expected) throw err(400, 'bad_request', `block length ${bytes.length} != ${expected}`);
    if (sha256Hex(bytes) !== sha) throw err(400, 'bad_request', 'block hash mismatch');
    await this.blocks.put(sha, bytes);
    p.uploadedBlocks++;
    p.uploadedBytes += bytes.length;
    p.expiresAt = this.now() + PLAN_TTL_MS;
    this.slots.touch(uploadId);
  }

  async commitUpload(id: string, uploadId: string): Promise<CommitResult & { files: number }> {
    const v = await this.vol(id);
    const p = this.livePlan(v.id, uploadId);
    const missing = (await this.blocks.missing(p.blockLen.keys())).filter((s) => s !== ZERO_BLOCK_SHA);
    if (missing.length) {
      throw err(400, 'bad_request', 'upload incomplete', { missing: missing.slice(0, 1000) });
    }
    const r = await this.withLock(v.id, () =>
      this.commitTree(
        v,
        'api',
        (tree, version, now) => {
          for (const d of p.plan.dirs) {
            const cur = tree[d];
            if (cur && cur.type !== 'dir') throw err(409, 'not_a_directory', `${d} is not a directory`, { path: d });
            this.mkParents(tree, d, version, now);
            if (!cur) tree[d] = { type: 'dir', mtime: now, mode: 0o755, version };
          }
          for (const f of p.plan.files) {
            const cur = tree[f.path];
            if (cur && cur.type === 'dir') throw err(409, 'not_a_file', `${f.path} is a directory`, { path: f.path });
            this.mkParents(tree, f.path, version, now);
            const node: FileNode = {
              type: 'file',
              size: f.size,
              mtime: f.mtime ?? now,
              mode: f.mode ?? 0o644,
              blocks: f.blocks.slice(),
              version,
            };
            if (!sameNode(cur, node)) tree[f.path] = node;
          }
          return tree;
        },
        { uploadedBlocks: p.uploadedBlocks, uploadedBytes: p.uploadedBytes },
      ),
    );
    this.releaseUpload(uploadId);
    return { ...strip(r), files: p.plan.files.length };
  }

  releaseUpload(uploadId: string): void {
    this.plans.delete(uploadId);
    this.slots.release(uploadId);
  }

  // ── history & tags ────────────────────────────────────────────────────────

  async history(id: string, opts: { limit?: number; before?: string } = {}): Promise<{ commits: Commit[]; nextCursor: string | null }> {
    const v = await this.vol(id);
    await this.withLock(v.id, () => this.runRetention(v));
    const commits = await this.commitsOf(v.id);
    const order = (a: CommitDoc, b: CommitDoc) =>
      a.createdAt === b.createdAt ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.createdAt < b.createdAt ? 1 : -1;
    let visible = [...commits.values()].filter((c) => !c.expiredAt && !c.purged).sort(order);
    if (opts.before) {
      const cur = commits.get(opts.before);
      if (!cur) throw err(400, 'bad_request', 'invalid cursor');
      visible = visible.filter((c) => order(cur, c) < 0);
    }
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const page = visible.slice(0, limit);
    return {
      commits: page.map((c) => this.toCommit(v, c)),
      nextCursor: visible.length > limit ? page[page.length - 1].id : null,
    };
  }

  async getCommit(id: string, ref: Ref): Promise<Commit & { overwritten: PathReason[]; skipped: PathReason[] }> {
    const v = await this.vol(id);
    const c = await this.resolve(v, ref);
    return { ...this.toCommit(v, c), overwritten: [], skipped: [] };
  }

  async listTags(id: string): Promise<Tag[]> {
    const v = await this.vol(id);
    return Object.entries(v.tags)
      .map(([name, t]) => ({ name, commitId: t.commitId, createdAt: t.createdAt }))
      .sort((a, b) => cmpPath(a.name, b.name));
  }

  async putTag(id: string, name: string, commit?: Ref): Promise<Tag> {
    if (!TAG_NAME.test(name) || name === 'head') throw err(400, 'bad_request', `invalid tag name "${name}"`);
    const v = await this.vol(id);
    return this.withLock(v.id, async () => {
      const c = await this.resolve(v, commit ?? 'head');
      if (!v.tags[name] && Object.keys(v.tags).length >= TAG_BUDGET) {
        throw err(403, 'quota_exceeded', `tag limit reached (${TAG_BUDGET})`, { limit: 'tags', max: TAG_BUDGET });
      }
      await this.revive(v, c);
      const t = { commitId: c.id, createdAt: this.iso() };
      v.tags[name] = t;
      await this.saveVolume(v);
      return { name, ...t };
    });
  }

  async deleteTag(id: string, name: string): Promise<void> {
    const v = await this.vol(id);
    await this.withLock(v.id, async () => {
      if (!v.tags[name]) throw err(404, 'not_found', `tag ${name} not found`);
      delete v.tags[name];
      await this.saveVolume(v);
    });
  }
}

function strip<T extends CommitResult & { version?: string }>(r: T): CommitResult {
  return { commitId: r.commitId, outcome: r.outcome, headCommitId: r.headCommitId, overwritten: r.overwritten, skipped: r.skipped };
}

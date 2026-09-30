import { describe, expect, test } from 'bun:test';
import { BLOCK_SIZE, type UploadPlanRequest } from '@volumes/shared';
import { ApiError } from '../api/client';
import type { UploadJob } from '../store';
import { blockSources, createUploadEngine, fileProgress, fileStatusLabel, prepareUpload, splitIntoPlans, type EngineApi, type PlannedFile } from './engine';
import { BLOCK, hashBlob, sha256Hex } from './hash-core';
import { createMainThreadHasher } from './hasher';
import { sourcesFromFiles } from './walk';

const enc = (s: string) => new TextEncoder().encode(s);
const file = (name: string, content: string | Uint8Array<ArrayBuffer>) => new File([typeof content === 'string' ? enc(content) : content], name);
let n = 0;
const id = () => `f${n++}`;

describe('hash-core', () => {
  test('block size matches the shared constant', () => {
    expect(BLOCK).toBe(BLOCK_SIZE);
  });
  test('hashes 1 MiB slices, last one short; empty file has no blocks', async () => {
    const bytes = new Uint8Array(BLOCK + 10).map((_, i) => i % 251);
    const progress: number[] = [];
    const blocks = await hashBlob(new Blob([bytes]), (h) => progress.push(h));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toBe(await sha256Hex(bytes.subarray(0, BLOCK)));
    expect(blocks[1]).toBe(await sha256Hex(bytes.subarray(BLOCK)));
    expect(progress).toEqual([BLOCK, BLOCK + 10]);
    expect(await hashBlob(new Blob([]))).toEqual([]);
    expect(await sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('prepareUpload', () => {
  test('resolves paths under the base, keeps only empty leaf dirs, rejects bad names', () => {
    const prep = prepareUpload(
      '/Docs',
      {
        files: [
          { file: file('a.txt', 'a'), relPath: 'Photos/2024/a.txt' },
          { file: file('b.txt', 'b'), relPath: 'b.txt' },
          { file: file('bad', 'x'), relPath: 'Photos/bad\u0001name' },
        ],
        dirs: ['Photos', 'Photos/2024', 'Photos/empty', 'Photos/empty/deeper', 'Other'],
      },
      id,
    );
    expect(prep.files.map((f) => f.path)).toEqual(['/Docs/Photos/2024/a.txt', '/Docs/b.txt']);
    expect(prep.dirs).toEqual(['/Docs/Other', '/Docs/Photos/empty/deeper']);
    expect(prep.invalid).toHaveLength(1);
    expect(prep.invalid[0].relPath).toBe('Photos/bad\u0001name');
  });

  test('an input folder pick keeps the relative tree', () => {
    const f = file('x.md', '#');
    Object.defineProperty(f, 'webkitRelativePath', { value: 'Notes/sub/x.md' });
    const s = sourcesFromFiles([f, file('.DS_Store', '')]);
    expect(s.files.map((x) => x.relPath)).toEqual(['Notes/sub/x.md']);
    expect(s.dirs.sort()).toEqual(['Notes', 'Notes/sub']);
  });
});

describe('splitIntoPlans', () => {
  const pf = (i: number, blocks: number): PlannedFile => ({ id: `p${i}`, path: `/f${i}`, file: new Blob([]), size: blocks * BLOCK, blocks: Array(blocks).fill('a'.repeat(64)) });

  test('splits by file count and block count; dirs ride in the first plan', () => {
    const files = Array.from({ length: 5 }, (_, i) => pf(i, 1));
    const byFiles = splitIntoPlans(files, ['/d1'], { maxFiles: 2, maxBlocks: 100, maxBody: 1e9 });
    expect(byFiles.map((b) => b.files.length)).toEqual([2, 2, 1]);
    expect(byFiles[0].dirs).toEqual(['/d1']);
    const byBlocks = splitIntoPlans([pf(0, 3), pf(1, 3), pf(2, 1)], [], { maxFiles: 100, maxBlocks: 4, maxBody: 1e9 });
    expect(byBlocks.map((b) => b.files.map((f) => f.id))).toEqual([['p0'], ['p1', 'p2']]);
  });

  test('dirs only, and more dirs than a plan holds', () => {
    expect(splitIntoPlans([], ['/a', '/b', '/c'], { maxFiles: 2, maxBlocks: 10, maxBody: 1e9 }).map((b) => b.dirs)).toEqual([['/a', '/b'], ['/c']]);
    expect(splitIntoPlans([], [])).toEqual([]);
  });

  test('blockSources maps each sha to its first file offset', () => {
    const a: PlannedFile = { id: 'a', path: '/a', file: new Blob([]), size: BLOCK + 5, blocks: ['x', 'y'] };
    const b: PlannedFile = { id: 'b', path: '/b', file: new Blob([]), size: 7, blocks: ['y'] };
    const m = blockSources([a, b]);
    expect(m.get('x')).toMatchObject({ offset: 0, length: BLOCK });
    expect(m.get('y')).toMatchObject({ file: a, offset: BLOCK, length: 5 });
  });

  test('status labels and progress', () => {
    const base = { id: 'x', path: '/a', size: 100, hashed: 0, sent: 0 };
    const fmt = (v: number) => `${v} B`;
    expect(fileStatusLabel({ ...base, status: 'queued' }, fmt)).toBe('Waiting for a free slot');
    expect(fileStatusLabel({ ...base, status: 'hashing', hashed: 34 }, fmt)).toBe('Hashing 34%');
    expect(fileStatusLabel({ ...base, status: 'uploading', sent: 50 }, fmt)).toBe('50 B / 100 B');
    expect(fileStatusLabel({ ...base, status: 'done' }, fmt)).toBe('Already stored');
    expect(fileStatusLabel({ ...base, status: 'done', sent: 100 }, fmt)).toBe('✓');
    expect(fileProgress({ ...base, status: 'uploading', hashed: 100, sent: 50 })).toBe(0.75);
  });
});

// ── engine runs against a fake API ─────────────────────────────────────────

interface Harness {
  jobs: Map<string, UploadJob>;
  puts: string[];
  plans: UploadPlanRequest[];
  commits: number;
  sleeps: number[];
  toasts: string[];
  quota: unknown[];
  conflictsAsked: string[][];
  refreshes: number;
  undos: string[];
}

function harness(overrides: Partial<EngineApi> & { conflictChoice?: 'keep-both' | 'replace' | null; usage?: { usedBytes: number; quotaBytes: number } } = {}) {
  const h: Harness = { jobs: new Map(), puts: [], plans: [], commits: 0, sleeps: [], toasts: [], quota: [], conflictsAsked: [], refreshes: 0, undos: [] };
  const action = { id: 'act1', kind: 'upload' as const, summary: 'Uploaded', status: 'committed' as const, headCommitId: 'vc_2', baseCommitId: 'vc_1', createdAt: '', itemCount: 1, bytesDelta: 1, undoable: true };
  const api: EngineApi = {
    plan: async (_ws, req) => {
      h.plans.push(req);
      const all = req.files.flatMap((f) => f.blocks);
      return { uploadId: `up${h.plans.length}`, actionId: 'act1', missing: [...new Set(all)].slice(0, 1), renamed: [], expiresAt: '' };
    },
    putBlock: async (_ws, _id, sha) => {
      h.puts.push(sha);
    },
    commit: async () => {
      h.commits++;
      return { action, files: 1 };
    },
    abort: async () => {},
    ...overrides,
  };
  const engine = createUploadEngine({
    api,
    hasher: () => createMainThreadHasher(2),
    store: () => ({
      addUploadJob: (j) => h.jobs.set(j.id, j),
      updateUploadJob: (jid, patch) => h.jobs.set(jid, { ...h.jobs.get(jid)!, ...patch }),
      refresh: () => void h.refreshes++,
      toast: (t) => {
        h.toasts.push(t.message);
        return 't';
      },
      registerUndo: (e) => void h.undos.push(e.actionId),
    }),
    askConflict: async (paths) => {
      h.conflictsAsked.push(paths);
      const choice = overrides.conflictChoice === undefined ? 'keep-both' : overrides.conflictChoice;
      return choice ? { choice, all: false } : null;
    },
    showQuota: (d) => void h.quota.push(d),
    usage: async () => overrides.usage ?? null,
    sleep: async (ms) => void h.sleeps.push(ms),
    flushMs: 1,
    backoffMs: () => 1,
  });
  return { h, engine };
}

async function settle(engine: { isBusy(): boolean }) {
  for (let i = 0; i < 500 && engine.isBusy(); i++) await new Promise((r) => setTimeout(r, 2));
  await new Promise((r) => setTimeout(r, 5));
}

describe('upload engine', () => {
  test('plan → PUT only missing → commit; one job, per-file done, dedup reads "already stored"', async () => {
    const { h, engine } = harness();
    const jobId = engine.start({ workspaceId: 'ws', basePath: '/', sources: { files: [{ file: file('a.txt', 'aaa'), relPath: 'a.txt' }, { file: file('b.txt', 'bbb'), relPath: 'b.txt' }], dirs: [] } })!;
    await settle(engine);
    const job = h.jobs.get(jobId)!;
    expect(job.status).toBe('done');
    expect(job.actionId).toBe('act1');
    expect(h.plans).toHaveLength(1);
    expect(h.plans[0].conflict).toBe('ask');
    expect(h.plans[0].files.map((f) => f.path)).toEqual(['/a.txt', '/b.txt']);
    expect(h.puts).toEqual([await sha256Hex(enc('aaa'))]);
    expect(h.commits).toBe(1);
    expect(job.files.every((f) => f.status === 'done')).toBe(true);
    expect(job.files.find((f) => f.path === '/a.txt')!.sent).toBe(3);
    expect(job.files.find((f) => f.path === '/b.txt')!.sent).toBe(0);
    expect(h.refreshes).toBe(1);
  });

  test('conflict → ask → keep both, renamed paths shown', async () => {
    let calls = 0;
    const { h, engine } = harness({
      plan: async (_ws, req) => {
        h.plans.push(req);
        calls++;
        if (calls === 1) throw new ApiError(409, 'conflict', 'exists', { conflicts: ['/a.txt'] });
        return { uploadId: 'u', actionId: 'act1', missing: [], renamed: [{ from: '/a.txt', to: '/a (1).txt' }], expiresAt: '' };
      },
    });
    const jobId = engine.start({ workspaceId: 'ws', basePath: '/', sources: { files: [{ file: file('a.txt', 'aaa'), relPath: 'a.txt' }], dirs: [] } })!;
    await settle(engine);
    expect(h.conflictsAsked).toEqual([['/a.txt']]);
    expect(h.plans.map((p) => p.conflict)).toEqual(['ask', 'keep-both']);
    expect(h.jobs.get(jobId)!.files[0].path).toBe('/a (1).txt');
    expect(h.jobs.get(jobId)!.status).toBe('done');
  });

  test('declining the conflict cancels without sending bytes', async () => {
    const { h, engine } = harness({
      conflictChoice: null,
      plan: async () => {
        throw new ApiError(409, 'conflict', 'exists', { conflicts: ['/a.txt'] });
      },
    });
    const jobId = engine.start({ workspaceId: 'ws', basePath: '/', sources: { files: [{ file: file('a.txt', 'a'), relPath: 'a.txt' }], dirs: [] } })!;
    await settle(engine);
    expect(h.jobs.get(jobId)!.status).toBe('cancelled');
    expect(h.puts).toEqual([]);
  });

  test('413 opens the quota dialog; nothing is sent', async () => {
    const { h, engine } = harness({
      plan: async () => {
        throw new ApiError(413, 'quota_exceeded', 'over', { usedBytes: 9, quotaBytes: 10, requestedBytes: 5, overBytes: 4 });
      },
    });
    const jobId = engine.start({ workspaceId: 'ws', basePath: '/', sources: { files: [{ file: file('a.txt', 'aaaaa'), relPath: 'a.txt' }], dirs: [] } })!;
    await settle(engine);
    expect(h.quota).toEqual([{ usedBytes: 9, quotaBytes: 10, requestedBytes: 5, overBytes: 4 }]);
    expect(h.jobs.get(jobId)!.status).toBe('error');
    expect(h.puts).toEqual([]);
    expect(h.toasts).toEqual([]);
  });

  test('no client-side quota refusal: the server decides (a replace needs no extra room)', async () => {
    const { h, engine } = harness({ usage: { usedBytes: 8, quotaBytes: 10 } });
    const jobId = engine.start({ workspaceId: 'ws', basePath: '/', sources: { files: [{ file: file('a.txt', 'aaaaa'), relPath: 'a.txt' }], dirs: [] } })!;
    await settle(engine);
    expect(h.quota).toEqual([]);
    expect(h.plans).toHaveLength(1);
    expect(h.jobs.get(jobId)!.status).toBe('done');
    // A finished upload is on the undo stack, so ⌘Z undoes it rather than an older action.
    expect(h.undos).toEqual(['act1']);
  });

  test('a storage-side 413 (no quota numbers) fails with its own message, not an empty quota dialog', async () => {
    const { h, engine } = harness({
      plan: async () => {
        throw new ApiError(413, 'quota_exceeded', 'History is full; remove checkpoints or wait for old versions to expire.', { limit: 'stored_bytes' });
      },
    });
    const jobId = engine.start({ workspaceId: 'ws', basePath: '/', sources: { files: [{ file: file('a.txt', 'a'), relPath: 'a.txt' }], dirs: [] } })!;
    await settle(engine);
    expect(h.quota).toEqual([]);
    expect(h.jobs.get(jobId)!.status).toBe('error');
    expect(h.toasts[0]).toContain('History is full');
  });

  test('a conflict found at commit time asks, aborts the stale plan and plans again', async () => {
    let commits = 0;
    const aborted: string[] = [];
    const { h, engine } = harness({
      commit: async (_ws, id) => {
        if (++commits === 1) throw new ApiError(409, 'conflict', 'created since', { conflicts: ['/n.txt'], uploadId: id });
        return { action: { id: 'act1', kind: 'upload', summary: 'Uploaded n (1).txt', status: 'committed', headCommitId: 'vc_2', baseCommitId: 'vc_1', createdAt: '', itemCount: 1, bytesDelta: 1, undoable: true }, files: 1 };
      },
      abort: async (_ws, id) => void aborted.push(id),
    });
    const jobId = engine.start({ workspaceId: 'ws', basePath: '/', sources: { files: [{ file: file('n.txt', 'nnn'), relPath: 'n.txt' }], dirs: [] } })!;
    await settle(engine);
    expect(h.conflictsAsked).toEqual([['/n.txt']]);
    expect(aborted).toEqual(['up1']);
    expect(h.plans.map((p) => p.conflict)).toEqual(['ask', 'keep-both']);
    expect(h.jobs.get(jobId)!.status).toBe('done');
  });

  test('two jobs run at once: a small drop does not wait behind a big one', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const bigUploads = new Set<string>();
    const { h, engine } = harness({
      plan: async (_ws, req) => {
        h.plans.push(req);
        const id = `up${h.plans.length}`;
        if (req.files.some((f) => f.path === '/big.bin')) bigUploads.add(id);
        return { uploadId: id, actionId: 'act1', missing: [], renamed: [], expiresAt: '' };
      },
      commit: async (_ws, id) => {
        if (bigUploads.has(id)) await gate;
        h.commits++;
        return { action: { id: 'act1', kind: 'upload', summary: '', status: 'committed', headCommitId: null, baseCommitId: null, createdAt: '', itemCount: 1, bytesDelta: 0, undoable: false }, files: 1 };
      },
    });
    const big = engine.start({ workspaceId: 'ws', basePath: '/', sources: { files: [{ file: file('big.bin', 'b'.repeat(64)), relPath: 'big.bin' }], dirs: [] } })!;
    const small = engine.start({ workspaceId: 'ws', basePath: '/', sources: { files: [{ file: file('note.txt', 'n'), relPath: 'note.txt' }], dirs: [] } })!;
    for (let i = 0; i < 200 && h.jobs.get(small)!.status !== 'done'; i++) await new Promise((r) => setTimeout(r, 2));
    expect(h.jobs.get(small)!.status).toBe('done');
    expect(h.jobs.get(big)!.status).toBe('active');
    release();
    await settle(engine);
    expect(h.jobs.get(big)!.status).toBe('done');
  });

  test('rate-limited plan waits Retry-After; flaky block PUTs retry; commit re-sends missing', async () => {
    let planCalls = 0;
    let putFails = 2;
    let commitCalls = 0;
    const { h, engine } = harness({
      plan: async (_ws, req) => {
        h.plans.push(req);
        if (++planCalls === 1) throw new ApiError(429, 'rate_limited', 'busy', {}, 7);
        return { uploadId: 'u', actionId: 'act1', missing: req.files[0].blocks, renamed: [], expiresAt: '' };
      },
      putBlock: async (_ws, _u, sha) => {
        if (putFails-- > 0) throw new ApiError(503, 'upstream_unavailable', 'down');
        h.puts.push(sha);
      },
      commit: async () => {
        if (++commitCalls === 1) throw new ApiError(409, 'conflict', 'missing', { missing: ['__unknown__'] });
        return { action: { id: 'act1', kind: 'upload', summary: '', status: 'committed', headCommitId: null, baseCommitId: null, createdAt: '', itemCount: 1, bytesDelta: 0, undoable: true }, files: 1 };
      },
    });
    const jobId = engine.start({ workspaceId: 'ws', basePath: '/x', sources: { files: [{ file: file('a.bin', 'zz'), relPath: 'a.bin' }], dirs: ['empty'] } })!;
    await settle(engine);
    expect(h.sleeps[0]).toBe(7000);
    expect(h.puts).toHaveLength(1);
    expect(commitCalls).toBe(2);
    expect(h.plans[1].dirs).toEqual(['/x/empty']);
    expect(h.jobs.get(jobId)!.status).toBe('done');
  });

  test('a hard failure marks the job failed and retry re-runs it', async () => {
    let fail = true;
    const { h, engine } = harness({
      commit: async () => {
        if (fail) throw new ApiError(500, 'internal', 'boom');
        return { action: { id: 'act1', kind: 'upload', summary: '', status: 'committed', headCommitId: null, baseCommitId: null, createdAt: '', itemCount: 1, bytesDelta: 0, undoable: true }, files: 1 };
      },
    });
    const jobId = engine.start({ workspaceId: 'ws', basePath: '/', sources: { files: [{ file: file('a.txt', 'q'), relPath: 'a.txt' }], dirs: [] } })!;
    await settle(engine);
    expect(h.jobs.get(jobId)!.status).toBe('error');
    expect(h.jobs.get(jobId)!.files[0]).toMatchObject({ status: 'error', error: 'boom' });
    expect(h.toasts[0]).toContain('boom');
    fail = false;
    engine.retry(jobId);
    await settle(engine);
    expect(h.jobs.get(jobId)!.status).toBe('done');
    expect(h.plans.at(-1)!.actionId).toBe('act1');
  });

  test('reset (sign-out) cancels every job; a commit that lands afterwards registers no undo, toast or refresh', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { h, engine } = harness({
      commit: async () => {
        await gate;
        h.commits++;
        return { action: { id: 'act1', kind: 'upload', summary: 'Uploaded', status: 'committed', headCommitId: 'vc_2', baseCommitId: 'vc_1', createdAt: '', itemCount: 1, bytesDelta: 1, undoable: true }, files: 1 };
      },
    });
    engine.start({ workspaceId: 'ws', basePath: '/', sources: { files: [{ file: file('a.txt', 'aaa'), relPath: 'a.txt' }], dirs: [] } });
    const queued = engine.start({ workspaceId: 'ws', basePath: '/', sources: { files: [{ file: file('b.txt', 'b'), relPath: 'b.txt' }], dirs: [] } });
    const third = engine.start({ workspaceId: 'ws', basePath: '/', sources: { files: [{ file: file('c.txt', 'c'), relPath: 'c.txt' }], dirs: [] } })!;
    for (let i = 0; i < 100 && h.plans.length < 2; i++) await new Promise((r) => setTimeout(r, 2));
    engine.reset();
    release();
    await settle(engine);
    expect(queued).not.toBeNull();
    expect(h.undos).toEqual([]);
    expect(h.refreshes).toBe(0);
    expect(h.toasts).toEqual([]);
    expect(engine.isBusy()).toBe(false);
    expect(engine.info(third)).toBeNull(); // forgotten
  });

  test('nothing valid to send → no job', () => {
    const { h, engine } = harness();
    expect(engine.start({ workspaceId: 'ws', basePath: '/', sources: { files: [], dirs: [] } })).toBeNull();
    expect(h.jobs.size).toBe(0);
  });
});

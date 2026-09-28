// Driver-agnostic VolumeStore contract. The SAME suite runs against the
// emulator (always) and against Platinum (only when PT_API_URL, PT_TOKEN and
// VOLUMES_CONFORMANCE=1 are set). If both pass, the emulator is faithful for
// everything the app relies on.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { BLOCK_SIZE } from '@volumes/shared';
import { type VolumeStore, VolumeStoreError } from './types';

export interface ContractTarget {
  store: VolumeStore;
  /** unique volume name prefix for this run (e.g. vx-test-<ulid>) */
  prefix: string;
  cleanup?: () => Promise<void>;
}

const enc = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export async function readAll(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = s.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export async function expectStoreError(p: Promise<unknown>, code: VolumeStoreError['code']): Promise<VolumeStoreError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(VolumeStoreError);
    expect((e as VolumeStoreError).code).toBe(code);
    return e as VolumeStoreError;
  }
  throw new Error(`expected store error ${code}, got success`);
}

/** Uploads bytes through the block protocol (plan → PUT missing → commit). */
export async function uploadBytes(store: VolumeStore, volId: string, path: string, data: Uint8Array, overwrite = true) {
  const blocks: { sha: string; bytes: Uint8Array }[] = [];
  for (let off = 0; off < data.length; off += BLOCK_SIZE) {
    const chunk = data.subarray(off, Math.min(off + BLOCK_SIZE, data.length));
    blocks.push({ sha: sha(chunk), bytes: chunk });
  }
  const plan = await store.planUpload(volId, { files: [{ path, size: data.length, blocks: blocks.map((b) => b.sha) }], dirs: [], overwrite });
  const missing = new Set(plan.missing);
  let sent = 0;
  for (const b of blocks) {
    if (!missing.has(b.sha)) continue;
    missing.delete(b.sha);
    await store.putBlock(volId, plan.uploadId, b.sha, b.bytes);
    sent++;
  }
  const r = await store.commitUpload(volId, plan.uploadId);
  return { plan, commit: r, sent };
}

export function storeContract(label: string, make: () => Promise<ContractTarget>): void {
  describe(`VolumeStore contract: ${label}`, () => {
    let t: ContractTarget;
    let store: VolumeStore;
    let n = 0;
    const created: string[] = [];
    const fresh = async () => {
      const v = await store.openVolume(`${t.prefix}-${++n}`);
      created.push(v.id);
      return v;
    };

    beforeAll(async () => {
      t = await make();
      store = t.store;
    });
    afterAll(async () => {
      for (const id of created) await store.deleteVolume(id, { missingOk: true }).catch(() => {});
      await t.cleanup?.();
    });

    test('openVolume is idempotent and case-insensitive; getVolume by id', async () => {
      const a = await fresh();
      expect(a.id).toMatch(/^vol_[0-9A-Z]{26}$/);
      expect(a.headCommitId).toMatch(/^vc_[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(a.logicalBytes).toBe(0);
      const again = await store.openVolume(a.name);
      expect(again.id).toBe(a.id);
      const upper = await store.openVolume(a.name.toUpperCase());
      expect(upper.id).toBe(a.id);
      expect((await store.getVolume(a.id)).name).toBe(a.name);
      await expectStoreError(store.createVolume(a.name), 'volume_exists');
    });

    test('write → stat → read; version / etag; noop rewrite', async () => {
      const v = await fresh();
      const w = await store.write(v.id, '/docs/hello.txt', enc('hello world'));
      expect(w.outcome).toBe('fast');
      expect(w.commitId).toBe(w.headCommitId);
      const st = await store.stat(v.id, '/docs/hello.txt');
      expect(st.type).toBe('file');
      expect(st.size).toBe(11);
      expect(st.name).toBe('hello.txt');
      expect(st.version).toBeTruthy();
      expect(`vc_${st.version}`).toBe(w.commitId);
      expect(st.commitId).toBe(w.commitId);
      const dir = await store.stat(v.id, '/docs');
      expect(dir.type).toBe('dir');
      const r = await store.read(v.id, '/docs/hello.txt');
      expect(r.status).toBe(200);
      expect(r.contentLength).toBe(11);
      expect(r.etag).toBe(`"${st.version}"`);
      expect(new TextDecoder().decode(await readAll(r.body))).toBe('hello world');
      const again = await store.write(v.id, '/docs/hello.txt', enc('hello world'));
      expect(again.outcome).toBe('noop');
      expect(again.commitId).toBe(w.commitId);
      await expectStoreError(store.write(v.id, '/docs/hello.txt', enc('x'), { overwrite: false }), 'path_exists');
      expect((await store.getVolume(v.id)).logicalBytes).toBeGreaterThan(0);
    });

    test('Range reads: 206, open-ended, suffix, 416', async () => {
      const v = await fresh();
      await store.write(v.id, '/r.bin', enc('0123456789abcdef'));
      await store.write(v.id, '/empty.txt', new Uint8Array(0));
      const a = await store.read(v.id, '/r.bin', { range: 'bytes=0-9' });
      expect(a.status).toBe(206);
      expect(a.contentLength).toBe(10);
      expect(a.contentRange).toBe('bytes 0-9/16');
      expect(new TextDecoder().decode(await readAll(a.body))).toBe('0123456789');
      const b = await store.read(v.id, '/r.bin', { range: 'bytes=10-' });
      expect(new TextDecoder().decode(await readAll(b.body))).toBe('abcdef');
      const c = await store.read(v.id, '/r.bin', { range: 'bytes=-3' });
      expect(new TextDecoder().decode(await readAll(c.body))).toBe('def');
      await expectStoreError(store.read(v.id, '/r.bin', { range: 'bytes=99-' }), 'range_not_satisfiable');
      await expectStoreError(store.read(v.id, '/empty.txt', { range: 'bytes=0-0' }), 'range_not_satisfiable');
      const e = await store.read(v.id, '/empty.txt');
      expect(e.contentLength).toBe(0);
      expect((await readAll(e.body)).length).toBe(0);
    });

    test('read / list errors', async () => {
      const v = await fresh();
      await store.write(v.id, '/d/f.txt', enc('x'));
      await expectStoreError(store.read(v.id, '/nope.txt'), 'path_not_found');
      await expectStoreError(store.read(v.id, '/d'), 'not_a_file');
      await expectStoreError(store.list(v.id, '/d/f.txt'), 'not_a_directory');
      await expectStoreError(store.list(v.id, '/missing'), 'path_not_found');
      await expectStoreError(store.stat(v.id, '/f.txt', { at: 'vc_00000000000000000000000000' }), 'not_found');
      await expectStoreError(store.getVolume('vol_00000000000000000000000000'), 'volume_not_found');
    });

    test('list: direct children, recursive, byte order, paging', async () => {
      const v = await fresh();
      for (const p of ['/b.txt', '/a.txt', '/dir/x.txt', '/dir/sub/y.txt', '/c.txt']) await store.write(v.id, p, enc(p));
      const top = await store.list(v.id, '/');
      expect(top.entries.map((e) => e.path)).toEqual(['/a.txt', '/b.txt', '/c.txt', '/dir']);
      expect(top.entries.find((e) => e.path === '/dir')!.type).toBe('dir');
      expect(top.entries.find((e) => e.path === '/a.txt')!.name).toBe('a.txt');
      expect(top.commitId).toBe((await store.getVolume(v.id)).headCommitId);
      const rec = await store.list(v.id, '/dir', { recursive: true });
      expect(rec.entries.map((e) => e.path)).toEqual(['/dir/sub', '/dir/sub/y.txt', '/dir/x.txt']);
      const p1 = await store.list(v.id, '/', { limit: 2 });
      expect(p1.entries.length).toBe(2);
      expect(p1.nextCursor).toBe('/b.txt');
      const p2 = await store.list(v.id, '/', { limit: 2, cursor: p1.nextCursor! });
      expect(p2.entries.map((e) => e.path)).toEqual(['/c.txt', '/dir']);
      expect(p2.nextCursor).toBeNull();
    });

    test('copy / move / remove semantics', async () => {
      const v = await fresh();
      await store.write(v.id, '/src/a.txt', enc('A'));
      await store.write(v.id, '/src/deep/b.txt', enc('B'));
      await expectStoreError(store.copy(v.id, '/src', '/copy'), 'bad_request');
      const cp = await store.copy(v.id, '/src', '/copy', { recursive: true });
      expect(cp.outcome).toBe('fast');
      expect(new TextDecoder().decode(await readAll((await store.read(v.id, '/copy/deep/b.txt')).body))).toBe('B');
      const cstat = await store.stat(v.id, '/copy/a.txt');
      expect(`vc_${cstat.version}`).toBe(cp.commitId);
      await expectStoreError(store.copy(v.id, '/src/a.txt', '/copy/a.txt'), 'path_exists');
      await store.copy(v.id, '/src/a.txt', '/copy/a.txt', { overwrite: true });
      const mv = await store.move(v.id, '/src/a.txt', '/moved/a2.txt');
      expect(mv.outcome).toBe('fast');
      await expectStoreError(store.stat(v.id, '/src/a.txt'), 'path_not_found');
      expect((await store.stat(v.id, '/moved/a2.txt')).size).toBe(1);
      await expectStoreError(store.move(v.id, '/nope', '/x'), 'path_not_found');
      await expectStoreError(store.move(v.id, '/copy/a.txt', '/moved/a2.txt'), 'path_exists');
      await expectStoreError(store.remove(v.id, '/copy'), 'directory_not_empty');
      const rm = await store.remove(v.id, '/copy', { recursive: true });
      expect(rm.outcome).toBe('fast');
      await expectStoreError(store.stat(v.id, '/copy'), 'path_not_found');
      await expectStoreError(store.remove(v.id, '/copy', { recursive: true }), 'path_not_found');
    });

    test('block upload: plan → missing → PUT → commit; dedup; incomplete commit; path_exists', async () => {
      const v = await fresh();
      const big = new Uint8Array(BLOCK_SIZE + 10);
      for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) % 251;
      const first = await uploadBytes(store, v.id, '/up/big.bin', big);
      expect(first.plan.uploadId).toMatch(/^vu_/);
      expect(first.sent).toBe(2);
      expect(first.commit.files).toBe(1);
      expect(first.commit.outcome).toBe('fast');
      const back = await readAll((await store.read(v.id, '/up/big.bin')).body);
      expect(sha(back)).toBe(sha(big));
      // Same bytes again at another path: every block is already stored.
      const second = await uploadBytes(store, v.id, '/up/copy.bin', big);
      expect(second.plan.missing).toEqual([]);
      expect(second.sent).toBe(0);
      // overwrite:false against an existing path
      const e = await expectStoreError(
        store.planUpload(v.id, { files: [{ path: '/up/big.bin', size: 1, blocks: [sha(enc('z'))] }], dirs: [], overwrite: false }),
        'path_exists',
      );
      expect(e.extra.paths).toEqual(['/up/big.bin']);
      // incomplete commit reports missing blocks
      const data = enc(`fresh ${Math.random()}`);
      const plan = await store.planUpload(v.id, { files: [{ path: '/up/new.txt', size: data.length, blocks: [sha(data)] }], dirs: ['/up/empty'], overwrite: true });
      expect(plan.missing).toEqual([sha(data)]);
      const inc = await expectStoreError(store.commitUpload(v.id, plan.uploadId), 'bad_request');
      expect(inc.extra.missing).toEqual([sha(data)]);
      await expectStoreError(store.putBlock(v.id, plan.uploadId, sha(data), enc('wrong bytes!')), 'bad_request');
      await store.putBlock(v.id, plan.uploadId, sha(data), data);
      const done = await store.commitUpload(v.id, plan.uploadId);
      expect(done.files).toBe(1);
      expect((await store.stat(v.id, '/up/empty')).type).toBe('dir');
      await expectStoreError(store.commitUpload(v.id, plan.uploadId), 'not_found');
      // folder-only plan
      const folder = await store.planUpload(v.id, { files: [], dirs: ['/only/dir'], overwrite: false });
      expect(folder.missing).toEqual([]);
      await store.commitUpload(v.id, folder.uploadId);
      expect((await store.stat(v.id, '/only/dir')).type).toBe('dir');
      // bad plans
      await expectStoreError(
        store.planUpload(v.id, { files: [{ path: '/x', size: 5, blocks: [] }], dirs: [], overwrite: true }),
        'bad_request',
      );
    });

    test('time travel: reads `at` an older commit; history newest first with paging', async () => {
      const v = await fresh();
      const c1 = await store.write(v.id, '/t.txt', enc('one'));
      const c2 = await store.write(v.id, '/t.txt', enc('two'));
      const c3 = await store.write(v.id, '/u.txt', enc('three'));
      expect(new TextDecoder().decode(await readAll((await store.read(v.id, '/t.txt', { at: c1.commitId })).body))).toBe('one');
      expect((await store.read(v.id, '/t.txt', { at: c1.commitId })).commitId).toBe(c1.commitId);
      await expectStoreError(store.stat(v.id, '/u.txt', { at: c2.commitId }), 'path_not_found');
      expect((await store.list(v.id, '/', { at: c1.commitId })).entries.map((e) => e.path)).toEqual(['/t.txt']);
      const h = await store.history(v.id, { limit: 2 });
      expect(h.commits.map((c) => c.id)).toEqual([c3.commitId, c2.commitId]);
      expect(h.commits[0].kind).toBe('api');
      expect(h.commits[0].parentId).toBe(c2.commitId);
      expect(h.nextCursor).toBe(c2.commitId);
      const h2 = await store.history(v.id, { limit: 50, before: h.nextCursor! });
      expect(h2.commits[0].id).toBe(c1.commitId);
      expect(h2.commits[h2.commits.length - 1].kind).toBe('init');
      const gc = await store.getCommit(v.id, c2.commitId);
      expect(gc.id).toBe(c2.commitId);
      expect(gc.overwritten).toEqual([]);
      expect((await store.getCommit(v.id, 'head')).id).toBe(c3.commitId);
    });

    test('tags: put / move / list / at-read / delete', async () => {
      const v = await fresh();
      const c1 = await store.write(v.id, '/f.txt', enc('v1'));
      await store.write(v.id, '/f.txt', enc('v2'));
      const t = await store.putTag(v.id, 'cp-first', c1.commitId);
      expect(t.commitId).toBe(c1.commitId);
      expect(new TextDecoder().decode(await readAll((await store.read(v.id, '/f.txt', { at: 'cp-first' })).body))).toBe('v1');
      expect((await store.getCommit(v.id, c1.commitId)).tags).toContain('cp-first');
      const moved = await store.putTag(v.id, 'cp-first');
      expect(moved.commitId).toBe((await store.getVolume(v.id)).headCommitId);
      await store.putTag(v.id, 'ln-link');
      expect((await store.listTags(v.id)).map((x) => x.name)).toEqual(['cp-first', 'ln-link']);
      await store.deleteTag(v.id, 'ln-link');
      await expectStoreError(store.deleteTag(v.id, 'ln-link'), 'not_found');
      await expectStoreError(store.read(v.id, '/f.txt', { at: 'ln-link' }), 'not_found');
    });

    test('restoreVolume: new head of kind restore with the old image; undoable', async () => {
      const v = await fresh();
      const c1 = await store.write(v.id, '/a.txt', enc('a1'));
      await store.write(v.id, '/b.txt', enc('b'));
      const before = (await store.getVolume(v.id)).headCommitId;
      const r = await store.restoreVolume(v.id, c1.commitId);
      expect(r.kind).toBe('restore');
      expect((await store.getVolume(v.id)).headCommitId).toBe(r.id);
      await expectStoreError(store.stat(v.id, '/b.txt'), 'path_not_found');
      const vstat = await store.stat(v.id, '/a.txt');
      expect(`vc_${vstat.version}`).toBe(c1.commitId); // versions survive restore (byte copy)
      const undo = await store.restoreVolume(v.id, before);
      expect(undo.kind).toBe('restore');
      expect((await store.stat(v.id, '/b.txt')).size).toBe(1);
    });

    test('forkVolume at an older commit; deleteVolume', async () => {
      const v = await fresh();
      const c1 = await store.write(v.id, '/keep.txt', enc('k'));
      await store.write(v.id, '/later.txt', enc('l'));
      const f = await store.forkVolume(v.id, `${t.prefix}-fork-${++n}`, c1.commitId);
      created.push(f.id);
      expect(f.forkedFrom).toEqual({ volumeId: v.id, commitId: c1.commitId });
      expect((await store.list(f.id, '/')).entries.map((e) => e.path)).toEqual(['/keep.txt']);
      const fh = await store.history(f.id);
      expect(fh.commits[0].kind).toBe('fork');
      await store.write(f.id, '/fork-only.txt', enc('f'));
      await expectStoreError(store.stat(v.id, '/fork-only.txt'), 'path_not_found');
      await store.deleteVolume(f.id);
      await expectStoreError(store.getVolume(f.id), 'volume_not_found');
      await store.deleteVolume(f.id, { missingOk: true });
      await expectStoreError(store.deleteVolume(f.id), 'volume_not_found');
    });

    test('limits()', async () => {
      const l = await store.limits();
      expect(l.maxVolumes).toBeGreaterThan(0);
      expect(l.usedVolumes).toBeGreaterThanOrEqual(1);
      expect(l.maxTagsPerVolume).toBe(100);
      expect(l.maxUploadsInFlight).toBe(4);
    });
  });
}

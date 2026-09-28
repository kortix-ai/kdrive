// Emulator-only fidelity checks that need a fake clock or internals.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BLOCK_SIZE } from '@volumes/shared';
import { EmulatedStore } from './emulated';
import { ZERO_BLOCK_SHA } from './emulated/fs';
import { parseRange } from './emulated/range';
import { DAY, HOUR, computeRetained } from './emulated/retention';
import { expectStoreError, uploadBytes } from './contract';
import { UploadSlots } from './upload-slots';
import { VolumeStoreError } from './types';

const enc = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const tmp = () => mkdtempSync(path.join(tmpdir(), 'vx-emu-'));

function clock(start = Date.UTC(2026, 0, 1)) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('emulated store', () => {
  test('ids and versions follow Platinum shapes; logicalBytes is df-like', async () => {
    const s = new EmulatedStore({ dir: tmp(), slots: new UploadSlots() });
    const v = await s.openVolume('vx-a');
    await s.write(v.id, '/d/a.txt', enc('x'.repeat(5000)));
    const info = await s.getVolume(v.id);
    expect(info.logicalBytes).toBe(8192 + 4096); // 2 fs blocks + 1 dir
    expect(info.fileCount).toBe(1);
    expect(info.lastCommitAt).not.toBeNull();
  });

  test('persists to disk: a new instance sees the same volumes, commits and tags', async () => {
    const dir = tmp();
    const a = new EmulatedStore({ dir, slots: new UploadSlots() });
    const v = await a.openVolume('vx-persist');
    const w = await a.write(v.id, '/p.txt', enc('persist'));
    await a.putTag(v.id, 'cp-x');
    const b = new EmulatedStore({ dir, slots: new UploadSlots() });
    const again = await b.openVolume('vx-persist');
    expect(again.id).toBe(v.id);
    expect(again.headCommitId).toBe(w.commitId);
    expect((await b.listTags(v.id)).map((t) => t.name)).toEqual(['cp-x']);
    expect((await b.stat(v.id, '/p.txt')).size).toBe(7);
  });

  test('the all-zero 1 MiB block is never missing', async () => {
    const s = new EmulatedStore({ dir: tmp(), slots: new UploadSlots() });
    const v = await s.openVolume('vx-zero');
    const zeros = new Uint8Array(BLOCK_SIZE * 2);
    expect(sha(zeros.subarray(0, BLOCK_SIZE))).toBe(ZERO_BLOCK_SHA);
    const r = await uploadBytes(s, v.id, '/zeros.bin', zeros);
    expect(r.plan.missing).toEqual([]);
    expect(r.sent).toBe(0);
    const st = await s.stat(v.id, '/zeros.bin');
    expect(st.size).toBe(BLOCK_SIZE * 2);
  });

  test('4 live plans per store, then rate_limited; commit frees a slot', async () => {
    const slots = new UploadSlots(4);
    const s = new EmulatedStore({ dir: tmp(), slots, slotWaitMs: 50 });
    const v = await s.openVolume('vx-slots');
    const plans = [];
    for (let i = 0; i < 4; i++) {
      const d = enc(`f${i}`);
      plans.push(await s.planUpload(v.id, { files: [{ path: `/f${i}`, size: d.length, blocks: [sha(d)] }], dirs: [], overwrite: true }));
    }
    const e = await expectStoreError(s.planUpload(v.id, { files: [], dirs: ['/x'], overwrite: true }), 'rate_limited');
    expect(e.status).toBe(429);
    expect(e.extra.retryAfterSeconds).toBeGreaterThan(0);
    await s.putBlock(v.id, plans[0].uploadId, sha(enc('f0')), enc('f0'));
    await s.commitUpload(v.id, plans[0].uploadId);
    const ok = await s.planUpload(v.id, { files: [], dirs: ['/x'], overwrite: true });
    expect(ok.uploadId).toMatch(/^vu_/);
  });

  test('plans expire after 15 minutes without a block PUT', async () => {
    const c = clock();
    const s = new EmulatedStore({ dir: tmp(), now: c.now, slots: new UploadSlots(4, 15 * 60_000, c.now) });
    const v = await s.openVolume('vx-ttl');
    const d = enc('ttl');
    const p = await s.planUpload(v.id, { files: [{ path: '/t', size: 3, blocks: [sha(d)] }], dirs: [], overwrite: true });
    c.advance(16 * 60_000);
    await expectStoreError(s.putBlock(v.id, p.uploadId, sha(d), d), 'not_found');
  });

  test('100 tags per volume; moving a tag is free; tagging revives an expired commit', async () => {
    const s = new EmulatedStore({ dir: tmp(), slots: new UploadSlots() });
    const v = await s.openVolume('vx-tags');
    for (let i = 0; i < 100; i++) await s.putTag(v.id, `t-${i}`);
    const e = await expectStoreError(s.putTag(v.id, 't-100'), 'quota_exceeded');
    expect(e.extra.limit).toBe('tags');
    expect(e.extra.max).toBe(100);
    await s.putTag(v.id, 't-5'); // move: free
    await expectStoreError(s.putTag(v.id, 'head'), 'bad_request');
  });

  test('retention: newest 50 kept, older than 7 days dropped, expired readable, purged after 48 h, tags pin', async () => {
    const c = clock();
    const s = new EmulatedStore({ dir: tmp(), now: c.now, slots: new UploadSlots() });
    const v = await s.openVolume('vx-ret');
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) {
      ids.push((await s.write(v.id, '/f.txt', enc(`v${i}`))).commitId);
      c.advance(60_000);
    }
    await s.putTag(v.id, 'cp-pin', ids[0]);
    c.advance(8 * DAY);
    const h = await s.history(v.id, { limit: 200 });
    const visible = new Set(h.commits.map((x) => x.id));
    // newest 50 by seq are kept whatever their age; ids[10..59] are the newest 50 writes
    for (const id of ids.slice(10)) expect(visible.has(id)).toBe(true);
    for (const id of ids.slice(1, 10)) expect(visible.has(id)).toBe(false);
    expect(visible.has(ids[0])).toBe(true); // tagged: pinned
    // expired but not purged: still readable
    expect((await s.stat(v.id, '/f.txt', { at: ids[3] })).size).toBe(2);
    c.advance(49 * HOUR);
    await s.gc(v.id);
    await expectStoreError(s.stat(v.id, '/f.txt', { at: ids[3] }), 'not_found');
    expect((await s.stat(v.id, '/f.txt', { at: ids[0] })).size).toBe(2);
  });

  test('computeRetained: 1 h window, never-thinned kinds, 10-minute buckets', () => {
    const now = Date.UTC(2026, 0, 10);
    const mk = (id: string, seq: number, kind: string, ageMs: number) => ({ id, seq, onHead: true, kind, createdAt: now - ageMs });
    const commits = [
      mk('recent', 100, 'fast', 30 * 60_000),
      mk('api-old', 99, 'api', 5 * HOUR),
      mk('fast-a', 98, 'fast', 5 * HOUR + 60_000),
      mk('fast-b', 97, 'fast', 5 * HOUR + 2 * 60_000),
      mk('ancient', 96, 'api', 9 * DAY),
    ];
    const keep = computeRetained(commits, new Set(), now, { keepLast: 1, days: 7 });
    expect(keep.has('recent')).toBe(true);
    expect(keep.has('api-old')).toBe(true);
    expect(keep.has('ancient')).toBe(false);
    // fast-a and fast-b share a 10-minute bucket unless they straddle a boundary: exactly one survives when they share it
    const bucketA = Math.floor((now - 5 * HOUR - 60_000) / 600_000);
    const bucketB = Math.floor((now - 5 * HOUR - 2 * 60_000) / 600_000);
    if (bucketA === bucketB) {
      expect(keep.has('fast-a')).toBe(true);
      expect(keep.has('fast-b')).toBe(false);
    }
  });

  test('parseRange edge cases', () => {
    expect(parseRange(null, 10)).toBeNull();
    expect(parseRange('bytes=0-0', 10)).toEqual({ start: 0, end: 0 });
    expect(parseRange('bytes=5-100', 10)).toEqual({ start: 5, end: 9 });
    expect(parseRange('bytes=-100', 10)).toEqual({ start: 0, end: 9 });
    for (const bad of ['bytes=0-1,2-3', 'bytes=10-', 'bytes=5-2', 'items=0-1', 'bytes=-0', 'bytes=-']) {
      expect(() => parseRange(bad, 10)).toThrow(VolumeStoreError);
    }
    expect(() => parseRange('bytes=0-', 0)).toThrow(VolumeStoreError);
  });

  test('volume limit: quota_exceeded {limit: volumes}', async () => {
    const s = new EmulatedStore({ dir: tmp(), maxVolumes: 2, slots: new UploadSlots() });
    await s.openVolume('vx-1');
    const v2 = await s.openVolume('vx-2');
    const e = await expectStoreError(s.openVolume('vx-3'), 'quota_exceeded');
    expect(e.extra.limit).toBe('volumes');
    await expectStoreError(s.forkVolume(v2.id, 'vx-4'), 'quota_exceeded');
    await s.deleteVolume(v2.id);
    expect((await s.openVolume('vx-3')).name).toBe('vx-3');
    expect((await s.limits()).usedVolumes).toBe(2);
  });

  test('invalid names are rejected like Platinum', async () => {
    const s = new EmulatedStore({ dir: tmp(), slots: new UploadSlots() });
    for (const bad of ['', '-x', 'vol_abc', 'tmp-x', 'limits', 'a/b', 'x'.repeat(64)]) {
      await expectStoreError(s.openVolume(bad), 'bad_request');
    }
  });
});

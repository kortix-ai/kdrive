// End to end: every folder an operation creates takes 4 KiB of the quota,
// missing parents included, and an estimate is re-checked against the head the
// mutation actually lands on. Each test is one way past the quota that used to
// work: a move / copy / upload / restore into a deep new path, a chained copy,
// and an upload plan that went stale before its commit.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { quotaReservations, userSettings } from '../../src/db/schema';
import { blocksOf, enc } from '../helpers';
import { endWorld, freshWorld, head, ls, upload, user, type User } from './kit';

beforeEach(async () => {
  await freshWorld();
});
afterEach(endWorld);
afterAll(endWorld);

const KB40 = 40 * 1024;
const big = (c: string) => c.repeat(KB40);
const api = (u: Pick<User, 'ws'>, p: string) => `/api/w/${u.ws}${p}`;
const setQuota = (u: User, bytes: number) => db.update(userSettings).set({ quotaBytes: bytes }).where(eq(userSettings.userId, u.userId));
const usedBytes = async (u: User): Promise<number> => (await u.client.get('/api/me/usage')).body.usedBytes as number;
/** "/p0/p1/…/p{n-1}" */
const deep = (prefix: string, n: number) => '/' + Array.from({ length: n }, (_, i) => `${prefix}${i}`).join('/');

/** Plans an upload and sends its blocks, without committing. */
async function planAndSend(u: User, files: Record<string, string>, opts: { dirs?: string[]; conflict?: 'replace' | 'ask' | 'keep-both' } = {}) {
  const list = Object.entries(files).map(([path, s]) => ({ path, bytes: enc(s) }));
  const plan = await u.client.post(api(u, '/uploads'), {
    files: list.map((f) => ({ path: f.path, size: f.bytes.length, blocks: blocksOf(f.bytes).map((b) => b.sha) })),
    dirs: opts.dirs ?? [],
    conflict: opts.conflict ?? 'replace',
  });
  if (plan.status !== 200) return { plan, uploadId: '' };
  const missing = new Set<string>(plan.body.missing);
  for (const f of list) {
    for (const b of blocksOf(f.bytes)) {
      if (!missing.delete(b.sha)) continue;
      const r = await u.client.raw('PUT', api(u, `/uploads/${plan.body.uploadId}/blocks/${b.sha}`), {
        body: b.bytes as unknown as BodyInit,
        headers: { 'content-type': 'application/octet-stream' },
      });
      if (r.status !== 204) throw new Error(`block ${r.status}`);
    }
  }
  return { plan, uploadId: plan.body.uploadId as string };
}

const commit = (u: User, id: string) => u.client.post(api(u, `/uploads/${id}/commit`), {});

describe('missing parent folders count', () => {
  test('a move into a new deep path with a full quota is refused', async () => {
    const a = await user('fp-move@test.local');
    await upload(a, { '/f.txt': 'x' });
    expect(await usedBytes(a)).toBe(4096);
    await setQuota(a, 4096);
    const r = await a.client.post(api(a, '/files/move'), { items: [{ from: '/f.txt', to: `${deep('m', 100)}/f.txt` }] });
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('quota_exceeded');
    expect(r.body.error.details.requestedBytes).toBe(100 * 4096);
    expect(await usedBytes(a)).toBe(4096);
    // A rename creates no folder: still fine at a full quota.
    expect((await a.client.post(api(a, '/files/move'), { items: [{ from: '/f.txt', to: '/g.txt' }] })).status).toBe(200);
    expect(await usedBytes(a)).toBe(4096);
    expect(await ls(a)).toEqual(['g.txt']);
  });

  test('a move into a folder that an earlier item of the same move takes away is counted', async () => {
    const a = await user('fp-move-chain@test.local');
    await upload(a, { '/f.txt': 'x' }, { dirs: ['/d'] });
    expect(await usedBytes(a)).toBe(8192);
    await setQuota(a, 8192);
    // /d goes to /e, then /f.txt goes into /d, which must be created again.
    const r = await a.client.post(api(a, '/files/move'), {
      items: [
        { from: '/d', to: '/e' },
        { from: '/f.txt', to: '/d/g.txt' },
      ],
    });
    expect(r.status).toBe(413);
    expect(await usedBytes(a)).toBe(8192);
  });

  test('a copy into a new deep path counts the new folders', async () => {
    const a = await user('fp-copy@test.local');
    await upload(a, { '/f.txt': 'x' });
    await setQuota(a, 8192); // room for the copied file only
    const r = await a.client.post(api(a, '/files/copy'), { items: [{ from: '/f.txt', to: `${deep('c', 100)}/f.txt` }] });
    expect(r.status).toBe(413);
    expect(r.body.error.details.requestedBytes).toBe(4096 + 100 * 4096);
    expect(await usedBytes(a)).toBe(4096);
    expect((await a.client.post(api(a, '/files/copy'), { items: [{ from: '/f.txt', to: '/copy.txt' }] })).status).toBe(200);
    expect(await usedBytes(a)).toBe(8192);
  });

  test('an upload plan for a file in a new deep path counts the new folders', async () => {
    const a = await user('fp-up-file@test.local');
    await setQuota(a, 4096);
    const bytes = enc('x');
    const r = await a.client.post(api(a, '/uploads'), {
      files: [{ path: `${deep('u', 100)}/f.txt`, size: 1, blocks: blocksOf(bytes).map((b) => b.sha) }],
      dirs: [],
      conflict: 'replace',
    });
    expect(r.status).toBe(413);
    expect(r.body.error.details.requestedBytes).toBe(4096 + 100 * 4096);
    // One file at the root fits exactly.
    await upload(a, { '/f.txt': 'x' });
    expect(await usedBytes(a)).toBe(4096);
  });

  test('an upload plan of a deep folder counts its missing parents', async () => {
    const a = await user('fp-up-dir@test.local');
    await setQuota(a, 4096);
    const r = await a.client.post(api(a, '/uploads'), { files: [], dirs: [deep('d', 100)], conflict: 'replace' });
    expect(r.status).toBe(413);
    expect(r.body.error.details.requestedBytes).toBe(100 * 4096);
    expect((await a.client.post(api(a, '/uploads'), { files: [], dirs: ['/d0/d1'], conflict: 'replace' })).status).toBe(413);
    await upload(a, {}, { dirs: ['/one'] });
    expect(await usedBytes(a)).toBe(4096);
  });

  test('a file restore whose parent folders were deleted counts them', async () => {
    const a = await user('fp-restore@test.local');
    const path = `${deep('r', 100)}/f.txt`;
    await upload(a, { [path]: 'x' });
    const at = await head(a);
    expect((await a.client.post(api(a, '/files/delete'), { paths: ['/r0'] })).status).toBe(200);
    expect(await usedBytes(a)).toBe(0);
    await setQuota(a, 4096); // the file fits, its 100 folders do not
    const r = await a.client.post(api(a, '/restore'), { scope: 'file', path, at });
    expect(r.status).toBe(413);
    expect(r.body.error.details.requestedBytes).toBe(4096 + 100 * 4096);
    expect(await usedBytes(a)).toBe(0);
    await setQuota(a, 101 * 4096);
    expect((await a.client.post(api(a, '/restore'), { scope: 'file', path, at })).status).toBe(200);
    expect(await usedBytes(a)).toBe(101 * 4096);
  });
});

describe('chained copies', () => {
  test('a copy whose items feed each other is counted as the sequence runs', async () => {
    const a = await user('fp-chain@test.local');
    await upload(a, { '/big': big('b'), '/s1': '1', '/s2': '2', '/s3': '3', '/s4': '4', '/s5': '5' });
    const used = await usedBytes(a);
    expect(used).toBe(KB40 + 5 * 4096);
    const items = [
      { from: '/big', to: '/s1' },
      { from: '/s1', to: '/s2' },
      { from: '/s2', to: '/s3' },
      { from: '/s3', to: '/s4' },
      { from: '/s4', to: '/s5' },
    ];
    const growth = 5 * (KB40 - 4096);
    await setQuota(a, used + growth - 4096);
    const r = await a.client.post(api(a, '/files/copy'), { items, overwrite: true });
    expect(r.status).toBe(413);
    expect(await usedBytes(a)).toBe(used);
    // With exactly enough room it goes through and lands on the quota.
    await setQuota(a, used + growth);
    expect((await a.client.post(api(a, '/files/copy'), { items, overwrite: true })).status).toBe(200);
    expect(await usedBytes(a)).toBe(used + growth);
    expect(await db.select().from(quotaReservations)).toHaveLength(0);
  });
});

describe('stale upload plans', () => {
  test('a replace plan whose target moved away is re-counted at commit', async () => {
    const a = await user('fp-stale@test.local');
    await upload(a, { '/x.bin': big('x') });
    await setQuota(a, KB40);
    const { plan, uploadId } = await planAndSend(a, { '/x.bin': big('y') });
    expect(plan.status).toBe(200); // replacing a 40 KiB file with 40 KiB grows nothing
    expect((await a.client.post(api(a, '/files/move'), { items: [{ from: '/x.bin', to: '/moved.bin' }] })).status).toBe(200);
    const c = await commit(a, uploadId);
    expect(c.status).toBe(413);
    expect(c.body.error.code).toBe('quota_exceeded');
    expect(await usedBytes(a)).toBe(KB40);
    expect(await ls(a)).toEqual(['moved.bin']);
  });

  test('a user over quota cannot grow through repeated stale replace plans', async () => {
    const a = await user('fp-stale-over@test.local');
    await upload(a, { '/x.bin': big('x'), '/y.bin': big('y') });
    await setQuota(a, KB40); // already over
    for (let i = 0; i < 3; i++) {
      const { plan, uploadId } = await planAndSend(a, { '/x.bin': big(String(i)) });
      expect(plan.status).toBe(200);
      expect((await a.client.post(api(a, '/files/move'), { items: [{ from: '/x.bin', to: `/away${i}.bin` }] })).status).toBe(200);
      expect((await commit(a, uploadId)).status).toBe(413);
      // Put a file back at /x.bin for the next round (replacing nothing is still refused: over quota).
      await a.client.post(api(a, '/files/move'), { items: [{ from: `/away${i}.bin`, to: '/x.bin' }] });
    }
    expect(await usedBytes(a)).toBe(2 * KB40);
  });

  test('folders that existed at plan time and were deleted since are counted at commit', async () => {
    const a = await user('fp-stale-dirs@test.local');
    const dirs = Array.from({ length: 50 }, (_, i) => `/e${i}`);
    await upload(a, {}, { dirs });
    const { plan, uploadId } = await planAndSend(a, {}, { dirs });
    expect(plan.status).toBe(200);
    expect((await a.client.post(api(a, '/files/delete'), { paths: dirs })).status).toBe(200);
    expect(await usedBytes(a)).toBe(0);
    await setQuota(a, 0);
    const c = await commit(a, uploadId);
    expect(c.status).toBe(413);
    expect(await usedBytes(a)).toBe(0);
    expect(await ls(a)).toEqual([]);
  });

  test('a stale plan that still fits commits, and one that shrank needs no room', async () => {
    const a = await user('fp-stale-ok@test.local');
    await upload(a, { '/x.bin': big('x'), '/other.bin': 'o' });
    const used = await usedBytes(a);
    await setQuota(a, used);
    const { uploadId } = await planAndSend(a, { '/x.bin': 'small now' });
    // The head moves (a rename elsewhere) but the plan grows nothing.
    expect((await a.client.post(api(a, '/files/move'), { items: [{ from: '/other.bin', to: '/renamed.bin' }] })).status).toBe(200);
    expect((await commit(a, uploadId)).status).toBe(200);
    expect(await usedBytes(a)).toBe(used - KB40 + 4096);
  });
});

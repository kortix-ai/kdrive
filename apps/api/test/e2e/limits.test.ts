// End to end: quota and capacity hold when requests race. Every scenario sends
// its competing requests at once (Promise.all) with the storage mutation
// slowed down, so without a user-wide (or org-wide) reservation each request
// would pass its check against the same usage and all of them would land.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { quotaReservations, userSettings, workspaces } from '../../src/db/schema';
import type { EmulatedStore } from '../../src/storage/emulated';
import { newId } from '../../src/lib/ids';
import { signInWithWorkspace, type Json } from '../helpers';
import { endWorld, freshWorld, head, ls, upload, user, type User } from './kit';

let store: EmulatedStore;
beforeEach(async () => {
  store = await freshWorld();
});
afterEach(endWorld);
afterAll(endWorld);

const KB40 = 40 * 1024;
const big = (c: string) => c.repeat(KB40);
const api = (u: Pick<User, 'ws'>, p: string) => `/api/w/${u.ws}${p}`;
const setQuota = (u: User, bytes: number) => db.update(userSettings).set({ quotaBytes: bytes }).where(eq(userSettings.userId, u.userId));
const usedBytes = async (u: User): Promise<number> => (await u.client.get('/api/me/usage')).body.usedBytes as number;
const statuses = (rs: { status: number }[]) => rs.map((r) => r.status).sort();

/** Delays one storage method so that concurrent requests all pass their checks before any lands. */
function slow(name: keyof EmulatedStore, ms = 120): void {
  const s = store as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const orig = s[name as string].bind(store);
  s[name as string] = async (...a: unknown[]) => {
    await Bun.sleep(ms);
    return orig(...a);
  };
}

/** A second workspace of the same user (its own volume, same quota). */
async function second(u: User, name = 'Second'): Promise<User> {
  const r = await u.client.post('/api/workspaces', { name });
  if (r.status !== 201) throw new Error(`create ${r.status}: ${r.text}`);
  return { ...u, ws: r.body.workspace.id as string };
}

const liveReservations = () => db.select().from(quotaReservations);

describe('workspace allowance and org slots', () => {
  test('concurrent creates cannot pass the per-user workspace cap', async () => {
    const a = await user('lim-cap@test.local'); // 1 of 5
    slow('openVolume');
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => a.client.post('/api/workspaces', { name: `W${i}` })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(4);
    for (const r of rs.filter((r) => r.status !== 201)) expect(r.body.error.code).toBe('storage_limit');
    expect((await a.client.get('/api/workspaces')).body.workspaces).toHaveLength(5);
    expect(await liveReservations()).toHaveLength(0);
  });

  test('concurrent creates by different people cannot take the slot kept for newcomers', async () => {
    store = await freshWorld({ maxVolumes: 4 }); // 4 volumes, 1 kept free: 3 usable
    const a = await user('lim-org-a@test.local'); // volume 1
    const b = await user('lim-org-b@test.local'); // volume 2
    slow('openVolume');
    const rs = await Promise.all([
      a.client.post('/api/workspaces', { name: 'A2' }),
      b.client.post('/api/workspaces', { name: 'B2' }),
      a.client.post('/api/workspaces', { name: 'A3' }),
      b.client.post('/api/workspaces', { name: 'B3' }),
    ]);
    expect(statuses(rs)).toEqual([201, 409, 409, 409]);
    expect((await store.limits()).usedVolumes).toBe(3);
    // The kept slot still gives a brand-new person a drive.
    const newcomer = await signInWithWorkspace('lim-org-new@test.local');
    expect(newcomer.me.workspaces).toHaveLength(1);
    expect(await liveReservations()).toHaveLength(0);
  });

  test('concurrent duplicates cannot pass the per-user workspace cap', async () => {
    const a = await user('lim-dupcap@test.local');
    for (let i = 2; i <= 4; i++) await second(a, `W${i}`); // 4 of 5
    slow('forkVolume');
    const rs = await Promise.all([
      a.client.post(`/api/workspaces/${a.ws}/duplicate`, { name: 'Copy 1' }),
      a.client.post(`/api/workspaces/${a.ws}/duplicate`, { name: 'Copy 2' }),
    ]);
    expect(statuses(rs)).toEqual([201, 409]);
    expect((await a.client.get('/api/workspaces')).body.workspaces).toHaveLength(5);
  });

  test('concurrent duplicates cannot pass the storage quota', async () => {
    const a = await user('lim-dupq@test.local');
    await upload(a, { '/big.bin': big('d') });
    const used = await usedBytes(a);
    await setQuota(a, used * 2 + 2048); // room for one fork, not two
    slow('forkVolume');
    const rs = await Promise.all([
      a.client.post(`/api/workspaces/${a.ws}/duplicate`, { name: 'Copy 1' }),
      a.client.post(`/api/workspaces/${a.ws}/duplicate`, { name: 'Copy 2' }),
    ]);
    expect(statuses(rs)).toEqual([201, 413]);
    expect(await usedBytes(a)).toBeLessThanOrEqual(used * 2 + 2048);
    expect(await liveReservations()).toHaveLength(0);
  });
});

describe('storage quota across workspaces', () => {
  test('copies in two workspaces cannot both take the last bytes', async () => {
    const a = await user('lim-copy@test.local');
    const a2 = await second(a);
    await upload(a, { '/a.bin': big('a') });
    await upload(a2, { '/b.bin': big('b') });
    const used = await usedBytes(a);
    await setQuota(a, used + KB40 + 2048);
    slow('copy');
    const rs = await Promise.all([
      a.client.post(api(a, '/files/copy'), { items: [{ from: '/a.bin', to: '/a2.bin' }] }),
      a.client.post(api(a2, '/files/copy'), { items: [{ from: '/b.bin', to: '/b2.bin' }] }),
    ]);
    expect(statuses(rs)).toEqual([200, 413]);
    expect(await usedBytes(a)).toBe(used + KB40);
    expect(await liveReservations()).toHaveLength(0);
  });

  test('an upload plan and a copy in another workspace cannot both take the last bytes', async () => {
    const a = await user('lim-mix@test.local');
    const a2 = await second(a);
    await upload(a2, { '/b.bin': big('b') });
    const used = await usedBytes(a);
    await setQuota(a, used + KB40 + 2048);
    slow('copy');
    slow('planUpload');
    const { blocksOf, enc } = await import('../helpers');
    const bytes = enc(big('p'));
    const rs = await Promise.all([
      a2.client.post(api(a2, '/files/copy'), { items: [{ from: '/b.bin', to: '/b2.bin' }] }),
      a.client.post(api(a, '/uploads'), {
        files: [{ path: '/p.bin', size: bytes.length, blocks: blocksOf(bytes).map((b) => b.sha) }],
        dirs: [],
        conflict: 'replace',
      }),
    ]);
    expect(statuses(rs)).toEqual([200, 413]);
  });

  test('folder creation counts against the quota (4 KiB a folder, missing parents included)', async () => {
    const a = await user('lim-dir@test.local');
    await setQuota(a, 4096);
    expect((await a.client.post(api(a, '/folders'), { path: '/one' })).status).toBe(200);
    const second = await a.client.post(api(a, '/folders'), { path: '/two' });
    expect(second.status).toBe(413);
    expect(second.body.error.code).toBe('quota_exceeded');
    await setQuota(a, 3 * 4096);
    // /x, /x/y and /x/y/z are three new folders: 12 KiB on top of 4 KiB used.
    expect((await a.client.post(api(a, '/folders'), { path: '/x/y/z' })).status).toBe(413);
    expect(await ls(a)).toEqual(['one/']);
    expect(await usedBytes(a)).toBe(4096);
  });

  test('folders created at once in two workspaces cannot both take the last bytes', async () => {
    const a = await user('lim-dir2@test.local');
    const a2 = await second(a);
    await setQuota(a, 4096);
    slow('commitUpload');
    const rs = await Promise.all([a.client.post(api(a, '/folders'), { path: '/one' }), a2.client.post(api(a2, '/folders'), { path: '/two' })]);
    expect(statuses(rs)).toEqual([200, 413]);
    expect(await usedBytes(a)).toBe(4096);
  });
});

describe('restores across workspaces', () => {
  /** A 40 KiB file uploaded then deleted; returns the commit that still has it. */
  async function deletedFile(u: User, path: string, fill: string): Promise<string> {
    await upload(u, { [path]: big(fill) });
    const at = await head(u);
    const d = await u.client.post(api(u, '/files/delete'), { paths: [path] });
    if (d.status !== 200) throw new Error(`delete ${d.status}`);
    return at;
  }

  test('path restores in two workspaces cannot both take the last bytes', async () => {
    const a = await user('lim-rp@test.local');
    const a2 = await second(a);
    const at1 = await deletedFile(a, '/f.bin', 'x');
    const at2 = await deletedFile(a2, '/g.bin', 'y');
    const used = await usedBytes(a);
    await setQuota(a, used + KB40 + 2048);
    slow('planUpload');
    const rs = await Promise.all([
      a.client.post(api(a, '/restore'), { scope: 'file', path: '/f.bin', at: at1 }),
      a2.client.post(api(a2, '/restore'), { scope: 'file', path: '/g.bin', at: at2 }),
    ]);
    expect(statuses(rs)).toEqual([200, 413]);
    expect(await usedBytes(a)).toBe(used + KB40);
    expect(await liveReservations()).toHaveLength(0);
  });

  test('renamed-file restores in two workspaces cannot both take the last bytes', async () => {
    const a = await user('lim-rr@test.local');
    const a2 = await second(a);
    const renamed = async (u: User, fill: string) => {
      await upload(u, { '/old.bin': big(fill) });
      const at = await head(u);
      await u.client.post(api(u, '/files/move'), { items: [{ from: '/old.bin', to: '/new.bin' }] });
      await upload(u, { '/new.bin': 'tiny' }); // 4 KiB now; the old version is 40 KiB
      return at;
    };
    const at1 = await renamed(a, 'r');
    const at2 = await renamed(a2, 's');
    const used = await usedBytes(a);
    const growth = KB40 - 4096;
    await setQuota(a, used + growth + 2048);
    slow('planUpload');
    const rs = await Promise.all([
      a.client.post(api(a, '/restore'), { scope: 'file', path: '/new.bin', at: at1 }),
      a2.client.post(api(a2, '/restore'), { scope: 'file', path: '/new.bin', at: at2 }),
    ]);
    expect(statuses(rs)).toEqual([200, 413]);
    expect(await usedBytes(a)).toBe(used + growth);
  });

  test('whole-drive restores in two workspaces cannot both take the last bytes', async () => {
    const a = await user('lim-rd@test.local');
    const a2 = await second(a);
    const at1 = await deletedFile(a, '/f.bin', 'x');
    const at2 = await deletedFile(a2, '/g.bin', 'y');
    const used = await usedBytes(a);
    await setQuota(a, used + KB40 + 2048);
    slow('restoreVolume');
    const rs = await Promise.all([
      a.client.post(api(a, '/restore'), { scope: 'drive', at: at1 }),
      a2.client.post(api(a2, '/restore'), { scope: 'drive', at: at2 }),
    ]);
    expect(statuses(rs)).toEqual([200, 413]);
    expect(await usedBytes(a)).toBe(used + KB40);
    expect(await liveReservations()).toHaveLength(0);
  });
});

describe('reservations', () => {
  const reserveRow = (u: User, bytes: number, expiresInMs: number) =>
    db.insert(quotaReservations).values({
      id: newId(),
      scope: 'user',
      userId: u.userId,
      kind: 'copy',
      bytes,
      expiresAt: new Date(Date.now() + expiresInMs),
    });

  test('bytes held by a mutation running in another API process count; expired holds do not', async () => {
    const a = await user('lim-held@test.local');
    await upload(a, { '/a.bin': big('a') });
    const used = await usedBytes(a);
    await setQuota(a, used + KB40 + 2048);
    await reserveRow(a, KB40, 60_000); // another process is copying 40 KiB right now
    const r = await a.client.post(api(a, '/files/copy'), { items: [{ from: '/a.bin', to: '/a2.bin' }] });
    expect(r.status).toBe(413);
    expect((r.body as Json).error.details.usedBytes).toBe(used + KB40);
    await db.delete(quotaReservations);
    await reserveRow(a, KB40, -1000); // that process died: its hold lapsed
    expect((await a.client.post(api(a, '/files/copy'), { items: [{ from: '/a.bin', to: '/a2.bin' }] })).status).toBe(200);
  });

  test('more requests at once than database connections: no deadlock, and exactly what fits passes', async () => {
    const a = await user('lim-many@test.local');
    const used = await usedBytes(a);
    await setQuota(a, used + 3 * KB40 + 2048); // room for three
    slow('planUpload', 50);
    const { blocksOf, enc } = await import('../helpers');
    const rs = await Promise.all(
      Array.from({ length: 16 }, (_, i) => {
        const bytes = enc(big(String.fromCharCode(97 + i)));
        return a.client.post(api(a, '/uploads'), {
          files: [{ path: `/f${i}.bin`, size: bytes.length, blocks: blocksOf(bytes).map((b) => b.sha) }],
          dirs: [],
          conflict: 'replace',
        });
      }),
    );
    expect(rs.filter((r) => r.status === 200)).toHaveLength(3);
    expect(rs.filter((r) => r.status === 413)).toHaveLength(13);
    expect(await liveReservations()).toHaveLength(0);
  });

  test('a failed mutation gives its reservation back', async () => {
    const a = await user('lim-fail@test.local');
    await upload(a, { '/a.bin': big('a') });
    const { VolumeStoreError } = await import('../../src/storage/types');
    store.injectFault('copy', { error: new VolumeStoreError(500, 'internal', 'boom') });
    const r = await a.client.post(api(a, '/files/copy'), { items: [{ from: '/a.bin', to: '/a2.bin' }] });
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(await liveReservations()).toHaveLength(0);
    const rows = await db.select().from(workspaces).where(eq(workspaces.userId, a.userId));
    expect(rows).toHaveLength(1);
  });
});

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { BLOCK_SIZE } from '@volumes/shared';
import { db } from '../db/client';
import { actionPaths, auditEvents, checkpoints } from '../db/schema';
import { getStore, setStoreForTests } from '../storage';
import type { VolumeStore } from '../storage/types';
import { uploadFile } from '../../test/helpers';
import { cleanWorld, freshWorld, countingStore, kitFor, mkdir, move, readText, remove, te, upload } from './versioning-test-kit';

const ls = async (vol: string, at?: string) => (await getStore().list(vol, '/', { at, recursive: true })).entries.map((e) => e.path);

describe('restore', () => {
  beforeEach(() => freshWorld());
  afterEach(cleanWorld);

  test('restoring the oldest version adds a 4th version and sends no block bytes', async () => {
    const k = await kitFor('r1@test.local');
    const v1 = await upload(k, { '/report.txt': 'version one' });
    await upload(k, { '/report.txt': 'version two!' });
    await upload(k, { '/report.txt': 'version three' });
    const spy = countingStore();
    try {
      const r = await k.client.post(`/api/w/${k.ws}/restore`, { scope: 'file', path: '/report.txt', at: v1.action.headCommitId });
      expect(r.status).toBe(200);
      expect(r.body.action.kind).toBe('restore.file');
      expect(r.body.action.status).toBe('committed');
      expect(r.body.action.undoable).toBe(true);
      expect(r.body.action.summary).toMatch(/^Restored report\.txt to /);
      expect(spy.counts.missing).toBe(0);
      expect(spy.counts.putBlock).toBe(0);
    } finally {
      spy.restore();
    }
    expect(await readText(k, '/report.txt')).toBe('version one');
    const v = await k.client.get(`/api/w/${k.ws}/versions?path=/report.txt`);
    expect(v.body.versions).toHaveLength(4);
    expect(v.body.versions[0]).toMatchObject({ op: 'restored', isCurrent: true, size: 11 });
    const [ev] = await db.select().from(auditEvents).where(eq(auditEvents.kind, 'restore.file'));
    expect(ev.target).toBe('/report.txt');
    // restoring to the version it already has is a noop
    const again = await k.client.post(`/api/w/${k.ws}/restore`, { scope: 'file', path: '/report.txt', at: v1.action.headCommitId });
    expect(again.body.action.status).toBe('noop');
  });

  test('file restore with unknown block list hashes the bytes on the server (multi-block)', async () => {
    const k = await kitFor('r2@test.local');
    const big = new Uint8Array(BLOCK_SIZE * 2 + 17).map((_, i) => i % 251);
    await getStore().write(k.vol, '/raw.bin', big); // outside the ledger: no block list recorded
    const at = (await getStore().getVolume(k.vol)).headCommitId;
    await getStore().write(k.vol, '/raw.bin', te('small now'));
    const spy = countingStore();
    try {
      const r = await k.client.post(`/api/w/${k.ws}/restore`, { scope: 'file', path: '/raw.bin', at });
      expect(r.status).toBe(200);
      expect(spy.counts.putBlock).toBe(0); // blocks still in the store
    } finally {
      spy.restore();
    }
    const back = new Uint8Array(await new Response((await getStore().read(k.vol, '/raw.bin')).body).arrayBuffer());
    expect(back.length).toBe(big.length);
    expect(back.every((b, i) => b === big[i])).toBe(true);
    const rows = await db.select().from(actionPaths).where(eq(actionPaths.path, '/raw.bin'));
    expect(rows.find((x) => x.op === 'restored')!.blockHashes).toHaveLength(3);
  });

  test('folder restore brings files back and removes files added later, in one timeline entry', async () => {
    const k = await kitFor('r3@test.local');
    const v1 = await upload(k, { '/Reports/q1.txt': 'q1', '/Reports/q2.txt': 'q2', '/Reports/sub/deep.txt': 'deep' }, { dirs: ['/Reports/empty'] });
    await upload(k, { '/Reports/q1.txt': 'q1 edited' });
    await remove(k, '/Reports/q2.txt');
    await upload(k, { '/Reports/later.txt': 'later', '/Reports/newdir/n.txt': 'n' });
    await upload(k, { '/outside.txt': 'untouched' });
    const before = (await k.client.get(`/api/w/${k.ws}/timeline`)).body.entries.length;

    const r = await k.client.post(`/api/w/${k.ws}/restore`, { scope: 'folder', path: '/Reports', at: v1.action.headCommitId });
    expect(r.status).toBe(200);
    expect(r.body.action.kind).toBe('restore.folder');
    expect((await ls(k.vol)).sort()).toEqual(
      ['/Reports', '/Reports/empty', '/Reports/q1.txt', '/Reports/q2.txt', '/Reports/sub', '/Reports/sub/deep.txt', '/outside.txt'].sort(),
    );
    expect(await readText(k, '/Reports/q1.txt')).toBe('q1');
    const tl = (await k.client.get(`/api/w/${k.ws}/timeline`)).body.entries;
    expect(tl.length).toBe(before + 1);
    expect(tl[0].kind).toBe('restore.folder');
    const rows = await db.select().from(actionPaths).where(eq(actionPaths.actionId, r.body.action.id));
    const deleted = rows.filter((x) => x.op === 'deleted').map((x) => x.path).sort();
    expect(deleted).toEqual(['/Reports/later.txt', '/Reports/newdir']);

    // and the restore itself undoes
    const u = await k.client.post(`/api/w/${k.ws}/actions/${r.body.action.id}/undo`, {});
    expect(u.status).toBe(200);
    expect(u.body.action.kind).toBe('undo');
    expect((await ls(k.vol)).sort()).toEqual(
      ['/Reports', '/Reports/q1.txt', '/Reports/later.txt', '/Reports/newdir', '/Reports/newdir/n.txt', '/Reports/sub', '/Reports/sub/deep.txt', '/Reports/empty', '/outside.txt'].sort(),
    );
    expect(await readText(k, '/Reports/q1.txt')).toBe('q1 edited');
  });

  test('restoring a path that did not exist then is 404; bad scope input is 400', async () => {
    const k = await kitFor('r4@test.local');
    const v1 = await upload(k, { '/a.txt': 'a' });
    await upload(k, { '/b.txt': 'b' });
    const r = await k.client.post(`/api/w/${k.ws}/restore`, { scope: 'file', path: '/b.txt', at: v1.action.headCommitId });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('path_not_found');
    expect((await k.client.post(`/api/w/${k.ws}/restore`, { scope: 'file', at: 'head' })).status).toBe(400);
    expect((await k.client.post(`/api/w/${k.ws}/restore`, { scope: 'file', path: '/a.txt', at: 'vc_01ARZ3NDEKTSV4RRFFQ69G5FAV' })).status).toBe(410);
  });
});

describe('undo', () => {
  beforeEach(() => freshWorld());
  afterEach(cleanWorld);

  test('undo of a delete brings the file back with the same bytes; undo is itself undoable', async () => {
    const k = await kitFor('u1@test.local');
    await upload(k, { '/keep/me.txt': 'precious bytes' });
    const del = await remove(k, '/keep/me.txt');
    const spy = countingStore();
    let undoId = '';
    try {
      const u = await k.client.post(`/api/w/${k.ws}/actions/${del.action.id}/undo`, {});
      expect(u.status).toBe(200);
      expect(u.body.action.kind).toBe('undo');
      expect(u.body.action.summary).toBe('Undid: Deleted me.txt');
      undoId = u.body.action.id;
      expect(spy.counts.putBlock).toBe(0);
    } finally {
      spy.restore();
    }
    expect(await readText(k, '/keep/me.txt')).toBe('precious bytes');
    const redo = await k.client.post(`/api/w/${k.ws}/actions/${undoId}/undo`, {});
    expect(redo.status).toBe(200);
    expect(await getStore().stat(k.vol, '/keep/me.txt').catch(() => null)).toBeNull();
  });

  test('undo of upload (new + replaced), rename, and new folder', async () => {
    const k = await kitFor('u2@test.local');
    await upload(k, { '/a.txt': 'old a' });
    const up = await upload(k, { '/a.txt': 'new a', '/b.txt': 'b' });
    await k.client.post(`/api/w/${k.ws}/actions/${up.action.id}/undo`, {});
    expect(await readText(k, '/a.txt')).toBe('old a');
    expect((await ls(k.vol)).sort()).toEqual(['/a.txt']);

    const ren = await move(k, '/a.txt', '/c.txt');
    await k.client.post(`/api/w/${k.ws}/actions/${ren.action.id}/undo`, {});
    expect((await ls(k.vol)).sort()).toEqual(['/a.txt']);
    expect(await readText(k, '/a.txt')).toBe('old a');

    const mk = await mkdir(k, '/New');
    await k.client.post(`/api/w/${k.ws}/actions/${mk.action.id}/undo`, {});
    expect(await ls(k.vol)).toEqual(['/a.txt']);
  });

  test('unknown, failed or foreign actions cannot be undone', async () => {
    const k = await kitFor('u3@test.local');
    const other = await kitFor('u3-other@test.local');
    const up = await upload(other, { '/x.txt': 'x' });
    expect((await k.client.post(`/api/w/${k.ws}/actions/${up.action.id}/undo`, {})).status).toBe(404);
    expect((await k.client.post(`/api/w/${k.ws}/actions/01arz3ndektsv4rrffq69g5fav/undo`, {})).status).toBe(404);
    // CSRF: undo needs a same-origin JSON request
    const bad = await k.client.raw('POST', `/api/w/${other.ws}/actions/${up.action.id}/undo`, { body: '{}', headers: { 'content-type': 'text/plain' } });
    expect(bad.status).toBe(403);
  });
});

describe('drive restore', () => {
  beforeEach(() => freshWorld());
  afterEach(cleanWorld);

  test('creates a Before restore checkpoint; undoing it brings back the pre-restore state', async () => {
    const k = await kitFor('d1@test.local');
    const v1 = await upload(k, { '/a.txt': 'a1' });
    await upload(k, { '/a.txt': 'a2', '/b.txt': 'b' });
    await remove(k, '/a.txt');
    const pre = (await getStore().getVolume(k.vol)).headCommitId;

    const r = await k.client.post(`/api/w/${k.ws}/restore`, { scope: 'drive', at: v1.action.headCommitId });
    expect(r.status).toBe(200);
    expect(r.body.action.kind).toBe('restore.drive');
    expect(r.body.checkpoint.name).toBe('Before restore');
    expect(r.body.checkpointSkipped).toBeUndefined();
    expect(await ls(k.vol)).toEqual(['/a.txt']);
    expect(await readText(k, '/a.txt')).toBe('a1');
    const [cp] = await db.select().from(checkpoints).where(eq(checkpoints.id, r.body.checkpoint.id));
    expect(cp.commitId).toBe(pre);
    expect(cp.auto).toBe(true);
    const list = await k.client.get(`/api/w/${k.ws}/checkpoints`);
    expect(list.body.checkpoints[0]).toMatchObject({ auto: true, commitId: pre });

    const u = await k.client.post(`/api/w/${k.ws}/actions/${r.body.action.id}/undo`, {});
    expect(u.status).toBe(200);
    expect(u.body.action.summary).toMatch(/^Undid: Restored the drive/);
    expect(await ls(k.vol)).toEqual(['/b.txt']);
    // no second checkpoint for the undo
    expect((await k.client.get(`/api/w/${k.ws}/checkpoints`)).body.checkpoints).toHaveLength(1);
    const tl = (await k.client.get(`/api/w/${k.ws}/timeline`)).body.entries;
    expect(tl[0].kind).toBe('restore.drive');
    expect(tl[1].checkpoints).toEqual([]);
    expect(tl.find((e: any) => e.commitId === pre).checkpoints[0].name).toMatch(/^Before restore/);
  });

  test('a full tag budget skips the checkpoint but still restores', async () => {
    const k = await kitFor('d2@test.local');
    const v1 = await upload(k, { '/a.txt': 'a' });
    await upload(k, { '/b.txt': 'b' });
    for (let i = 0; i < 100; i++) await getStore().putTag(k.vol, `ln-fill${i}`, 'head');
    const r = await k.client.post(`/api/w/${k.ws}/restore`, { scope: 'drive', at: v1.action.headCommitId });
    expect(r.status).toBe(200);
    expect(r.body.checkpointSkipped).toBe(true);
    expect(r.body.checkpoint).toBeUndefined();
    expect(await ls(k.vol)).toEqual(['/a.txt']);
  });
});

describe('recently deleted', () => {
  beforeEach(() => freshWorld());
  afterEach(cleanWorld);

  test('lists deleted files and folders with a restore point; restoring removes them from the list', async () => {
    const k = await kitFor('rd1@test.local');
    await upload(k, { '/Photos/a.jpg': 'jpg', '/Photos/b.jpg': 'jpg2', '/doc.txt': 'doc' });
    await remove(k, '/Photos');
    await remove(k, '/doc.txt');
    const r = await k.client.get(`/api/w/${k.ws}/deleted`);
    expect(r.status).toBe(200);
    const items = r.body.items;
    expect(items.map((i: any) => i.path)).toEqual(['/doc.txt', '/Photos']);
    expect(items[1]).toMatchObject({ type: 'dir', size: 7, restorable: true });
    expect(items[0].restoreAt).toMatch(/^vc_/);

    const res = await k.client.post(`/api/w/${k.ws}/restore`, { scope: 'folder', path: '/Photos', at: items[1].restoreAt });
    expect(res.status).toBe(200);
    expect((await ls(k.vol)).sort()).toEqual(['/Photos', '/Photos/a.jpg', '/Photos/b.jpg']);
    const after = await k.client.get(`/api/w/${k.ws}/deleted`);
    expect(after.body.items.map((i: any) => i.path)).toEqual(['/doc.txt']);
    expect((await k.client.get(`/api/w/${k.ws}/deleted?limit=0`)).status).toBe(400);
  });
});

// ── content identity (never size + mtime alone) ─────────────────────────────

/** Swaps in a store whose stat reports no version id (a provider may omit it). */
function versionlessStat(): () => void {
  const real = getStore();
  const proxy = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'stat') {
        return async (...args: Parameters<VolumeStore['stat']>) => ({ ...(await target.stat(...args)), version: null });
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  setStoreForTests(proxy);
  return () => setStoreForTests(real);
}

describe('undo never overwrites newer content', () => {
  beforeEach(() => freshWorld());
  afterEach(cleanWorld);

  const T = 1_700_000_000_000;

  test('undo refuses (409, naming the path) when a later write kept the same size and time', async () => {
    const k = await kitFor('uc1@test.local');
    await uploadFile(k.client, k.ws, '/a.txt', 'AAAA', { mtime: T });
    const target = await uploadFile(k.client, k.ws, '/a.txt', 'BBBB', { mtime: T });
    await uploadFile(k.client, k.ws, '/a.txt', 'CCCC', { mtime: T });
    const u = await k.client.post(`/api/w/${k.ws}/actions/${target.commit.action.id}/undo`, {});
    expect(u.status).toBe(409);
    expect(u.body.error.code).toBe('conflict');
    expect(u.body.error.message).toContain('Later changes would be lost');
    expect(u.body.error.message).toContain('a.txt');
    expect(u.body.error.details.paths).toEqual(['/a.txt']);
    expect(await readText(k, '/a.txt')).toBe('CCCC');
  });

  test('undo refuses when a file inside the undone folder changed later with the same size and time', async () => {
    const k = await kitFor('uc2@test.local');
    await uploadFile(k.client, k.ws, '/box/keep.txt', 'keep', { mtime: T });
    const target = await uploadFile(k.client, k.ws, '/box/f.txt', 'BBBB', { mtime: T });
    const mv = await move(k, '/box', '/crate');
    await uploadFile(k.client, k.ws, '/crate/f.txt', 'CCCC', { mtime: T });
    // Undo the move: /box and /crate go back. /crate/f.txt changed since, silently.
    const u = await k.client.post(`/api/w/${k.ws}/actions/${mv.action.id}/undo`, {});
    expect(u.status).toBe(409);
    expect(u.body.error.details.paths).toEqual(['/crate/f.txt']);
    expect(await readText(k, '/crate/f.txt')).toBe('CCCC');
    // The earlier upload is buried under the move too.
    expect((await k.client.post(`/api/w/${k.ws}/actions/${target.commit.action.id}/undo`, {})).status).toBe(409);
  });

  test('undo refuses when versions are unknown and the bytes differ', async () => {
    const k = await kitFor('uc3@test.local');
    await uploadFile(k.client, k.ws, '/a.txt', 'AAAA', { mtime: T });
    const target = await uploadFile(k.client, k.ws, '/a.txt', 'BBBB', { mtime: T });
    await uploadFile(k.client, k.ws, '/a.txt', 'CCCC', { mtime: T });
    const restore = versionlessStat();
    try {
      const u = await k.client.post(`/api/w/${k.ws}/actions/${target.commit.action.id}/undo`, {});
      expect(u.status).toBe(409);
    } finally {
      restore();
    }
    expect(await readText(k, '/a.txt')).toBe('CCCC');
  });

  test('undo still works when later work left its paths as the action left them', async () => {
    const k = await kitFor('uc4@test.local');
    await uploadFile(k.client, k.ws, '/a.txt', 'AAAA', { mtime: T });
    const target = await uploadFile(k.client, k.ws, '/a.txt', 'BBBB', { mtime: T });
    await upload(k, { '/elsewhere.txt': 'x', '/dir/y.txt': 'y' });
    const u = await k.client.post(`/api/w/${k.ws}/actions/${target.commit.action.id}/undo`, {});
    expect(u.status).toBe(200);
    expect(await readText(k, '/a.txt')).toBe('AAAA');
    // Same with versions unknown: the bytes are compared instead.
    const t2 = await uploadFile(k.client, k.ws, '/dir/y.txt', 'z', { mtime: T });
    await upload(k, { '/other.txt': 'o' });
    const restore = versionlessStat();
    try {
      expect((await k.client.post(`/api/w/${k.ws}/actions/${t2.commit.action.id}/undo`, {})).status).toBe(200);
    } finally {
      restore();
    }
    expect(await readText(k, '/dir/y.txt')).toBe('y');
  });
});

describe('undo re-checks under the workspace lock', () => {
  beforeEach(() => freshWorld());
  afterEach(cleanWorld);

  test('a change landing between the check and the undo is never overwritten', async () => {
    const k = await kitFor('uc5@test.local');
    await upload(k, { '/a.txt': 'AAAA' });
    const target = await upload(k, { '/a.txt': 'BBBB' });
    await upload(k, { '/b.txt': 'later, elsewhere' });
    const real = getStore();
    let fired = false;
    // The first head read of the undo lets a newer write land, then answers with the stale head.
    const proxy = new Proxy(real, {
      get(t, prop, receiver) {
        if (prop === 'getVolume') {
          return async (...args: Parameters<VolumeStore['getVolume']>) => {
            const v = await t.getVolume(...args);
            if (!fired) {
              fired = true;
              await upload(k, { '/a.txt': 'CCCC' });
            }
            return v;
          };
        }
        const v = Reflect.get(t, prop, receiver);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    setStoreForTests(proxy);
    try {
      const u = await k.client.post(`/api/w/${k.ws}/actions/${target.action.id}/undo`, {});
      expect(fired).toBe(true);
      expect(u.status).toBe(409);
      expect(u.body.error.details.paths).toEqual(['/a.txt']);
    } finally {
      setStoreForTests(real);
    }
    expect(await readText(k, '/a.txt')).toBe('CCCC');
  });
});

describe('large folder restore is complete', () => {
  beforeEach(() => freshWorld());
  afterEach(cleanWorld);

  test('a folder of more than 2,000 files still restores a change with the same size and time', async () => {
    const k = await kitFor('lr1@test.local');
    const files = Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`/d/f${String(i).padStart(4, '0')}`, 'a']));
    const first = await upload(k, files);
    const st = await getStore().stat(k.vol, '/d/f1500');
    await uploadFile(k.client, k.ws, '/d/f1500', 'b', { mtime: st.mtime });
    const r = await k.client.post(`/api/w/${k.ws}/restore`, { scope: 'folder', path: '/d', at: first.action.headCommitId });
    expect(r.status).toBe(200);
    expect(r.body.action.status).toBe('committed');
    expect(await readText(k, '/d/f1500')).toBe('a');
    const rows = await db.select().from(actionPaths).where(eq(actionPaths.actionId, r.body.action.id));
    expect(rows.map((x) => x.path)).toEqual(['/d/f1500']);
  }, 60_000);

  test('same-looking files without a version id are compared by their bytes', async () => {
    const k = await kitFor('lr2@test.local');
    const first = await upload(k, { '/d/x.txt': 'xxxx', '/d/y.txt': 'yyyy' });
    const st = await getStore().stat(k.vol, '/d/x.txt');
    await uploadFile(k.client, k.ws, '/d/x.txt', 'XXXX', { mtime: st.mtime });
    const restore = versionlessStat();
    try {
      const r = await k.client.post(`/api/w/${k.ws}/restore`, { scope: 'folder', path: '/d', at: first.action.headCommitId });
      expect(r.status).toBe(200);
      expect(r.body.action.status).toBe('committed');
    } finally {
      restore();
    }
    expect(await readText(k, '/d/x.txt')).toBe('xxxx');
    expect(await readText(k, '/d/y.txt')).toBe('yyyy');
  });
});

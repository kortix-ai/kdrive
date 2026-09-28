// API-workspaces: list / create / rename / delete / duplicate (volume fork).
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { auditEvents, checkpoints, userSettings, workspaces } from '../db/schema';
import { setStoreForTests } from '../storage';
import { expectStoreError, uploadBytes } from '../storage/contract';
import { EmulatedStore } from '../storage/emulated';
import { resetDb, signInWithWorkspace } from '../../test/helpers';

const enc = (s: string) => new TextEncoder().encode(s);

function freshStore(maxVolumes = 200) {
  const store = new EmulatedStore({ dir: mkdtempSync(path.join(tmpdir(), 'vx-ws-')), maxVolumes });
  setStoreForTests(store);
  return store;
}

async function volumeOf(wsId: string): Promise<string> {
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
  return row.volumeId!;
}

describe('workspaces', () => {
  let store: EmulatedStore;
  beforeEach(async () => {
    await resetDb();
    store = freshStore();
  });
  afterAll(() => setStoreForTests(null));

  test('list, create, rename, delete (never the default)', async () => {
    const { client, ws } = await signInWithWorkspace('ws-crud@test.local');
    const list = await client.get('/api/workspaces');
    expect(list.status).toBe(200);
    expect(list.body.workspaces).toMatchObject([{ id: ws, name: 'My Drive', isDefault: true, usageBytes: 0, forkedFrom: null }]);

    const created = await client.post('/api/workspaces', { name: '  Projects  ' });
    expect(created.status).toBe(201);
    const w2 = created.body.workspace;
    expect(w2).toMatchObject({ name: 'Projects', isDefault: false, usageBytes: 0, forkedFrom: null });
    const vol2 = await volumeOf(w2.id);
    expect(vol2).toMatch(/^vol_/);
    await uploadBytes(store, vol2, '/a.txt', enc('hello'));

    const again = await client.get('/api/workspaces');
    expect(again.body.workspaces.map((w: any) => w.id)).toEqual([ws, w2.id]);
    expect(again.body.workspaces[1].usageBytes).toBe(4096);

    const renamed = await client.patch(`/api/workspaces/${w2.id}`, { name: 'Work' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.workspace.name).toBe('Work');
    expect((await client.patch(`/api/workspaces/${w2.id}`, { name: '' })).status).toBe(400);
    expect((await client.patch(`/api/workspaces/${w2.id}`, { name: 'x'.repeat(61) })).status).toBe(400);
    expect((await client.patch(`/api/workspaces/${w2.id}`, { name: 'a\u0007b' })).status).toBe(400);

    const delDefault = await client.del(`/api/workspaces/${ws}`);
    expect(delDefault.status).toBe(400);

    await db.insert(checkpoints).values({ id: '01jcheckpointtestrow000000', workspaceId: w2.id, name: 'x', tag: 'cp-x', commitId: 'vc_x' });
    const del = await client.del(`/api/workspaces/${w2.id}`);
    expect(del.status).toBe(204);
    await expectStoreError(store.getVolume(vol2), 'volume_not_found');
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, w2.id));
    expect(row.deletedAt).not.toBeNull();
    expect(await db.select().from(checkpoints).where(eq(checkpoints.workspaceId, w2.id))).toHaveLength(0);
    expect((await client.get(`/api/w/${w2.id}/links`)).status).toBe(404);
    expect((await client.get('/api/workspaces')).body.workspaces).toHaveLength(1);
    expect((await client.del(`/api/workspaces/${w2.id}`)).status).toBe(404);

    const kinds = (await db.select().from(auditEvents)).map((e) => e.kind);
    expect(kinds).toContain('workspace.create');
    expect(kinds).toContain('workspace.delete');
  });

  test('duplicate at an older commit lists that commit; forkedFrom is set', async () => {
    const { client, ws } = await signInWithWorkspace('ws-dup@test.local');
    const vol = await volumeOf(ws);
    await uploadBytes(store, vol, '/docs/a.txt', enc('alpha'));
    const first = (await store.getVolume(vol)).headCommitId;
    await uploadBytes(store, vol, '/docs/b.txt', enc('bravo'));
    await uploadBytes(store, vol, '/docs/a.txt', enc('alpha v2'));

    const dup = await client.post(`/api/workspaces/${ws}/duplicate`, { name: 'Old copy', at: first });
    expect(dup.status).toBe(201);
    const w = dup.body.workspace;
    expect(w).toMatchObject({ name: 'Old copy', isDefault: false, forkedFrom: { workspaceId: ws, workspaceName: 'My Drive', commitId: first } });
    const newVol = await volumeOf(w.id);
    expect(newVol).not.toBe(vol);
    const files = await store.list(newVol, '/docs');
    expect(files.entries.map((e) => e.path)).toEqual(['/docs/a.txt']);
    expect((await store.stat(newVol, '/docs/a.txt')).size).toBe(5);
    // the source is untouched
    expect((await store.list(vol, '/docs')).entries.map((e) => e.path)).toEqual(['/docs/a.txt', '/docs/b.txt']);
    // the copy is usable through the scoped routes
    expect((await client.get(`/api/w/${w.id}/links`)).status).toBe(200);

    // head by default
    const dupHead = await client.post(`/api/workspaces/${ws}/duplicate`, { name: 'Now copy' });
    expect(dupHead.status).toBe(201);
    expect(dupHead.body.workspace.forkedFrom.commitId).toBe((await store.getVolume(vol)).headCommitId);

    const ev = await db.select().from(auditEvents).where(eq(auditEvents.kind, 'workspace.duplicate'));
    expect(ev).toHaveLength(2);
    expect(ev[0].meta).toMatchObject({ fromWorkspaceId: ws });

    // unknown version → 410
    const gone = await client.post(`/api/workspaces/${ws}/duplicate`, { name: 'x', at: 'vc_00000000000000000000000000' });
    expect(gone.status).toBe(410);
  });

  test('duplicate checks the quota first', async () => {
    const { client, ws } = await signInWithWorkspace('ws-quota@test.local');
    const vol = await volumeOf(ws);
    await uploadBytes(store, vol, '/big.bin', new Uint8Array(3 * 4096));
    await db.update(userSettings).set({ quotaBytes: 5 * 4096 }).where(eq(userSettings.userId, (await db.select().from(workspaces).where(eq(workspaces.id, ws)))[0].userId));
    const r = await client.post(`/api/workspaces/${ws}/duplicate`, { name: 'Too big' });
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('quota_exceeded');
    expect(r.body.error.details.overBytes).toBeGreaterThan(0);
    expect((await client.get('/api/workspaces')).body.workspaces).toHaveLength(1);
  });

  test('the storage volume limit is checked before creating or duplicating', async () => {
    store = freshStore(2);
    const { client, ws } = await signInWithWorkspace('ws-limit@test.local'); // volume 1
    const ok = await client.post('/api/workspaces', { name: 'Two' }); // volume 2
    expect(ok.status).toBe(201);
    const full = await client.post('/api/workspaces', { name: 'Three' });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('storage_limit');
    const dup = await client.post(`/api/workspaces/${ws}/duplicate`, { name: 'Three' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('storage_limit');
    // no half-created rows
    expect((await client.get('/api/workspaces')).body.workspaces).toHaveLength(2);
    expect(await db.select().from(workspaces)).toHaveLength(2);
  });

  test("another user's workspace ids are 404 everywhere", async () => {
    const a = await signInWithWorkspace('ws-a@test.local');
    const b = await signInWithWorkspace('ws-b@test.local');
    const extra = await a.client.post('/api/workspaces', { name: 'A2' });
    const id = extra.body.workspace.id;
    expect((await b.client.patch(`/api/workspaces/${id}`, { name: 'mine' })).status).toBe(404);
    expect((await b.client.del(`/api/workspaces/${id}`)).status).toBe(404);
    expect((await b.client.post(`/api/workspaces/${id}/duplicate`, { name: 'steal' })).status).toBe(404);
    expect((await b.client.post(`/api/workspaces/${a.ws}/duplicate`, { name: 'steal' })).status).toBe(404);
    expect((await b.client.get('/api/workspaces')).body.workspaces.map((w: any) => w.id)).toEqual([b.ws]);
    const vol = await volumeOf(a.ws);
    expect((await a.client.post(`/api/workspaces/${vol}/duplicate`, { name: 'raw' })).status).toBe(404);
    expect((await a.client.get(`/api/workspaces`)).body.workspaces).toHaveLength(2);
  });
});

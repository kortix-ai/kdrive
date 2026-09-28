// API-sharing: share-link CRUD and the public /api/public/s/:token routes.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { auditEvents, shareLinks, workspaces } from '../db/schema';
import { getStore, setStoreForTests } from '../storage';
import { uploadBytes } from '../storage/contract';
import { EmulatedStore } from '../storage/emulated';
import { resetDb, signInWithWorkspace, TestClient } from '../../test/helpers';

const enc = (s: string) => new TextEncoder().encode(s);
const DAY = 24 * 60 * 60 * 1000;

let clock = Date.now();
function freshStore(maxVolumes = 200) {
  clock = Date.now();
  const store = new EmulatedStore({ dir: mkdtempSync(path.join(tmpdir(), 'vx-links-')), now: () => clock, maxVolumes });
  setStoreForTests(store);
  return store;
}

async function volumeOf(wsId: string): Promise<string> {
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
  return row.volumeId!;
}

const anon = () => new TestClient('anon');

describe('share links', () => {
  let store: EmulatedStore;
  beforeEach(async () => {
    await resetDb();
    store = freshStore();
  });
  afterAll(() => setStoreForTests(null));

  test('create live + pinned; list; public meta; live sees a later upload, pinned does not', async () => {
    const { client, ws } = await signInWithWorkspace('share-owner@test.local');
    const vol = await volumeOf(ws);
    await uploadBytes(store, vol, '/docs/a.txt', enc('alpha'));
    const head1 = (await store.getVolume(vol)).headCommitId;

    const live = await client.post(`/api/w/${ws}/links`, { path: '/docs', mode: 'live' });
    expect(live.status).toBe(201);
    expect(live.body.link).toMatchObject({ path: '/docs', targetType: 'dir', mode: 'live', commitId: null, revokedAt: null, openCount: 0 });
    expect(live.body.link.url).toBe(`http://localhost:4100/s/${live.body.link.token}`);
    expect(live.body.link.token).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const pinned = await client.post(`/api/w/${ws}/links`, { path: '/docs/', mode: 'pinned' });
    expect(pinned.status).toBe(201);
    expect(pinned.body.link).toMatchObject({ path: '/docs', mode: 'pinned', commitId: head1 });
    const tags = await store.listTags(vol);
    expect(tags.map((t) => t.name)).toEqual([`ln-${pinned.body.link.id}`]);
    expect(tags[0].commitId).toBe(head1);

    await uploadBytes(store, vol, '/docs/b.txt', enc('bravo'));

    const liveList = await anon().get(`/api/public/s/${live.body.link.token}/files`);
    expect(liveList.status).toBe(200);
    expect(liveList.body.path).toBe('/');
    expect(liveList.body.entries.map((e: any) => e.path)).toEqual(['/a.txt', '/b.txt']);
    const pinList = await anon().get(`/api/public/s/${pinned.body.link.token}/files`);
    expect(pinList.body.entries.map((e: any) => e.path)).toEqual(['/a.txt']);

    const meta = await anon().get(`/api/public/s/${pinned.body.link.token}`);
    expect(meta.status).toBe(200);
    expect(meta.body).toMatchObject({ name: 'docs', targetType: 'dir', mode: 'pinned', commitId: head1, ownerName: 'share-owner', expiresAt: null });
    expect(typeof meta.body.pinnedAt).toBe('string');
    // the owner's workspace / volume ids never leak
    expect(JSON.stringify(meta.body)).not.toContain(ws);
    expect(JSON.stringify(meta.body)).not.toContain(vol);
    expect(JSON.stringify(pinList.body)).not.toContain(vol);

    const list = await client.get(`/api/w/${ws}/links?path=/docs`);
    expect(list.status).toBe(200);
    expect(list.body.links.map((l: any) => l.id).sort()).toEqual([live.body.link.id, pinned.body.link.id].sort());
    // only the meta route counts opens
    const after = list.body.links.find((l: any) => l.id === pinned.body.link.id);
    expect(after.openCount).toBe(1);
    expect(after.lastOpenedAt).not.toBeNull();
    const other = await client.get(`/api/w/${ws}/links?path=/elsewhere`);
    expect(other.body.links).toEqual([]);

    const kinds = (await db.select().from(auditEvents).where(eq(auditEvents.kind, 'link.create'))).length;
    expect(kinds).toBe(2);
  });

  test('file link: meta has size + mime; files listing refused; path param ignored', async () => {
    const { client, ws } = await signInWithWorkspace('file-link@test.local');
    const vol = await volumeOf(ws);
    await uploadBytes(store, vol, '/notes/readme.md', enc('# hi'));
    await uploadBytes(store, vol, '/secret.txt', enc('top secret'));
    const r = await client.post(`/api/w/${ws}/links`, { path: '/notes/readme.md', mode: 'live' });
    expect(r.body.link.targetType).toBe('file');
    const meta = await anon().get(`/api/public/s/${r.body.link.token}`);
    expect(meta.body).toMatchObject({ name: 'readme.md', targetType: 'file', size: 4, mime: expect.stringContaining('markdown') });
    const files = await anon().get(`/api/public/s/${r.body.link.token}/files`);
    expect(files.status).toBe(409);
  });

  test('pinned at a past version (ref) and missing paths', async () => {
    const { client, ws } = await signInWithWorkspace('past@test.local');
    const vol = await volumeOf(ws);
    await uploadBytes(store, vol, '/x.txt', enc('one'));
    const first = (await store.getVolume(vol)).headCommitId;
    await uploadBytes(store, vol, '/x.txt', enc('two!'));
    await getStore().remove(vol, '/x.txt');
    // /x.txt is gone at head: live link → 404, pinned at the first version → ok
    const liveMissing = await client.post(`/api/w/${ws}/links`, { path: '/x.txt', mode: 'live' });
    expect(liveMissing.status).toBe(404);
    const p = await client.post(`/api/w/${ws}/links`, { path: '/x.txt', mode: 'pinned', at: first });
    expect(p.status).toBe(201);
    expect(p.body.link.commitId).toBe(first);
    const meta = await anon().get(`/api/public/s/${p.body.link.token}`);
    expect(meta.body.size).toBe(3);
    const bad = await client.post(`/api/w/${ws}/links`, { path: '/x.txt', mode: 'pinned', at: 'vc_00000000000000000000000000' });
    expect(bad.status).toBe(410);
    const badPath = await client.post(`/api/w/${ws}/links`, { path: '/../x', mode: 'live' });
    expect(badPath.status).toBe(400);
  });

  test('public content: Range, nosniff + CSP, active content as attachment; zips stream', async () => {
    const { client, ws } = await signInWithWorkspace('content@test.local');
    const vol = await volumeOf(ws);
    await uploadBytes(store, vol, '/site/page.html', enc('<script>alert(1)</script>'));
    await uploadBytes(store, vol, '/site/data.txt', enc('0123456789abcdef'));
    const dir = await client.post(`/api/w/${ws}/links`, { path: '/site', mode: 'pinned' });
    const t = dir.body.link.token;

    const ranged = await anon().raw('GET', `/api/public/s/${t}/content?path=/data.txt`, { headers: { range: 'bytes=0-9' } });
    expect(ranged.status).toBe(206);
    expect(await ranged.text()).toBe('0123456789');
    expect(ranged.headers.get('content-range')).toBe('bytes 0-9/16');
    expect(ranged.headers.get('x-content-type-options')).toBe('nosniff');
    expect(ranged.headers.get('content-security-policy')).toContain("default-src 'none'");

    const html = await anon().raw('GET', `/api/public/s/${t}/content?path=/page.html`);
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type') ?? '').not.toContain('text/html');
    const disp = html.headers.get('content-disposition') ?? '';
    const ct = html.headers.get('content-type') ?? '';
    expect(disp.startsWith('attachment') || ct.startsWith('text/plain')).toBe(true);

    const dl = await anon().raw('GET', `/api/public/s/${t}/content?path=/data.txt&download=1`);
    expect(dl.headers.get('content-disposition') ?? '').toStartWith('attachment');
    // folders are not content
    expect((await anon().get(`/api/public/s/${t}/content?path=/`)).status).toBe(409);

    const zip = await anon().raw('GET', `/api/public/s/${t}/zip`);
    expect(zip.status).toBe(200);
    expect(zip.headers.get('content-type')).toContain('application/zip');
    expect(zip.headers.get('content-disposition') ?? '').toContain('site.zip');
    const bytes = new Uint8Array(await zip.arrayBuffer());
    expect(bytes[0]).toBe(0x50); // PK
    expect(bytes[1]).toBe(0x4b);

    // a file link ignores `path` and serves only its own file
    const f = await client.post(`/api/w/${ws}/links`, { path: '/site/data.txt', mode: 'live' });
    const own = await anon().raw('GET', `/api/public/s/${f.body.link.token}/content?path=/page.html`);
    expect(await own.text()).toBe('0123456789abcdef');
  });

  test('public path traversal is 404', async () => {
    const { client, ws } = await signInWithWorkspace('trav@test.local');
    const vol = await volumeOf(ws);
    await uploadBytes(store, vol, '/shared/in.txt', enc('in'));
    await uploadBytes(store, vol, '/private/x', enc('nope'));
    await uploadBytes(store, vol, '/x', enc('root x'));
    const r = await client.post(`/api/w/${ws}/links`, { path: '/shared', mode: 'live' });
    const t = r.body.link.token;
    for (const q of ['/../x', '../private', '/../../x', '..', '/%2e%2e/x', '/a/../../x', '/in.txt/../../private/x']) {
      const res = await anon().get(`/api/public/s/${t}/files?path=${encodeURIComponent(q)}`);
      expect(res.status).toBe(404);
      const c = await anon().get(`/api/public/s/${t}/content?path=${encodeURIComponent(q)}`);
      expect(c.status).toBe(404);
      const z = await anon().get(`/api/public/s/${t}/zip?path=${encodeURIComponent(q)}`);
      expect(z.status).toBe(404);
    }
    const nul = await anon().get(`/api/public/s/${t}/files?path=${encodeURIComponent('/a\u0000b')}`);
    expect(nul.status).toBe(404);
    const ok = await anon().get(`/api/public/s/${t}/files?path=/`);
    expect(ok.body.entries.map((e: any) => e.name)).toEqual(['in.txt']);
    expect((await anon().get(`/api/public/s/${t}/files?path=/nope`)).status).toBe(404);
  });

  test('unknown token 404; revoked 410 link_revoked (tag freed); expired 410 link_expired', async () => {
    const { client, ws } = await signInWithWorkspace('revoke@test.local');
    const vol = await volumeOf(ws);
    await uploadBytes(store, vol, '/f.txt', enc('f'));
    expect((await anon().get('/api/public/s/nope')).status).toBe(404);
    expect((await anon().get(`/api/public/s/${'A'.repeat(32)}`)).status).toBe(404);

    const p = await client.post(`/api/w/${ws}/links`, { path: '/f.txt', mode: 'pinned' });
    expect((await store.listTags(vol)).length).toBe(1);
    const del = await client.del(`/api/w/${ws}/links/${p.body.link.id}`);
    expect(del.status).toBe(204);
    expect((await store.listTags(vol)).length).toBe(0);
    const again = await client.del(`/api/w/${ws}/links/${p.body.link.id}`);
    expect(again.status).toBe(204); // idempotent
    for (const sub of ['', '/files', '/content', '/zip']) {
      const r = await anon().get(`/api/public/s/${p.body.link.token}${sub}`);
      expect(r.status).toBe(410);
      expect(r.body.error.code).toBe('link_revoked');
    }
    const patch = await client.patch(`/api/w/${ws}/links/${p.body.link.id}`, { expiresAt: null });
    expect(patch.status).toBe(409);
    const revokes = await db.select().from(auditEvents).where(eq(auditEvents.kind, 'link.revoke'));
    expect(revokes.length).toBe(1);

    // expiry: past dates are refused on create; an elapsed expiry answers 410
    const past = await client.post(`/api/w/${ws}/links`, { path: '/f.txt', mode: 'live', expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(past.status).toBe(400);
    const soon = new Date(Date.now() + DAY).toISOString();
    const l = await client.post(`/api/w/${ws}/links`, { path: '/f.txt', mode: 'live', expiresAt: soon });
    expect(l.status).toBe(201);
    expect(l.body.link.expiresAt).toBe(soon);
    expect((await anon().get(`/api/public/s/${l.body.link.token}`)).status).toBe(200);
    const later = new Date(Date.now() + 7 * DAY).toISOString();
    const upd = await client.patch(`/api/w/${ws}/links/${l.body.link.id}`, { expiresAt: later });
    expect(upd.status).toBe(200);
    expect(upd.body.link.expiresAt).toBe(later);
    await db.update(shareLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(shareLinks.id, l.body.link.id));
    const exp = await anon().get(`/api/public/s/${l.body.link.token}`);
    expect(exp.status).toBe(410);
    expect(exp.body.error.code).toBe('link_expired');
    expect((await anon().get(`/api/public/s/${l.body.link.token}/files`)).body.error.code).toBe('link_expired');
  });

  test('the 61st open of a link in a minute from one IP is 429', async () => {
    const { client, ws } = await signInWithWorkspace('rl@test.local');
    const vol = await volumeOf(ws);
    await uploadBytes(store, vol, '/f.txt', enc('f'));
    const l = await client.post(`/api/w/${ws}/links`, { path: '/f.txt', mode: 'live' });
    const t = l.body.link.token;
    const hdr = { 'x-forwarded-for': '203.0.113.9' };
    for (let i = 0; i < 60; i++) {
      const r = await anon().raw('GET', `/api/public/s/${t}`, { headers: hdr });
      expect(r.status).toBe(200);
    }
    const r61 = await anon().raw('GET', `/api/public/s/${t}`, { headers: hdr });
    expect(r61.status).toBe(429);
    expect(r61.headers.get('retry-after')).toBeTruthy();
    expect((await r61.json()).error.code).toBe('rate_limited');
    // another IP still gets in
    const other = await anon().raw('GET', `/api/public/s/${t}`, { headers: { 'x-forwarded-for': '203.0.113.10' } });
    expect(other.status).toBe(200);
  });

  test('scoping: another user cannot list, change or revoke my links', async () => {
    const a = await signInWithWorkspace('links-a@test.local');
    const b = await signInWithWorkspace('links-b@test.local');
    await uploadBytes(store, await volumeOf(a.ws), '/f.txt', enc('f'));
    const l = await a.client.post(`/api/w/${a.ws}/links`, { path: '/f.txt', mode: 'live' });
    expect((await b.client.get(`/api/w/${a.ws}/links`)).status).toBe(404);
    expect((await b.client.del(`/api/w/${b.ws}/links/${l.body.link.id}`)).status).toBe(404);
    expect((await b.client.patch(`/api/w/${b.ws}/links/${l.body.link.id}`, { expiresAt: null })).status).toBe(404);
    expect((await b.client.get(`/api/w/${b.ws}/links`)).body.links).toEqual([]);
    const [row] = await db.select().from(shareLinks).where(and(eq(shareLinks.id, l.body.link.id)));
    expect(row.revokedAt).toBeNull();
  });

  test('pinned links count against the shared 100-tag budget', async () => {
    const { client, ws } = await signInWithWorkspace('budget@test.local');
    const vol = await volumeOf(ws);
    await uploadBytes(store, vol, '/f.txt', enc('f'));
    for (let i = 0; i < 100; i++) await store.putTag(vol, `cp-t${i}`);
    const r = await client.post(`/api/w/${ws}/links`, { path: '/f.txt', mode: 'pinned' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('tag_budget_exceeded');
    expect(await db.select().from(shareLinks)).toHaveLength(0);
    // live links need no tag
    expect((await client.post(`/api/w/${ws}/links`, { path: '/f.txt', mode: 'live' })).status).toBe(201);
  });

  test('a pinned link survives 60 more commits and retention (its tag pins it)', async () => {
    const { client, ws } = await signInWithWorkspace('retain@test.local');
    const vol = await volumeOf(ws);
    await uploadBytes(store, vol, '/r/keep.txt', enc('original'));
    const pinnedHead = (await store.getVolume(vol)).headCommitId;
    const p = await client.post(`/api/w/${ws}/links`, { path: '/r', mode: 'pinned' });
    const live = await client.post(`/api/w/${ws}/links`, { path: '/r', mode: 'live' });
    for (let i = 0; i < 60; i++) {
      clock += 60_000;
      await uploadBytes(store, vol, '/r/keep.txt', enc(`edit ${i}`));
    }
    const second = (await store.history(vol, { limit: 200 })).commits.find((c) => c.seq === 3)!;
    clock += 8 * DAY;
    await store.gc(vol);
    clock += 49 * 60 * 60 * 1000;
    await store.gc(vol);
    // an unpinned old commit is purged…
    await expect(store.stat(vol, '/r/keep.txt', { at: second.id })).rejects.toThrow();
    // …the pinned one is still readable through the link
    const list = await anon().get(`/api/public/s/${p.body.link.token}/files`);
    expect(list.status).toBe(200);
    expect(list.body.entries).toMatchObject([{ path: '/keep.txt', size: 8 }]);
    const meta = await anon().get(`/api/public/s/${p.body.link.token}`);
    expect(meta.body.commitId).toBe(pinnedHead);
    const liveList = await anon().get(`/api/public/s/${live.body.link.token}/files`);
    expect(liveList.body.entries[0].size).toBe(enc('edit 59').length);
  });

  test('a deleted workspace takes its links with it', async () => {
    const { client, ws } = await signInWithWorkspace('wsdel-links@test.local');
    const created = await client.post('/api/workspaces', { name: 'Scratch' });
    const w2 = created.body.workspace.id;
    const vol = await volumeOf(w2);
    await uploadBytes(store, vol, '/f.txt', enc('f'));
    const l = await client.post(`/api/w/${w2}/links`, { path: '/f.txt', mode: 'pinned' });
    expect(l.status).toBe(201);
    expect((await client.del(`/api/workspaces/${w2}`)).status).toBe(204);
    expect((await anon().get(`/api/public/s/${l.body.link.token}`)).status).toBe(404);
    expect(await db.select().from(shareLinks).where(eq(shareLinks.workspaceId, w2))).toHaveLength(0);
    expect(ws).not.toBe(w2);
  });
});

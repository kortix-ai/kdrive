// API-account: typed-confirmation account deletion and the personal audit feed.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { auditEvents, bauthSession, bauthUser, shareLinks, userSettings, workspaces } from '../db/schema';
import { setStoreForTests } from '../storage';
import { expectStoreError, uploadBytes } from '../storage/contract';
import { EmulatedStore } from '../storage/emulated';
import { makeApp, resetDb, signInWithWorkspace } from '../../test/helpers';

const enc = (s: string) => new TextEncoder().encode(s);

describe('account', () => {
  let store: EmulatedStore;
  beforeEach(async () => {
    await resetDb();
    store = new EmulatedStore({ dir: mkdtempSync(path.join(tmpdir(), 'vx-acct-')), maxVolumes: 200 });
    setStoreForTests(store);
  });
  afterAll(() => setStoreForTests(null));

  test('delete account: typed confirmation, volumes + rows removed, cookies expired, session dead', async () => {
    const { client, ws, me } = await signInWithWorkspace('Leaving@Test.local');
    const other = await signInWithWorkspace('stays@test.local');
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, ws));
    await uploadBytes(store, row.volumeId!, '/a.txt', enc('bye'));
    const w2 = await client.post('/api/workspaces', { name: 'Second' });
    const [row2] = await db.select().from(workspaces).where(eq(workspaces.id, w2.body.workspace.id));
    const link = await client.post(`/api/w/${ws}/links`, { path: '/a.txt', mode: 'pinned' });
    expect(link.status).toBe(201);
    const oldCookies = client.cookieHeader();

    const wrong = await client.del('/api/me', { confirm: 'someone@else.local' });
    expect(wrong.status).toBe(400);
    const missing = await client.del('/api/me', {});
    expect(missing.status).toBe(400);
    expect((await client.get('/api/me')).status).toBe(200);

    const res = await client.raw('DELETE', '/api/me', {
      body: JSON.stringify({ confirm: ' leaving@test.local ' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(204);
    const setCookies = (res.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
    expect(setCookies.some((c) => c.startsWith('vx.session_token=') && /max-age=0/i.test(c))).toBe(true);
    expect(setCookies.some((c) => c.startsWith('vx.session_data=') && /max-age=0/i.test(c))).toBe(true);

    await expectStoreError(store.getVolume(row.volumeId!), 'volume_not_found');
    await expectStoreError(store.getVolume(row2.volumeId!), 'volume_not_found');
    expect(await db.select().from(bauthUser).where(eq(bauthUser.id, me.user.id))).toHaveLength(0);
    expect(await db.select().from(workspaces).where(eq(workspaces.userId, me.user.id))).toHaveLength(0);
    expect(await db.select().from(userSettings).where(eq(userSettings.userId, me.user.id))).toHaveLength(0);
    expect(await db.select().from(bauthSession).where(eq(bauthSession.userId, me.user.id))).toHaveLength(0);
    expect(await db.select().from(shareLinks)).toHaveLength(0);

    // the jar dropped the cookies; the old cookie token no longer resolves to a session
    expect((await client.get('/api/me')).status).toBe(401);
    const tokenOnly = oldCookies
      .split('; ')
      .filter((c) => c.startsWith('vx.session_token='))
      .join('; ');
    const replay = await makeApp().fetch(new Request('http://localhost:4101/api/workspaces', { headers: { cookie: tokenOnly } }));
    expect(replay.status).toBe(401);
    // the public link died with the account
    expect((await client.get(`/api/public/s/${link.body.link.token}`)).status).toBe(404);

    const [ev] = await db.select().from(auditEvents).where(eq(auditEvents.kind, 'account.delete'));
    expect(ev.userId).toBeNull();
    expect(ev.actorEmail).toBe('leaving@test.local');
    expect(ev.meta).toMatchObject({ workspaces: 2, volumes: 2, links: 1 });

    // other users are untouched
    expect((await other.client.get('/api/me')).status).toBe(200);
    expect((await other.client.get(`/api/w/${other.ws}/links`)).status).toBe(200);
  });

  test('delete account needs a session and the CSRF guard', async () => {
    const { client } = await signInWithWorkspace('csrf-del@test.local');
    const foreign = await client.raw('DELETE', '/api/me', {
      body: JSON.stringify({ confirm: 'csrf-del@test.local' }),
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    });
    expect(foreign.status).toBe(403);
    const plain = await client.raw('DELETE', '/api/me', { body: JSON.stringify({ confirm: 'csrf-del@test.local' }), headers: { 'content-type': 'text/plain' } });
    expect(plain.status).toBe(403);
    expect((await client.get('/api/me')).status).toBe(200);
  });

  test('GET /api/me/audit lists only my events, newest first, paged by id', async () => {
    const { client, ws } = await signInWithWorkspace('audit-me@test.local');
    const other = await signInWithWorkspace('audit-other@test.local');
    await other.client.post('/api/workspaces', { name: 'Theirs' });
    for (let i = 0; i < 3; i++) await client.post('/api/workspaces', { name: `W${i}` });
    const first = await client.get('/api/me/audit?limit=2');
    expect(first.status).toBe(200);
    expect(first.body.events).toHaveLength(2);
    expect(first.body.events[0].kind).toBe('workspace.create');
    expect(first.body.events[0].target).toBe('W2');
    expect(first.body.events[0].id).toBeGreaterThan(first.body.events[1].id);
    expect(first.body.nextCursor).toBe(String(first.body.events[1].id));
    const all: any[] = [...first.body.events];
    let cursor = first.body.nextCursor;
    while (cursor) {
      const page = await client.get(`/api/me/audit?limit=2&before=${cursor}`);
      all.push(...page.body.events);
      cursor = page.body.nextCursor;
    }
    const kinds = all.map((e) => e.kind);
    expect(kinds.filter((k) => k === 'workspace.create')).toHaveLength(3);
    expect(kinds).toContain('auth.sign_in');
    expect(all.some((e) => e.target === 'Theirs')).toBe(false);
    expect(all.every((e) => e.workspaceId === null || typeof e.workspaceId === 'string')).toBe(true);
    expect((await client.get('/api/me/audit?limit=0')).status).toBe(400);
    expect(ws).toBeTruthy();
  });
});

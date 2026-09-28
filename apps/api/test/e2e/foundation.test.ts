// FOUNDATION smoke + security tests for the shared plumbing (auth, /api/me,
// CSRF, workspace scoping, error envelope). Builder features have their own suites.
import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { auditEvents, workspaces } from '../../src/db/schema';
import { getStore } from '../../src/storage';
import { uploadBytes } from '../../src/storage/contract';
import { ORIGIN, TestClient, makeApp, resetDb, signIn, signInWithWorkspace } from '../helpers';

describe('foundation', () => {
  beforeEach(resetDb);

  test('health and config are public', async () => {
    const anon = new TestClient('anon');
    const h = await anon.get('/api/health');
    expect(h.status).toBe(200);
    expect(h.body).toEqual({ ok: true, storageMode: 'emulated' });
    expect(h.headers.get('x-content-type-options')).toBe('nosniff');
    const cfg = await anon.get('/api/config');
    expect(cfg.body.devLogin).toBe(true);
    expect(cfg.body.providers).toEqual([]);
    expect(cfg.body.storageMode).toBe('emulated');
  });

  test('unauthenticated /api/me is 401 with the error envelope', async () => {
    const r = await new TestClient('anon').get('/api/me');
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: { code: 'unauthorized', message: expect.any(String) } });
  });

  test('dev sign-in → /api/me has a default workspace with quota; idempotent bootstrap', async () => {
    const { client, ws, me } = await signInWithWorkspace('smoke@test.local');
    expect(me.user.email).toBe('smoke@test.local');
    expect(me.isAdmin).toBe(false);
    expect(ws).toMatch(/^[0-9a-z]{26}$/);
    expect(me.workspaces).toHaveLength(1);
    expect(me.workspaces[0]).toMatchObject({ id: ws, name: 'My Drive', isDefault: true, usageBytes: 0, forkedFrom: null });
    expect(me.usage).toMatchObject({ quotaBytes: 10 * 1024 ** 3, usedBytes: 0, level: 'ok' });
    // a second sign-in (new session) reuses the same workspace
    const again = await signInWithWorkspace('smoke@test.local');
    expect(again.ws).toBe(ws);
    const rows = await db.select().from(workspaces).where(eq(workspaces.id, ws));
    expect(rows[0].volumeId).toMatch(/^vol_/);
    expect(rows[0].volumeName).toBe(`vx-${ws}`);
    // sign-in is audited
    const events = await db.select().from(auditEvents).where(eq(auditEvents.kind, 'auth.sign_in'));
    expect(events.length).toBeGreaterThanOrEqual(2);
    // usage follows the volume
    const volumeId = rows[0].volumeId!;
    await uploadBytes(getStore(), volumeId, '/hello.txt', new TextEncoder().encode('hello'));
    const usage = await client.get('/api/me/usage');
    expect(usage.body.usedBytes).toBe(4096);
    const list = await getStore().list(volumeId, '/');
    expect(list.entries.map((e) => e.path)).toEqual(['/hello.txt']);
  });

  test('admin flag comes from VOLUMES_ADMIN_EMAILS', async () => {
    const { me } = await signInWithWorkspace('Admin@Test.local');
    expect(me.isAdmin).toBe(true);
  });

  test('sign-out ends the session', async () => {
    const client = await signIn('bye@test.local');
    expect((await client.get('/api/me')).status).toBe(200);
    const out = await client.post('/api/auth/sign-out', {});
    expect(out.status).toBe(200);
    expect((await client.get('/api/me')).status).toBe(401);
  });

  test('CSRF: missing / foreign Origin and non-JSON bodies are refused', async () => {
    const { client, ws } = await signInWithWorkspace('csrf@test.local');
    const app = makeApp();
    const cookie = client.cookieHeader();
    const noOrigin = await app.fetch(
      new Request(`http://localhost:4101/api/w/${ws}/folders`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: '{"path":"/x"}',
      }),
    );
    expect(noOrigin.status).toBe(403);
    expect((await noOrigin.json()).error.code).toBe('csrf');
    const foreign = await client.raw('POST', `/api/w/${ws}/folders`, {
      body: '{"path":"/x"}',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
    });
    expect(foreign.status).toBe(403);
    const textPlain = await client.raw('POST', `/api/w/${ws}/folders`, { body: '{"path":"/x"}', headers: { 'content-type': 'text/plain' } });
    expect(textPlain.status).toBe(403);
    // same origin + JSON passes the guard (the route itself may still be a stub)
    const okReq = await client.post(`/api/w/${ws}/folders`, { path: '/x' });
    expect(okReq.status).not.toBe(403);
    // GET is never CSRF-checked
    const get = await app.fetch(new Request('http://localhost:4101/api/health'));
    expect(get.status).toBe(200);
    expect(ORIGIN).toBe('http://localhost:4100');
  });

  test('workspace scoping: another user\'s workspace and raw volume ids are 404', async () => {
    const a = await signInWithWorkspace('owner@test.local');
    const b = await signInWithWorkspace('intruder@test.local');
    const cross = await b.client.get(`/api/w/${a.ws}/files`);
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe('not_found');
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, a.ws));
    const raw = await a.client.get(`/api/w/${row.volumeId}/files`);
    expect(raw.status).toBe(404);
  });

  test('unknown routes answer the JSON envelope', async () => {
    const r = await new TestClient('anon').get('/api/nope');
    expect(r.status).toBe(401); // everything non-public needs a session first
    const { client } = await signInWithWorkspace('routes@test.local');
    const r2 = await client.get('/api/nope');
    expect(r2.status).toBe(404);
    expect(r2.body.error.code).toBe('not_found');
  });
});

// End to end: the admin console. Admins come from VOLUMES_ADMIN_EMAILS (reconciled into the
// table, locked in the UI) plus the ones added there; every /api/admin route answers 404 to
// anyone else (audited); the drives list, the in-memory server log (redacted) and the
// read-only settings.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { admins, auditEvents } from '../../src/db/schema';
import { env } from '../../src/env';
import { pathOnly, readServerLog, recordRequestError, redact } from '../../src/lib/server-log';
import { fillDays } from '../../src/services/admin-panel';
import { ENV_ADDED_BY, reconcileEnvAdmins } from '../../src/services/admins';
import { getStore } from '../../src/storage';
import { TEST_ADMIN, TestClient } from '../helpers';
import { captureMail, type Mailbox } from '../mail';
import { endWorld, freshWorld, upload, user } from './kit';

let mail: Mailbox;
const saved = { mode: env.signupMode, allow: env.signupAllowlist };
beforeEach(async () => {
  await freshWorld();
  mail = captureMail();
});
afterEach(() => {
  Object.assign(env, { signupMode: saved.mode, signupAllowlist: saved.allow, adminEmails: [] });
  mail.restore();
  endWorld();
});
afterAll(endWorld);

const PASSWORD = 'a fine password';
const signUp = (email: string) => new TestClient(email).post('/api/auth/sign-up/email', { email, password: PASSWORD, name: 'N' });
const tableEmails = async () => (await db.select().from(admins)).map((a) => a.email).sort();

describe('admins from VOLUMES_ADMIN_EMAILS', () => {
  test('an existing user on the list is promoted on reconcile; reconcile is idempotent', async () => {
    const ada = await user('ada@test.local');
    expect((await ada.client.get('/api/me')).body.isAdmin).toBe(false);
    env.adminEmails = ['ada@test.local'];
    expect(await reconcileEnvAdmins()).toEqual({ added: ['ada@test.local'], removed: [] });
    expect(await reconcileEnvAdmins()).toEqual({ added: [], removed: [] });
    expect((await ada.client.get('/api/me')).body.isAdmin).toBe(true);
    expect((await ada.client.get('/api/admin/session')).body).toMatchObject({ user: { email: 'ada@test.local' }, source: 'env' });
    const [row] = await db.select().from(admins).where(eq(admins.email, 'ada@test.local'));
    expect(row.addedBy).toBe(ENV_ADDED_BY);
    const [ev] = await db.select().from(auditEvents).where(eq(auditEvents.kind, 'admin.add'));
    expect(ev).toMatchObject({ target: 'ada@test.local', actorEmail: ENV_ADDED_BY, meta: { via: 'env' } });
  });

  test('taking an address off the list removes only what the list added', async () => {
    const adm = await user(TEST_ADMIN);
    await adm.client.post('/api/admin/admins', { email: 'kept@test.local' });
    env.adminEmails = ['gone@test.local', 'kept@test.local'];
    expect((await reconcileEnvAdmins()).added).toEqual(['gone@test.local']);
    env.adminEmails = [];
    expect(await reconcileEnvAdmins()).toEqual({ added: [], removed: ['gone@test.local'] });
    expect(await tableEmails()).toEqual(['admin@test.local', 'allen@kortix.ai', 'kept@test.local']);
  });

  test('an address listed before it signs up is an admin from its first sign-in', async () => {
    env.adminEmails = ['later@test.local'];
    const later = await user('later@test.local'); // no reconcile needed: the list is read live
    expect((await later.client.get('/api/me')).body.isAdmin).toBe(true);
    expect((await later.client.get('/api/admin/overview')).status).toBe(200);
  });

  test('server-config admins are listed first, locked, and cannot be removed or re-added', async () => {
    env.adminEmails = ['root@test.local'];
    await reconcileEnvAdmins();
    const adm = await user(TEST_ADMIN);
    const list = (await adm.client.get('/api/admin/admins')).body.admins;
    expect(list[0]).toMatchObject({ email: 'root@test.local', source: 'env', user: null });
    expect(list.find((a: { email: string }) => a.email === TEST_ADMIN).source).toBe('db');

    const del = await adm.client.del('/api/admin/admins/root%40test.local');
    expect(del.status).toBe(409);
    expect(del.body.error.details).toEqual({ locked: true });
    expect((await adm.client.post('/api/admin/admins', { email: 'root@test.local' })).status).toBe(409);
    expect(await tableEmails()).toContain('root@test.local');

    // With an env admin around, the table may lose its last UI-added admin.
    expect((await adm.client.del('/api/admin/admins/allen%40kortix.ai')).status).toBe(204);
    expect((await adm.client.del(`/api/admin/admins/${encodeURIComponent(TEST_ADMIN)}`)).status).toBe(204);
  });

  test('a listed address may create an account while sign-up is closed (the founder); others may not', async () => {
    env.signupMode = 'closed';
    env.adminEmails = ['founder@test.local'];
    expect((await signUp('stranger@test.local')).status).toBe(403);
    expect((await signUp('founder@test.local')).status).toBe(200);
    const c = new TestClient('founder@test.local');
    expect((await c.post('/api/auth/sign-in/email', { email: 'founder@test.local', password: PASSWORD })).status).toBe(200);
    // Admin rights still wait for the address to be verified.
    expect((await c.get('/api/me')).body.isAdmin).toBe(false);
    expect((await c.get('/api/admin/session')).status).toBe(404);
    // Dev login (any provider sign-up) passes the same gate.
    expect((await new TestClient('d').post('/api/auth/dev/sign-in', { email: 'founder2@test.local' })).status).toBe(403);
    env.adminEmails = ['founder@test.local', 'founder2@test.local'];
    expect((await new TestClient('d').post('/api/auth/dev/sign-in', { email: 'founder2@test.local' })).status).toBe(200);
  });
});

describe('nobody else can tell the admin API exists', () => {
  test('a non-admin gets the 404 of an unknown route everywhere, audited once a minute per route', async () => {
    const plain = await user('plain@test.local');
    const unknown = await plain.client.get('/api/nothing-here');
    for (const path of ['/api/admin/session', '/api/admin/drives', '/api/admin/logs', '/api/admin/settings', '/api/admin/overview']) {
      const r = await plain.client.get(path);
      expect(`${path} ${r.status}`).toBe(`${path} 404`);
      expect(r.body).toEqual(unknown.body);
    }
    await plain.client.get('/api/admin/session');
    const denied = await db.select().from(auditEvents).where(eq(auditEvents.kind, 'admin.denied'));
    expect(denied).toHaveLength(5);
    expect(denied[0]).toMatchObject({ userId: null, actorEmail: 'plain@test.local' });
    expect(denied.map((d) => d.target).sort()).toContain('/api/admin/session');
    // Not in the user's own activity.
    const mine = (await plain.client.get('/api/me/audit')).body;
    expect(JSON.stringify(mine)).not.toContain('admin.denied');

    plain.client.cookies.clear();
    expect((await plain.client.get('/api/admin/session')).status).toBe(401);
  });

  test('a failed password sign-in is audited', async () => {
    await signUp('who@test.local');
    const c = new TestClient('who@test.local');
    expect((await c.post('/api/auth/sign-in/email', { email: 'who@test.local', password: 'not the password' })).status).toBe(401);
    const [ev] = await db.select().from(auditEvents).where(eq(auditEvents.kind, 'auth.sign_in_failed'));
    expect(ev).toMatchObject({ userId: null, actorEmail: 'who@test.local' });
  });
});

describe('drives', () => {
  test('every drive with owner, members, files and size; search and pages', async () => {
    const adm = await user(TEST_ADMIN);
    const ada = await user('ada@test.local');
    await upload(ada, { '/a.txt': 'hello', '/b/c.txt': 'world' });
    await ada.client.post('/api/workspaces', { name: 'Projects' });

    const r = await adm.client.get('/api/admin/drives');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(3);
    const mine = r.body.drives.find((d: { id: string }) => d.id === ada.ws);
    expect(mine).toMatchObject({ owner: { email: 'ada@test.local' }, memberCount: 0, isDefault: true, fileCount: 2 });
    expect(mine.usedBytes).toBeGreaterThan(0);

    const q = await adm.client.get('/api/admin/drives?q=projects');
    expect(q.body.drives.map((d: { name: string }) => d.name)).toEqual(['Projects']);
    const byOwner = await adm.client.get('/api/admin/drives?q=ADA@');
    expect(byOwner.body.total).toBe(2);

    const p1 = await adm.client.get('/api/admin/drives?limit=2&page=1');
    const p2 = await adm.client.get('/api/admin/drives?limit=2&page=2');
    expect(p1.body.drives).toHaveLength(2);
    expect(p2.body.drives).toHaveLength(1);
    const ids = [...p1.body.drives, ...p2.body.drives].map((d: { id: string }) => d.id);
    expect(new Set(ids).size).toBe(3);
    expect((await adm.client.get('/api/admin/drives?limit=999')).status).toBe(400);
  });
});

describe('server log', () => {
  test('admins read warnings, errors and 5xx answers, redacted; no query strings', async () => {
    const adm = await user(TEST_ADMIN);
    console.warn('[test] key sk_live_abcdef0123456789 and Bearer abc.def.ghi-jklmnop leaked');
    console.error('[test] whsec_0123456789abcdef pt_live_abcdef0123 and', 'a'.repeat(48));

    // A request that fails inside storage: logged as a 5xx without its query string.
    const store = getStore() as unknown as { getVolume: (id: string) => Promise<unknown> };
    const original = store.getVolume.bind(store);
    store.getVolume = async () => {
      throw new Error('disk on fire');
    };
    try {
      expect((await adm.client.get('/api/me/usage?token=supersecret123')).status).toBe(500);
    } finally {
      store.getVolume = original;
    }

    const r = await adm.client.get('/api/admin/logs');
    expect(r.status).toBe(200);
    expect(r.body.capacity).toBe(2000);
    const text = JSON.stringify(r.body.entries);
    for (const secret of ['sk_live_abcdef', 'abc.def.ghi', 'whsec_0123', 'pt_live_abcdef', 'a'.repeat(48), 'supersecret123', 'token=']) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('[redacted]');
    const req = r.body.entries.find((e: { source: string }) => e.source === 'request');
    expect(req).toMatchObject({ level: 'error', method: 'GET', path: '/api/me/usage', status: 500 });
    expect(typeof req.durationMs).toBe('number');

    const errorsOnly = (await adm.client.get('/api/admin/logs?level=error')).body.entries;
    expect(errorsOnly.every((e: { level: string }) => e.level === 'error')).toBe(true);
    const newest = r.body.entries[0].id;
    expect((await adm.client.get(`/api/admin/logs?after=${newest}`)).body.entries).toEqual([]);

    const plain = await user('plain@test.local');
    expect((await plain.client.get('/api/admin/logs')).status).toBe(404);
  });

  test('redact and pathOnly', () => {
    expect(redact('Authorization: Bearer abcdefghijklmnop')).not.toContain('abcdefghijklmnop');
    expect(redact('rk_live_1234567890abcdef')).toBe('[redacted]');
    expect(redact('password=hunter2hunter2')).toBe('password=[redacted]');
    expect(redact(`commit ${'f'.repeat(40)}`)).toBe('commit [redacted]');
    expect(redact('GET /api/w/01hx2y3z4a5b6c7d8e9f0g1h2j/files -> 500')).toContain('/api/w/01hx2y3z4a5b6c7d8e9f0g1h2j/files');
    expect(pathOnly('/api/x?token=1#frag')).toBe('/api/x');
    recordRequestError({ method: 'POST', path: '/api/y?secret=1', status: 502, durationMs: 4 });
    expect(readServerLog({ limit: 1 }).entries[0]).toMatchObject({ path: '/api/y', status: 502 });
  });
});

describe('overview and settings', () => {
  test('the overview has sign-ups per day for 30 days', async () => {
    const adm = await user(TEST_ADMIN);
    await user('one@test.local');
    const o = (await adm.client.get('/api/admin/overview')).body;
    expect(o.signupsByDay).toHaveLength(30);
    expect(o.signupsByDay.at(-1)).toEqual({ date: new Date().toISOString().slice(0, 10), count: 2 });
    expect(o.activeSubscriptions).toBeNull();
    expect(fillDays([{ day: '2026-10-14', n: 3 }], 3, Date.parse('2026-10-15T08:00:00Z'))).toEqual([
      { date: '2026-10-13', count: 0 },
      { date: '2026-10-14', count: 3 },
      { date: '2026-10-15', count: 0 },
    ]);
  });

  test('settings show the configuration, never a secret', async () => {
    env.adminEmails = ['root@test.local'];
    const adm = await user(TEST_ADMIN);
    const s = (await adm.client.get('/api/admin/settings')).body;
    expect(s).toMatchObject({
      publicUrl: 'http://localhost:4100',
      signup: { mode: env.signupMode },
      providers: { google: true, github: false },
      storage: { mode: 'emulated' },
      adminEmails: ['root@test.local'],
      billing: { enabled: false },
    });
    expect(typeof s.version).toBe('string');
    const text = JSON.stringify(s);
    for (const secret of [env.BETTER_AUTH_SECRET, env.GOOGLE_CLIENT_SECRET!]) expect(text).not.toContain(secret);
  });
});

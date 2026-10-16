// End to end: the admin panel. Admins live in the database (seeded with the first
// admin, managed by admins, never zero), and admins read server totals, users with
// usage, one user's drives, usage by email domain and every user's audit events.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { GiB } from '@volumes/shared';
import { db } from '../../src/db/client';
import { admins, auditEvents, bauthUser, userSettings } from '../../src/db/schema';
import { env } from '../../src/env';
import { csvField } from '../../src/services/admin-audit';
import { TEST_ADMIN } from '../helpers';
import { captureMail, type Mailbox } from '../mail';
import { endWorld, freshWorld, q, upload, user, type User } from './kit';

let mail: Mailbox;
beforeEach(async () => {
  await freshWorld();
  mail = captureMail();
});
afterEach(() => {
  mail.restore();
  endWorld();
});
afterAll(endWorld);

async function join(owner: User, who: User, role: 'editor' | 'viewer'): Promise<void> {
  expect((await owner.client.post(`/api/workspaces/${owner.ws}/invites`, { email: who.me.user.email, role })).status).toBe(201);
  const inv = (await who.client.get('/api/invitations')).body.invitations.find((i: { workspaceId: string }) => i.workspaceId === owner.ws);
  expect((await who.client.post(`/api/invitations/${inv.id}/accept`, {})).status).toBe(200);
}

const used = async (u: User) => (await u.client.get('/api/me/usage')).body.usedBytes as number;

describe('admin access', () => {
  test('non-admins get 404 on every admin route; signed-out callers 401', async () => {
    const plain = await user('plain@test.local');
    const routes: [string, string, unknown?][] = [
      ['GET', '/api/admin/overview'],
      ['GET', '/api/admin/users'],
      ['GET', `/api/admin/users/${plain.userId}`],
      ['PUT', `/api/admin/users/${plain.userId}/quota`, { quotaBytes: GiB }],
      ['GET', '/api/admin/domains'],
      ['GET', '/api/admin/audit'],
      ['GET', '/api/admin/audit.csv'],
      ['GET', '/api/admin/storage-requests'],
      ['GET', '/api/admin/admins'],
      ['POST', '/api/admin/admins', { email: 'plain@test.local' }],
      ['DELETE', `/api/admin/admins/${encodeURIComponent(TEST_ADMIN)}`],
    ];
    for (const [method, path, body] of routes) {
      const r = await plain.client.raw(method, path, body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {});
      expect(`${method} ${path} ${r.status}`).toBe(`${method} ${path} 404`);
    }
    expect((await plain.client.get('/api/me')).body.isAdmin).toBe(false);
    // Nothing changed.
    expect((await db.select().from(admins)).map((a) => a.email).sort()).toEqual(['admin@test.local', 'allen@kortix.ai']);

    plain.client.cookies.clear();
    expect((await plain.client.get('/api/admin/overview')).status).toBe(401);
  });
});

describe('admins in the database', () => {
  test('the migration seeds allen@kortix.ai; admins add and remove admins by address, audited', async () => {
    const adm = await user(TEST_ADMIN);
    const list = await adm.client.get('/api/admin/admins');
    expect(list.status).toBe(200);
    const seeded = list.body.admins.find((a: { email: string }) => a.email === 'allen@kortix.ai');
    expect(seeded).toMatchObject({ addedBy: null, user: null });
    expect(list.body.admins.find((a: { email: string }) => a.email === TEST_ADMIN).user).toMatchObject({ id: adm.userId, emailVerified: true });

    // Not an admin yet.
    const cat = await user('cat@test.local');
    expect(cat.me.isAdmin).toBe(false);
    expect((await cat.client.get('/api/admin/overview')).status).toBe(404);

    // Added by address (any case); takes effect at once.
    const add = await adm.client.post('/api/admin/admins', { email: '  Cat@Test.Local ' });
    expect(add.status).toBe(201);
    expect(add.body.admin).toMatchObject({ email: 'cat@test.local', addedBy: TEST_ADMIN, user: { id: cat.userId } });
    expect((await cat.client.get('/api/me')).body.isAdmin).toBe(true);
    expect((await cat.client.get('/api/admin/overview')).status).toBe(200);

    expect((await adm.client.post('/api/admin/admins', { email: 'cat@test.local' })).status).toBe(409);
    expect((await adm.client.post('/api/admin/admins', { email: 'not-an-email' })).status).toBe(400);

    // An address nobody signed up with yet.
    const later = await adm.client.post('/api/admin/admins', { email: 'later@test.local' });
    expect(later.body.admin.user).toBeNull();

    // Removed: no admin rights from the next request on.
    const del = await adm.client.del(`/api/admin/admins/${encodeURIComponent('cat@test.local')}`);
    expect(del.status).toBe(204);
    expect((await cat.client.get('/api/me')).body.isAdmin).toBe(false);
    expect((await cat.client.get('/api/admin/overview')).status).toBe(404);
    expect((await adm.client.del('/api/admin/admins/nobody%40test.local')).status).toBe(404);

    const events = await db.select().from(auditEvents).where(eq(auditEvents.userId, adm.userId)).orderBy(auditEvents.id);
    const kinds = events.filter((e) => e.kind.startsWith('admin.')).map((e) => `${e.kind}:${e.target}`);
    expect(kinds).toEqual(['admin.add:cat@test.local', 'admin.add:later@test.local', 'admin.remove:cat@test.local']);
    expect(events.find((e) => e.kind === 'admin.add')?.actorEmail).toBe(TEST_ADMIN);
  });

  test('the last admin cannot be removed, by someone else or by themselves', async () => {
    const adm = await user(TEST_ADMIN);
    expect((await adm.client.del('/api/admin/admins/allen%40kortix.ai')).status).toBe(204);
    const self = await adm.client.del(`/api/admin/admins/${encodeURIComponent(TEST_ADMIN)}`);
    expect(self.status).toBe(409);
    expect(self.body.error.code).toBe('conflict');
    expect((await db.select().from(admins)).map((a) => a.email)).toEqual([TEST_ADMIN]);
    expect((await adm.client.get('/api/me')).body.isAdmin).toBe(true);

    // With a second admin, removing yourself works (and ends your access).
    await adm.client.post('/api/admin/admins', { email: 'allen@kortix.ai' });
    expect((await adm.client.del(`/api/admin/admins/${encodeURIComponent(TEST_ADMIN)}`)).status).toBe(204);
    expect((await adm.client.get('/api/admin/admins')).status).toBe(404);
  });

  test('an unverified account at an admin address is not an admin', async () => {
    const adm = await user(TEST_ADMIN);
    await adm.client.post('/api/admin/admins', { email: 'unverified@test.local' });
    const u = await user('unverified@test.local');
    await db.update(bauthUser).set({ emailVerified: false }).where(eq(bauthUser.id, u.userId));
    expect((await u.client.get('/api/me')).body.isAdmin).toBe(false);
    expect((await u.client.get('/api/admin/overview')).status).toBe(404);
    const row = (await adm.client.get('/api/admin/users?q=unverified')).body.users[0];
    expect(row).toMatchObject({ isAdmin: false, emailVerified: false });
    expect((await adm.client.get(`/api/admin/users/${u.userId}`)).body).toMatchObject({ isListedAdmin: true, user: { isAdmin: false } });
  });

  test('admins from the database may sign up when sign-ups are closed, and get storage-request mail', async () => {
    const adm = await user(TEST_ADMIN);
    await adm.client.post('/api/admin/admins', { email: 'boss@test.local' });
    const mode = env.signupMode;
    env.signupMode = 'closed';
    try {
      await expect(user('stranger@test.local')).rejects.toThrow();
      const boss = await user('boss@test.local');
      expect(boss.me.isAdmin).toBe(true);
    } finally {
      env.signupMode = mode;
    }
    const ada = await user('ada@test.local');
    expect((await ada.client.post('/api/me/storage-requests', { plan: 'plus' })).status).toBe(201);
    expect(await mail.to('boss@test.local', 'storage-request')).toHaveLength(1);
    expect(await mail.to('allen@kortix.ai', 'storage-request')).toHaveLength(1);
    expect(await mail.to(TEST_ADMIN, 'storage-request')).toHaveLength(1);
  });
});

describe('overview, users and domains', () => {
  /** ada (2 drives, one shared with ben), ben, cat at another domain; ada asks for more storage. */
  async function world() {
    const adm = await user(TEST_ADMIN);
    const ada = await user('ada@kortix.test');
    const ben = await user('ben@kortix.test');
    const cat = await user('cat@other.test');
    await upload(ada, { '/a.bin': new Uint8Array(300_000), '/b.txt': 'hello' });
    const second = (await ada.client.post('/api/workspaces', { name: 'Photos' })).body.workspace;
    await upload({ client: ada.client, ws: second.id }, { '/p.bin': new Uint8Array(50_000) });
    await upload(cat, { '/c.bin': new Uint8Array(120_000) });
    await join(ada, ben, 'editor');
    await db.update(userSettings).set({ quotaBytes: 100 * GiB }).where(eq(userSettings.userId, cat.userId));
    await ada.client.post('/api/me/storage-requests', { plan: 'plus' });
    return { adm, ada, ben, cat, second };
  }

  test('overview: totals across every drive, sign-ups, open requests and the top users', async () => {
    const { adm, ada, ben, cat } = await world();
    const r = await adm.client.get('/api/admin/overview');
    expect(r.status).toBe(200);
    const total = (await used(ada)) + (await used(ben)) + (await used(cat)) + (await used(adm));
    expect(total).toBeGreaterThan(470_000);
    expect(r.body).toMatchObject({
      users: 4,
      drives: 5,
      sharedDrives: 1,
      usedBytes: total,
      quotaBytes: 3 * 10 * GiB + 100 * GiB,
      openRequests: 1,
      signups7d: 4,
      signups30d: 4,
    });
    expect(r.body.topUsers.map((u: { email: string }) => u.email).slice(0, 2)).toEqual(['ada@kortix.test', 'cat@other.test']);
    expect(r.body.topUsers).toHaveLength(4);

    // A user created long ago leaves the sign-up windows.
    await db.update(bauthUser).set({ createdAt: new Date(Date.now() - 20 * 86_400_000) }).where(eq(bauthUser.id, cat.userId));
    const later = (await adm.client.get('/api/admin/overview')).body;
    expect(later).toMatchObject({ signups7d: 3, signups30d: 4 });
  });

  test('users: usage, drives, shared-with counts, sorting, search and pages', async () => {
    const { adm, ada, ben, cat } = await world();
    const r = await adm.client.get('/api/admin/users');
    expect(r.body).toMatchObject({ total: 4, page: 1, limit: 50 });
    expect(r.body.users.map((u: { email: string }) => u.email)).toEqual(['ada@kortix.test', 'cat@other.test', 'admin@test.local', 'ben@kortix.test']);
    const a = r.body.users[0];
    expect(a).toMatchObject({ usedBytes: await used(ada), workspaceCount: 2, sharedWithCount: 0, quotaBytes: 10 * GiB, isAdmin: false });
    expect(r.body.users.find((u: { email: string }) => u.email === 'ben@kortix.test')).toMatchObject({ usedBytes: 0, workspaceCount: 1, sharedWithCount: 1 });
    expect(r.body.users.find((u: { email: string }) => u.email === TEST_ADMIN).isAdmin).toBe(true);

    const byQuota = await adm.client.get(`/api/admin/users?${q({ sort: 'quota', dir: 'desc' })}`);
    expect(byQuota.body.users[0].email).toBe('cat@other.test');
    const byEmail = await adm.client.get(`/api/admin/users?${q({ sort: 'email', dir: 'asc', limit: '2' })}`);
    expect(byEmail.body.users.map((u: { email: string }) => u.email)).toEqual(['ada@kortix.test', 'admin@test.local']);
    expect(byEmail.body.total).toBe(4);
    const page2 = await adm.client.get(`/api/admin/users?${q({ sort: 'email', dir: 'asc', limit: '2', page: '2' })}`);
    expect(page2.body.users.map((u: { email: string }) => u.email)).toEqual(['ben@kortix.test', 'cat@other.test']);
    const search = await adm.client.get(`/api/admin/users?${q({ q: 'KORTIX' })}`);
    expect(search.body.total).toBe(2);
    expect((await adm.client.get(`/api/admin/users?${q({ sort: 'nope' })}`)).status).toBe(400);
    expect((await adm.client.get(`/api/admin/users?${q({ limit: '501' })}`)).status).toBe(400);
    void ben;
    void cat;
  });

  test('user detail: own drives with size and members, drives shared with them', async () => {
    const { adm, ada, ben, second } = await world();
    const d = await adm.client.get(`/api/admin/users/${ada.userId}`);
    expect(d.status).toBe(200);
    expect(d.body.user).toMatchObject({ email: 'ada@kortix.test', usedBytes: await used(ada), workspaceCount: 2 });
    expect(d.body.drives.map((w: { name: string; memberCount: number; isDefault: boolean }) => [w.name, w.memberCount, w.isDefault])).toEqual([
      ['My Drive', 1, true],
      ['Photos', 0, false],
    ]);
    expect(d.body.drives.reduce((n: number, w: { usedBytes: number }) => n + w.usedBytes, 0)).toBe(await used(ada));
    expect(d.body.drives[1].id).toBe(second.id);
    expect(d.body.sharedWith).toEqual([]);

    const b = (await adm.client.get(`/api/admin/users/${ben.userId}`)).body;
    expect(b.user.sharedWithCount).toBe(1);
    expect(b.sharedWith).toHaveLength(1);
    expect(b.sharedWith[0]).toMatchObject({ id: ada.ws, name: 'My Drive', role: 'editor', owner: { email: 'ada@kortix.test' } });
    expect(b.sharedWith[0].usedBytes).toBe(d.body.drives[0].usedBytes);

    expect((await adm.client.get('/api/admin/users/nobody')).status).toBe(404);
  });

  test('domains: users grouped by email domain with totals, most used first', async () => {
    const { adm, ada, cat } = await world();
    const r = await adm.client.get('/api/admin/domains');
    expect(r.status).toBe(200);
    expect(r.body.domains.map((d: { domain: string }) => d.domain)).toEqual(['kortix.test', 'other.test', 'test.local']);
    const k = r.body.domains[0];
    expect(k).toMatchObject({ users: 2, drives: 3, usedBytes: await used(ada), quotaBytes: 20 * GiB });
    expect(k.members.map((m: { email: string }) => m.email)).toEqual(['ada@kortix.test', 'ben@kortix.test']);
    expect(r.body.domains[1]).toMatchObject({ users: 1, drives: 1, usedBytes: await used(cat), quotaBytes: 100 * GiB });
  });
});

describe('audit log', () => {
  test('every user, newest first; filters by person, kinds, drive and dates; paged by id', async () => {
    const adm = await user(TEST_ADMIN);
    const ada = await user('ada@test.local');
    const ben = await user('ben@test.local');
    const ws = (await ada.client.post('/api/workspaces', { name: 'Ada Work' })).body.workspace;
    await ben.client.post('/api/workspaces', { name: 'Ben Work' });
    await adm.client.put(`/api/admin/users/${ben.userId}/quota`, { quotaBytes: 20 * GiB });

    const all = await adm.client.get('/api/admin/audit');
    expect(all.status).toBe(200);
    const ids = all.body.events.map((e: { id: number }) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(new Set(all.body.events.map((e: { actorEmail: string }) => e.actorEmail))).toEqual(new Set([TEST_ADMIN, 'ada@test.local', 'ben@test.local']));

    // Search matches the actor, the account and the target.
    const benEvents = (await adm.client.get(`/api/admin/audit?${q({ q: 'BEN@' })}`)).body.events;
    expect(benEvents.map((e: { kind: string }) => e.kind).sort()).toEqual(['auth.sign_in', 'auth.sign_up', 'quota.change', 'workspace.create']);
    expect((await adm.client.get(`/api/admin/audit?${q({ userId: ada.userId })}`)).body.events).toHaveLength(3);

    // Several kinds at once.
    const kinds = (await adm.client.get(`/api/admin/audit?${q({ kind: ['workspace.create', 'quota.change'] })}`)).body.events;
    expect(kinds.map((e: { kind: string }) => e.kind)).toEqual(['quota.change', 'workspace.create', 'workspace.create']);
    expect(kinds.find((e: { target: string }) => e.target === 'Ada Work')).toMatchObject({ workspaceId: ws.id, workspaceName: 'Ada Work', userId: ada.userId });

    // One drive, also after it is deleted.
    await ada.client.del(`/api/workspaces/${ws.id}`);
    const inWs = (await adm.client.get(`/api/admin/audit?${q({ workspaceId: ws.id })}`)).body.events;
    expect(inWs.map((e: { kind: string; workspaceName: string }) => `${e.kind}:${e.workspaceName}`)).toEqual(['workspace.delete:Ada Work', 'workspace.create:Ada Work']);

    // Dates: from inclusive, to exclusive.
    await db.update(auditEvents).set({ createdAt: new Date('2026-01-01T00:00:00Z') }).where(eq(auditEvents.kind, 'quota.change'));
    const jan = (await adm.client.get(`/api/admin/audit?${q({ from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' })}`)).body.events;
    expect(jan.map((e: { kind: string }) => e.kind)).toEqual(['quota.change']);
    const recent = (await adm.client.get(`/api/admin/audit?${q({ from: new Date(Date.now() - 86_400_000).toISOString() })}`)).body.events;
    expect(recent.some((e: { kind: string }) => e.kind === 'quota.change')).toBe(false);
    expect((await adm.client.get(`/api/admin/audit?${q({ from: 'yesterday' })}`)).status).toBe(400);

    // Paging.
    const first = (await adm.client.get('/api/admin/audit?limit=3')).body;
    expect(first.events).toHaveLength(3);
    const rest = (await adm.client.get(`/api/admin/audit?limit=100&before=${first.nextCursor}`)).body;
    expect(rest.nextCursor).toBeNull();
    expect([...first.events, ...rest.events].map((e: { id: number }) => e.id)).toEqual(
      (await adm.client.get('/api/admin/audit?limit=500')).body.events.map((e: { id: number }) => e.id),
    );
    // The IP comes along for admins.
    expect(all.body.events.find((e: { kind: string }) => e.kind === 'auth.sign_in')).toHaveProperty('ip');
  });

  test('CSV export: the current filter, a header row, escaped fields', async () => {
    const adm = await user(TEST_ADMIN);
    const ada = await user('ada@test.local');
    await ada.client.post('/api/workspaces', { name: '=HYPERLINK("x"), "quoted"' });
    const res = await adm.client.raw('GET', `/api/admin/audit.csv?${q({ kind: 'workspace.create' })}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="kdrive-audit-\d{8}-\d{4}\.csv"$/);
    const lines = (await res.text()).trim().split('\r\n');
    expect(lines[0]).toBe('id,time,actor_email,user_id,kind,target,workspace_id,workspace_name,ip,meta');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`,ada@test.local,${ada.userId},workspace.create,"'=HYPERLINK(""x""), ""quoted""",`);

    const everything = await (await adm.client.raw('GET', '/api/admin/audit.csv')).text();
    expect(everything.trim().split('\r\n').length).toBeGreaterThan(4);
    const plain = await user('plain@test.local');
    expect((await plain.client.raw('GET', '/api/admin/audit.csv')).status).toBe(404);
  });

  test('csvField', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(12)).toBe('12');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField('+1')).toBe("'+1");
    expect(csvField('@x')).toBe("'@x");
    expect(csvField('-2')).toBe("'-2");
  });
});

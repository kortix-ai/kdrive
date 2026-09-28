// End to end: workspaces (duplicate at a past version = user story 14), admin
// quota changes, account deletion and the audit trail.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { actions, shareLinks, workspaces } from '../../src/db/schema';
import { bauthUser } from '../../src/auth/schema';
import { getStore } from '../../src/storage';
import { endWorld, freshWorld, head, ls, text, upload, user } from './kit';

beforeEach(() => freshWorld());
afterEach(endWorld);
afterAll(endWorld);

describe('workspaces', () => {
  test('duplicate the drive at a past version into a separate workspace', async () => {
    const a = await user('dup@test.local');
    await upload(a, { '/plan.md': 'v1', '/assets/logo.png': 'png' });
    const past = await head(a);
    await upload(a, { '/plan.md': 'v2', '/later.txt': 'later' });

    const dup = await a.client.post(`/api/workspaces/${a.ws}/duplicate`, { name: 'Plan as of v1', at: past });
    expect(dup.status).toBe(201);
    const w = dup.body.workspace;
    expect(w).toMatchObject({ name: 'Plan as of v1', isDefault: false, forkedFrom: { workspaceId: a.ws, workspaceName: 'My Drive', commitId: past } });

    const b = { client: a.client, ws: w.id as string };
    expect(await ls(b)).toEqual(['assets/', 'plan.md']);
    expect(await text(b, '/plan.md')).toBe('v1');
    // Separate: edits in the copy do not touch the original.
    await upload(b, { '/plan.md': 'forked edit' });
    expect(await text(a, '/plan.md')).toBe('v2');
    expect(await text(b, '/plan.md')).toBe('forked edit');
    const tl = (await b.client.get(`/api/w/${b.ws}/timeline`)).body.entries;
    expect(tl.at(-1).kind).toBe('fork');

    const me = (await a.client.get('/api/me')).body;
    expect(me.workspaces.map((x: { name: string }) => x.name)).toEqual(['My Drive', 'Plan as of v1']);
    expect(me.usage.byWorkspace).toHaveLength(2);

    // Rename and delete the copy; the default one cannot be deleted.
    expect((await a.client.patch(`/api/workspaces/${w.id}`, { name: 'Old plan' })).body.workspace.name).toBe('Old plan');
    expect((await a.client.del(`/api/workspaces/${a.ws}`)).status).toBe(400);
    expect((await a.client.del(`/api/workspaces/${w.id}`)).status).toBe(204);
    expect((await a.client.get(`/api/w/${w.id}/files`)).status).toBe(404);
    expect((await a.client.get('/api/workspaces')).body.workspaces).toHaveLength(1);
  });

  test('create an empty workspace', async () => {
    const a = await user('ws2@test.local');
    const r = await a.client.post('/api/workspaces', { name: 'Side project' });
    expect(r.status).toBe(201);
    expect(await ls({ client: a.client, ws: r.body.workspace.id })).toEqual([]);
  });
});

describe('admin', () => {
  test('admins list users with usage and change quotas (≤ 50 GiB); others get 403', async () => {
    const u = await user('member@test.local');
    await upload(u, { '/f.bin': new Uint8Array(10_000) });
    const adm = await user('admin@test.local');
    expect(adm.me.isAdmin).toBe(true);
    expect((await u.client.get('/api/admin/users')).status).toBe(403);
    expect((await u.client.put(`/api/admin/users/${u.userId}/quota`, { quotaBytes: 1 })).status).toBe(403);

    const list = await adm.client.get('/api/admin/users?q=member');
    expect(list.status).toBe(200);
    expect(list.body.users).toHaveLength(1);
    expect(list.body.users[0]).toMatchObject({ email: 'member@test.local', workspaceCount: 1, isAdmin: false });
    expect(list.body.users[0].usedBytes).toBeGreaterThanOrEqual(10_000);

    const twenty = 20 * 1024 ** 3;
    const set = await adm.client.put(`/api/admin/users/${u.userId}/quota`, { quotaBytes: twenty });
    expect(set.status).toBe(200);
    expect((await u.client.get('/api/me/usage')).body.quotaBytes).toBe(twenty);
    expect((await adm.client.put(`/api/admin/users/${u.userId}/quota`, { quotaBytes: 51 * 1024 ** 3 })).status).toBe(400);

    const audit = await adm.client.get('/api/admin/audit?kind=quota.change');
    expect(audit.body.events[0]).toMatchObject({ kind: 'quota.change', target: 'member@test.local', actorEmail: 'admin@test.local', meta: { to: twenty, targetUserId: u.userId } });
  });
});

describe('account', () => {
  test('deletion needs the typed email, then removes volumes and rows and ends the session', async () => {
    const a = await user('leaving@test.local');
    await upload(a, { '/x.txt': 'x' });
    await a.client.post(`/api/w/${a.ws}/links`, { path: '/x.txt', mode: 'live' });
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, a.ws));

    const audit = await a.client.get('/api/me/audit');
    expect(audit.body.events.map((e: { kind: string }) => e.kind)).toContain('link.create');

    const wrong = await a.client.del('/api/me', { confirm: 'someone@else.com' });
    expect(wrong.status).toBe(400);
    const cookies = a.client.cookieHeader();
    const done = await a.client.del('/api/me', { confirm: 'LEAVING@test.local' });
    expect(done.status).toBe(204);

    expect((await a.client.get('/api/me')).status).toBe(401);
    // Replaying the old cookies does not keep the account signed in (no 30 s cache window).
    const replay = await a.client.raw('GET', '/api/workspaces', { headers: { cookie: cookies } });
    expect(replay.status).toBe(401);

    expect(await db.select().from(bauthUser).where(eq(bauthUser.id, a.userId))).toEqual([]);
    expect(await db.select().from(actions).where(eq(actions.workspaceId, a.ws))).toEqual([]);
    expect(await db.select().from(shareLinks).where(eq(shareLinks.workspaceId, a.ws))).toEqual([]);
    const vol = await getStore()
      .getVolume(row.volumeId!)
      .then(() => 'exists')
      .catch((e: { code?: string }) => e.code);
    expect(vol).toBe('volume_not_found');
  });
});

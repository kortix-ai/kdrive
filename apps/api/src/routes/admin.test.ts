// API-admin: users + usage, quota edits (≤ 1 TiB), audit log; gated by VOLUMES_ADMIN_EMAILS.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { GiB, MAX_QUOTA_BYTES } from '@volumes/shared';
import { db } from '../db/client';
import { auditEvents, userSettings, workspaces } from '../db/schema';
import { setStoreForTests } from '../storage';
import { uploadBytes } from '../storage/contract';
import { EmulatedStore } from '../storage/emulated';
import { resetDb, signInWithWorkspace } from '../../test/helpers';

describe('admin', () => {
  let store: EmulatedStore;
  beforeEach(async () => {
    await resetDb();
    store = new EmulatedStore({ dir: mkdtempSync(path.join(tmpdir(), 'vx-admin-')), maxVolumes: 200 });
    setStoreForTests(store);
  });
  afterAll(() => setStoreForTests(null));

  test('non-admins get 403 on every admin route', async () => {
    const { client, me } = await signInWithWorkspace('plain@test.local');
    expect((await client.get('/api/admin/users')).status).toBe(403);
    expect((await client.get('/api/admin/audit')).status).toBe(403);
    const put = await client.put(`/api/admin/users/${me.user.id}/quota`, { quotaBytes: 20 * GiB });
    expect(put.status).toBe(403);
    expect(put.body.error.code).toBe('forbidden');
    const [s] = await db.select().from(userSettings).where(eq(userSettings.userId, me.user.id));
    expect(s.quotaBytes).toBe(10 * GiB);
  });

  test('users list with usage, workspace count, search', async () => {
    const admin = await signInWithWorkspace('admin@test.local');
    const u = await signInWithWorkspace('user1@test.local');
    await signInWithWorkspace('someone@else.local');
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, u.ws));
    await uploadBytes(store, row.volumeId!, '/a.bin', new Uint8Array(10_000));
    await u.client.post('/api/workspaces', { name: 'Second' });

    const r = await admin.client.get('/api/admin/users');
    expect(r.status).toBe(200);
    expect(r.body.users).toHaveLength(3);
    const u1 = r.body.users.find((x: any) => x.email === 'user1@test.local');
    expect(u1).toMatchObject({ quotaBytes: 10 * GiB, usedBytes: 12288, workspaceCount: 2, isAdmin: false, name: 'user1' });
    expect(u1.lastSignInAt).not.toBeNull();
    expect(r.body.users.find((x: any) => x.email === 'admin@test.local').isAdmin).toBe(true);

    const q = await admin.client.get('/api/admin/users?q=USER1');
    expect(q.body.users.map((x: any) => x.email)).toEqual(['user1@test.local']);
    const none = await admin.client.get(`/api/admin/users?q=${encodeURIComponent('%')}`);
    expect(none.body.users).toEqual([]);
  });

  test('set quota: ≤ 1 TiB, persists, audited; unknown user 404', async () => {
    const admin = await signInWithWorkspace('admin@test.local');
    const u = await signInWithWorkspace('quota@test.local');
    const id = u.me.user.id;

    const over = await admin.client.put(`/api/admin/users/${id}/quota`, { quotaBytes: MAX_QUOTA_BYTES + 1 });
    expect(over.status).toBe(400);
    expect((await admin.client.put(`/api/admin/users/${id}/quota`, { quotaBytes: 0 })).status).toBe(400);
    expect((await admin.client.put(`/api/admin/users/${id}/quota`, { quotaBytes: 1.5 })).status).toBe(400);
    expect((await admin.client.put(`/api/admin/users/${id}/quota`, { quotaBytes: '20' })).status).toBe(400);

    const ok = await admin.client.put(`/api/admin/users/${id}/quota`, { quotaBytes: 50 * GiB });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ id, email: 'quota@test.local', quotaBytes: 50 * GiB });
    expect((await u.client.get('/api/me/usage')).body.quotaBytes).toBe(50 * GiB);

    const [ev] = await db.select().from(auditEvents).where(eq(auditEvents.kind, 'quota.change'));
    expect(ev.meta).toMatchObject({ targetUserId: id, from: 10 * GiB, to: 50 * GiB });
    expect(ev.actorEmail).toBe('admin@test.local');
    expect(ev.target).toBe('quota@test.local');

    expect((await admin.client.put('/api/admin/users/nobody/quota', { quotaBytes: GiB })).status).toBe(404);
  });

  test('audit log: filter by kind and user, paged by id', async () => {
    const admin = await signInWithWorkspace('admin@test.local');
    const u = await signInWithWorkspace('audited@test.local');
    for (let i = 0; i < 3; i++) await u.client.post('/api/workspaces', { name: `A${i}` });
    const all = await admin.client.get('/api/admin/audit');
    expect(all.status).toBe(200);
    expect(all.body.events.length).toBeGreaterThanOrEqual(5);
    const byKind = await admin.client.get('/api/admin/audit?kind=workspace.create&limit=2');
    expect(byKind.body.events).toHaveLength(2);
    expect(byKind.body.events.every((e: any) => e.kind === 'workspace.create')).toBe(true);
    expect(byKind.body.nextCursor).not.toBeNull();
    const rest = await admin.client.get(`/api/admin/audit?kind=workspace.create&limit=2&before=${byKind.body.nextCursor}`);
    expect(rest.body.events).toHaveLength(1);
    expect(rest.body.nextCursor).toBeNull();
    const byUser = await admin.client.get(`/api/admin/audit?userId=${u.me.user.id}`);
    expect(byUser.body.events.map((e: any) => e.kind).sort()).toEqual(['auth.sign_in', 'auth.sign_up', 'workspace.create', 'workspace.create', 'workspace.create']);
  });
});

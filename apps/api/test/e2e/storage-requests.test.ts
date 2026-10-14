// End to end: storage requests. A person asks for a paid plan's storage, admins
// are mailed, and an admin grants (the quota becomes the plan's size) or dismisses it.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { DEFAULT_QUOTA_BYTES, GiB, TiB } from '@volumes/shared';
import { db } from '../../src/db/client';
import { storageRequests, userSettings } from '../../src/db/schema';
import { captureMail, type Mailbox } from '../mail';
import { endWorld, freshWorld, ls, upload, user } from './kit';

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

describe('asking for more storage', () => {
  test('one open request per user: asking again updates it, and admins hear about new plans only', async () => {
    const ada = await user('ada@test.local');
    expect((await ada.client.get('/api/me/storage-requests')).body).toEqual({ request: null });

    const first = await ada.client.post('/api/me/storage-requests', { plan: 'plus', note: '  photos from 2019  ' });
    expect(first.status).toBe(201);
    expect(first.body.request).toMatchObject({ plan: 'plus', note: 'photos from 2019', status: 'open', resolvedAt: null });

    const sent = await mail.to('admin@test.local', 'storage-request');
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain('Plus');
    expect(sent[0].text).toContain('ada@test.local');
    expect(sent[0].text).toContain('photos from 2019');
    expect(sent[0].links?.[0]).toContain('/admin?tab=requests');

    // Same plan again: updated in place, no second mail.
    const again = await ada.client.post('/api/me/storage-requests', { plan: 'plus' });
    expect(again.status).toBe(200);
    expect(again.body.request).toMatchObject({ id: first.body.request.id, plan: 'plus', note: null });
    expect(await mail.to('admin@test.local', 'storage-request')).toHaveLength(1);

    // A different plan: still the same request, and the admins are told.
    const pro = await ada.client.post('/api/me/storage-requests', { plan: 'pro' });
    expect(pro.body.request).toMatchObject({ id: first.body.request.id, plan: 'pro' });
    expect(await mail.to('admin@test.local', 'storage-request')).toHaveLength(2);

    expect(await db.select().from(storageRequests).where(eq(storageRequests.userId, ada.userId))).toHaveLength(1);
    expect((await ada.client.get('/api/me/storage-requests')).body.request).toMatchObject({ plan: 'pro', status: 'open' });

    const audit = (await ada.client.get('/api/me/audit')).body.events.filter((e: { kind: string }) => e.kind === 'storage.request');
    expect(audit).toHaveLength(3);
  });

  test('refuses the free plan, unknown plans, long notes and plans already covered by the quota', async () => {
    const ben = await user('ben@test.local');
    expect((await ben.client.post('/api/me/storage-requests', { plan: 'free' })).status).toBe(400);
    expect((await ben.client.post('/api/me/storage-requests', { plan: 'max' })).status).toBe(400);
    expect((await ben.client.post('/api/me/storage-requests', { plan: 'plus', note: 'x'.repeat(501) })).status).toBe(400);

    await db.update(userSettings).set({ quotaBytes: 100 * GiB }).where(eq(userSettings.userId, ben.userId));
    const covered = await ben.client.post('/api/me/storage-requests', { plan: 'plus' });
    expect(covered.status).toBe(409);
    expect(covered.body.error.code).toBe('conflict');
    expect((await ben.client.post('/api/me/storage-requests', { plan: 'pro' })).status).toBe(201);
  });

  test('is rate limited per user', async () => {
    const cat = await user('cat@test.local');
    for (let i = 0; i < 5; i++) expect((await cat.client.post('/api/me/storage-requests', { plan: i % 2 ? 'pro' : 'plus' })).status).toBeLessThan(300);
    const over = await cat.client.post('/api/me/storage-requests', { plan: 'plus' });
    expect(over.status).toBe(429);
    expect(over.headers.get('retry-after')).toBeTruthy();
  });

  test('needs a session', async () => {
    const ada = await user('anon-check@test.local');
    ada.client.cookies.clear();
    expect((await ada.client.post('/api/me/storage-requests', { plan: 'plus' })).status).toBe(401);
  });
});

describe('admins answer requests', () => {
  test('list the open queue with usage; grant raises the quota, mails the user and closes the request', async () => {
    const ada = await user('ada2@test.local');
    await upload(ada, { '/big.bin': new Uint8Array(20_000) });
    const adm = await user('admin@test.local');
    const { request } = (await ada.client.post('/api/me/storage-requests', { plan: 'plus', note: 'more room' })).body;

    expect((await ada.client.get('/api/admin/storage-requests')).status).toBe(403);
    expect((await ada.client.post(`/api/admin/storage-requests/${request.id}/grant`)).status).toBe(403);

    const list = await adm.client.get('/api/admin/storage-requests');
    expect(list.status).toBe(200);
    expect(list.body.requests).toHaveLength(1);
    expect(list.body.requests[0]).toMatchObject({
      id: request.id,
      plan: 'plus',
      note: 'more room',
      status: 'open',
      user: { email: 'ada2@test.local' },
      quotaBytes: DEFAULT_QUOTA_BYTES,
      subscription: null,
    });
    expect(list.body.requests[0].usedBytes).toBeGreaterThanOrEqual(20_000);

    const grant = await adm.client.post(`/api/admin/storage-requests/${request.id}/grant`);
    expect(grant.status).toBe(200);
    expect(grant.body.request).toMatchObject({ status: 'granted', quotaBytes: 100 * GiB, resolvedBy: 'admin@test.local' });
    expect((await ada.client.get('/api/me/usage')).body.quotaBytes).toBe(100 * GiB);
    expect((await ada.client.get('/api/me/storage-requests')).body.request).toMatchObject({ status: 'granted' });
    expect(await ls(ada)).toEqual(['big.bin']);

    const granted = await mail.to('ada2@test.local', 'storage-granted');
    expect(granted).toHaveLength(1);
    expect(granted[0].subject).toContain('100 GB');

    // Answered once only; the open queue is empty, the full list keeps it.
    expect((await adm.client.post(`/api/admin/storage-requests/${request.id}/grant`)).status).toBe(409);
    expect((await adm.client.post(`/api/admin/storage-requests/${request.id}/dismiss`)).status).toBe(409);
    expect((await adm.client.get('/api/admin/storage-requests')).body.requests).toEqual([]);
    expect((await adm.client.get('/api/admin/storage-requests?status=all')).body.requests).toHaveLength(1);

    const kinds = (await adm.client.get('/api/admin/audit')).body.events.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain('storage.grant');
    expect(kinds).toContain('quota.change');
  });

  test('Pro grants 1 TB, and a grant never lowers a larger quota', async () => {
    const ada = await user('ada3@test.local');
    const adm = await user('admin@test.local');
    const pro = (await ada.client.post('/api/me/storage-requests', { plan: 'pro' })).body.request;
    expect((await adm.client.post(`/api/admin/storage-requests/${pro.id}/grant`)).body.request.quotaBytes).toBe(1 * TiB);
    expect((await ada.client.get('/api/me/usage')).body.quotaBytes).toBe(1 * TiB);

    const ben = await user('ben3@test.local');
    const plus = (await ben.client.post('/api/me/storage-requests', { plan: 'plus' })).body.request;
    await db.update(userSettings).set({ quotaBytes: 500 * GiB }).where(eq(userSettings.userId, ben.userId));
    expect((await adm.client.post(`/api/admin/storage-requests/${plus.id}/grant`)).status).toBe(200);
    expect((await ben.client.get('/api/me/usage')).body.quotaBytes).toBe(500 * GiB);
  });

  test('dismiss leaves the quota alone and the person can ask again', async () => {
    const ada = await user('ada4@test.local');
    const adm = await user('admin@test.local');
    const { request } = (await ada.client.post('/api/me/storage-requests', { plan: 'plus' })).body;
    const dis = await adm.client.post(`/api/admin/storage-requests/${request.id}/dismiss`);
    expect(dis.status).toBe(200);
    expect(dis.body.request).toMatchObject({ status: 'dismissed', quotaBytes: DEFAULT_QUOTA_BYTES });
    expect((await ada.client.get('/api/me/usage')).body.quotaBytes).toBe(DEFAULT_QUOTA_BYTES);
    expect((await ada.client.get('/api/me/storage-requests')).body.request).toMatchObject({ status: 'dismissed' });
    expect(await mail.to('ada4@test.local', 'storage-granted')).toEqual([]);

    const again = await ada.client.post('/api/me/storage-requests', { plan: 'plus' });
    expect(again.status).toBe(201);
    expect(again.body.request.id).not.toBe(request.id);
    expect((await adm.client.post('/api/admin/storage-requests/nope/grant')).status).toBe(404);
  });

  test('deleting the account removes its requests', async () => {
    const ada = await user('ada5@test.local');
    await ada.client.post('/api/me/storage-requests', { plan: 'plus' });
    expect((await ada.client.del('/api/me', { confirm: 'ada5@test.local' })).status).toBe(204);
    expect(await db.select().from(storageRequests)).toEqual([]);
  });
});

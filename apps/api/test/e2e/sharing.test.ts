// End to end: share links (live vs pinned), the public pages' API without a
// session, revoke and expiry. User story 13.
import { afterAll, afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { TestClient } from '../helpers';
import { dec, endWorld, freshWorld, head, q, readZip, upload, user } from './kit';

beforeEach(() => freshWorld());
afterEach(() => {
  setSystemTime();
  endWorld();
});
afterAll(endWorld);

const anon = () => new TestClient('anonymous');

describe('share links', () => {
  test('live links follow the drive; pinned links keep their version', async () => {
    const a = await user('share@test.local');
    await upload(a, { '/Deck/slides.md': '# v1', '/Deck/notes.txt': 'n1' }, { dirs: ['/Deck/assets'] });
    const pinnedAt = await head(a);

    const live = await a.client.post(`/api/w/${a.ws}/links`, { path: '/Deck', mode: 'live' });
    expect(live.status).toBe(201);
    expect(live.body.link).toMatchObject({ mode: 'live', targetType: 'dir', commitId: null, path: '/Deck' });
    expect(live.body.link.url).toBe(`http://localhost:4100/s/${live.body.link.token}`);
    const pinned = await a.client.post(`/api/w/${a.ws}/links`, { path: '/Deck/slides.md', mode: 'pinned' });
    expect(pinned.status).toBe(201);
    expect(pinned.body.link).toMatchObject({ mode: 'pinned', targetType: 'file', commitId: pinnedAt });

    await upload(a, { '/Deck/slides.md': '# v2 — edited', '/Deck/extra.txt': 'new' });

    // Public access needs no session.
    const pub = anon();
    const lt = live.body.link.token;
    const meta = await pub.get(`/api/public/s/${lt}`);
    expect(meta.status).toBe(200);
    expect(meta.body).toMatchObject({ name: 'Deck', targetType: 'dir', mode: 'live', ownerName: 'share' });
    expect(JSON.stringify(meta.body)).not.toContain(a.ws);
    const files = await pub.get(`/api/public/s/${lt}/files?${q({ path: '/' })}`);
    expect(files.status).toBe(200);
    expect(files.body.entries.map((e: { path: string }) => e.path)).toEqual(['/assets', '/extra.txt', '/notes.txt', '/slides.md']);
    const liveContent = await pub.raw('GET', `/api/public/s/${lt}/content?${q({ path: '/slides.md' })}`);
    expect(await liveContent.text()).toBe('# v2 — edited');
    const zip = await pub.raw('GET', `/api/public/s/${lt}/zip`);
    expect(zip.status).toBe(200);
    const entries = readZip(new Uint8Array(await zip.arrayBuffer()));
    expect(dec(entries.get('extra.txt'))).toBe('new');
    expect(entries.has('assets/')).toBe(true);

    const pt = pinned.body.link.token;
    const pmeta = await pub.get(`/api/public/s/${pt}`);
    expect(pmeta.body).toMatchObject({ name: 'slides.md', targetType: 'file', mode: 'pinned', commitId: pinnedAt, size: 4 });
    const pinnedContent = await pub.raw('GET', `/api/public/s/${pt}/content`);
    expect(await pinnedContent.text()).toBe('# v1');
    const range = await pub.raw('GET', `/api/public/s/${pt}/content`, { headers: { range: 'bytes=2-3' } });
    expect(range.status).toBe(206);
    expect(await range.text()).toBe('v1');

    // The pinned link's version is tagged, so it counts against the budget and survives thinning.
    const cps = await a.client.get(`/api/w/${a.ws}/checkpoints`);
    expect(cps.body.budget.pinnedLinks).toBe(1);

    // Opens are counted (link info only).
    const links = await a.client.get(`/api/w/${a.ws}/links`);
    const byToken = Object.fromEntries(links.body.links.map((l: { token: string }) => [l.token, l]));
    expect(byToken[lt].openCount).toBe(1);
    const onlyDeck = await a.client.get(`/api/w/${a.ws}/links?${q({ path: '/Deck' })}`);
    expect(onlyDeck.body.links).toHaveLength(1);
  });

  test('revoke → 410 link_revoked and the pin tag is released', async () => {
    const a = await user('revoke@test.local');
    await upload(a, { '/r.txt': 'r' });
    const link = (await a.client.post(`/api/w/${a.ws}/links`, { path: '/r.txt', mode: 'pinned' })).body.link;
    expect((await anon().get(`/api/public/s/${link.token}`)).status).toBe(200);
    const del = await a.client.del(`/api/w/${a.ws}/links/${link.id}`);
    expect(del.status).toBe(204);
    const gone = await anon().get(`/api/public/s/${link.token}`);
    expect(gone.status).toBe(410);
    expect(gone.body.error.code).toBe('link_revoked');
    expect((await anon().raw('GET', `/api/public/s/${link.token}/content`)).status).toBe(410);
    expect((await a.client.get(`/api/w/${a.ws}/checkpoints`)).body.budget.pinnedLinks).toBe(0);
    // Revoking twice is harmless.
    expect((await a.client.del(`/api/w/${a.ws}/links/${link.id}`)).status).toBe(204);
  });

  test('expiry → 410 link_expired; the expiry can be changed; past dates are refused', async () => {
    const a = await user('expiry@test.local');
    await upload(a, { '/e.txt': 'e' });
    const inAnHour = new Date(Date.now() + 3600_000).toISOString();
    const link = (await a.client.post(`/api/w/${a.ws}/links`, { path: '/e.txt', mode: 'live', expiresAt: inAnHour })).body.link;
    expect(link.expiresAt).toBe(inAnHour);
    expect((await anon().get(`/api/public/s/${link.token}`)).status).toBe(200);
    setSystemTime(new Date(Date.now() + 2 * 3600_000));
    const expired = await anon().get(`/api/public/s/${link.token}`);
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe('link_expired');
    setSystemTime();
    const past = await a.client.patch(`/api/w/${a.ws}/links/${link.id}`, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(past.status).toBe(400);
    const never = await a.client.patch(`/api/w/${a.ws}/links/${link.id}`, { expiresAt: null });
    expect(never.body.link.expiresAt).toBeNull();
  });

  test('unknown tokens are 404; public paths cannot leave the link root', async () => {
    const a = await user('trav@test.local');
    await upload(a, { '/Public/ok.txt': 'ok', '/Private/secret.txt': 'secret' });
    const link = (await a.client.post(`/api/w/${a.ws}/links`, { path: '/Public', mode: 'live' })).body.link;
    expect((await anon().get('/api/public/s/not-a-real-token')).status).toBe(404);
    for (const p of ['/../Private/secret.txt', '../Private/secret.txt', '/..%2FPrivate/secret.txt']) {
      const r = await anon().raw('GET', `/api/public/s/${link.token}/content?path=${encodeURIComponent(p)}`);
      expect(r.status).toBe(404);
      expect(await r.text()).not.toContain('secret');
    }
    const l = await anon().get(`/api/public/s/${link.token}/files?${q({ path: '/..' })}`);
    expect(l.status).toBe(404);
    const z = await anon().raw('GET', `/api/public/s/${link.token}/zip?${q({ path: '/../Private' })}`);
    expect(z.status).toBe(404);
  });
});

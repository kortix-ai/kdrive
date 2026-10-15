// End to end: access controls on share links. A password (hash only, a
// short-lived unlock cookie bound to it, wrong attempts limited), view only
// (no download, zip or attachment; previews inline and uncached) and a list
// of people (verified sign-in with a listed address; the owner always passes).
import { afterAll, afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { TestClient } from '../helpers';
import { captureMail, type Mailbox } from '../mail';
import { endWorld, freshWorld, q, upload, user, type User } from './kit';

let mail: Mailbox | null = null;
beforeEach(() => freshWorld());
afterEach(() => {
  setSystemTime();
  mail?.restore();
  mail = null;
  endWorld();
});
afterAll(endWorld);

const anon = () => new TestClient('anonymous');

async function makeLink(u: User, body: Record<string, unknown>) {
  const res = await u.client.post(`/api/w/${u.ws}/links`, { mode: 'live', ...body });
  expect(res.status).toBe(201);
  return res.body.link as { id: string; token: string; url: string; hasPassword: boolean; allowDownload: boolean; allowedEmails: string[] };
}

describe('password', () => {
  test('every public read needs the unlock cookie; a new or removed password signs visitors out', async () => {
    const a = await user('pw@test.local');
    await upload(a, { '/Plans/q3.md': '# Q3' });
    const link = await makeLink(a, { path: '/Plans', password: 'open sesame' });
    expect(link.hasPassword).toBe(true);
    const listed = await a.client.get(`/api/w/${a.ws}/links`);
    expect(listed.text).not.toContain('argon2');
    expect(listed.text).not.toContain('open sesame');

    const v = anon();
    const base = `/api/public/s/${link.token}`;
    for (const path of [base, `${base}/files?${q({ path: '/' })}`, `${base}/content?${q({ path: '/q3.md' })}`, `${base}/zip`]) {
      const res = await v.get(path);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('link_password_required');
    }

    const wrong = await v.post(`${base}/unlock`, { password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('link_password_incorrect');
    expect(v.cookies.has('vx_link')).toBe(false);

    const right = await v.raw('POST', `${base}/unlock`, {
      body: JSON.stringify({ password: 'open sesame' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(right.status).toBe(204);
    const sc = right.headers.get('set-cookie') ?? '';
    expect(sc).toContain(`Path=${base}`);
    expect(sc).toContain('HttpOnly');
    expect(sc).toMatch(/Max-Age=43200/);

    expect((await v.get(base)).status).toBe(200);
    expect(await (await v.raw('GET', `${base}/content?${q({ path: '/q3.md' })}`)).text()).toBe('# Q3');
    // The cookie is bound to this link: another link of the same drive stays locked.
    const other = await makeLink(a, { path: '/Plans/q3.md', password: 'open sesame' });
    const otherRes = await new TestClient('x').raw('GET', `/api/public/s/${other.token}`, { headers: { cookie: v.cookieHeader() } });
    expect(otherRes.status).toBe(401);

    // A forged or tampered cookie does nothing.
    const forged = anon();
    forged.cookies.set('vx_link', `${Math.floor(Date.now() / 1000) + 3600}.${'A'.repeat(43)}`);
    expect((await forged.get(base)).status).toBe(401);

    // Setting the same password again still signs everyone out (the hash has a fresh salt).
    expect((await a.client.patch(`/api/w/${a.ws}/links/${link.id}`, { password: 'open sesame' })).status).toBe(200);
    expect((await v.get(base)).body.error.code).toBe('link_password_required');
    expect((await v.post(`${base}/unlock`, { password: 'open sesame' })).status).toBe(204);
    expect((await v.get(base)).status).toBe(200);

    // The unlock lasts 12 hours.
    setSystemTime(new Date(Date.now() + 12 * 3600_000 + 60_000));
    expect((await v.get(base)).status).toBe(401);
    setSystemTime();
    resetRateLimits(); // the buckets saw the clock jump

    // Removing the password opens the link to anyone again.
    const off = await a.client.patch(`/api/w/${a.ws}/links/${link.id}`, { password: null });
    expect(off.body.link.hasPassword).toBe(false);
    expect((await anon().get(base)).status).toBe(200);
  });

  test('wrong attempts are limited per link and address; a right password does not use one up', async () => {
    const a = await user('pwlimit@test.local');
    await upload(a, { '/s.txt': 's' });
    const link = await makeLink(a, { path: '/s.txt', password: 'correct horse' });
    const v = anon();
    const unlock = `/api/public/s/${link.token}/unlock`;
    for (let i = 0; i < 3; i++) expect((await v.post(unlock, { password: 'correct horse' })).status).toBe(204);
    for (let i = 0; i < 8; i++) expect((await v.post(unlock, { password: `guess ${i}` })).status).toBe(401);
    const limited = await v.post(unlock, { password: 'correct horse' });
    expect(limited.status).toBe(429);
    // Another address still gets in.
    const elsewhere = await new TestClient('y').raw('POST', unlock, {
      body: JSON.stringify({ password: 'correct horse' }),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    });
    expect(elsewhere.status).toBe(204);
  });

  test('passwords are validated', async () => {
    const a = await user('pwbad@test.local');
    await upload(a, { '/s.txt': 's' });
    const short = await a.client.post(`/api/w/${a.ws}/links`, { path: '/s.txt', mode: 'live', password: 'abc' });
    expect(short.status).toBe(400);
  });
});

describe('view only', () => {
  test('previews render inline and uncached; downloads, zips and attachments are refused', async () => {
    const a = await user('viewonly@test.local');
    await upload(a, { '/Deck/a.png': 'png-bytes', '/Deck/page.html': '<b>hi</b>', '/Deck/data.bin': 'bin' });
    const link = await makeLink(a, { path: '/Deck', mode: 'pinned', allowDownload: false });
    expect(link.allowDownload).toBe(false);
    const v = anon();
    const base = `/api/public/s/${link.token}`;

    const meta = await v.get(base);
    expect(meta.status).toBe(200);
    expect(meta.body.allowDownload).toBe(false);

    const img = await v.raw('GET', `${base}/content?${q({ path: '/a.png' })}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('cache-control')).toBe('no-store');
    expect(img.headers.get('content-disposition')).toStartWith('inline');
    // Active content is still plain text, and inline rather than an attachment.
    const html = await v.raw('GET', `${base}/content?${q({ path: '/page.html' })}`);
    expect(html.headers.get('content-type')).toStartWith('text/plain');
    expect(html.headers.get('content-disposition')).toStartWith('inline');

    for (const path of [`${base}/content?${q({ path: '/a.png', download: '1' })}`, `${base}/zip`, `${base}/zip?${q({ path: '/a.png' })}`]) {
      const res = await v.get(path);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('download_disabled');
    }

    // Turning downloads back on.
    const on = await a.client.patch(`/api/w/${a.ws}/links/${link.id}`, { allowDownload: true });
    expect(on.body.link.allowDownload).toBe(true);
    expect((await v.raw('GET', `${base}/zip`)).status).toBe(200);
  });

  test('a single-file view-only link refuses its download too', async () => {
    const a = await user('viewonly1@test.local');
    await upload(a, { '/r.pdf': '%PDF-1.4' });
    const link = await makeLink(a, { path: '/r.pdf', allowDownload: false });
    expect((await anon().get(`/api/public/s/${link.token}/zip`)).status).toBe(403);
    expect((await anon().raw('GET', `/api/public/s/${link.token}/content`)).status).toBe(200);
  });
});

describe('specific people', () => {
  test('only verified listed addresses (and the owner) open it; listed people get mail', async () => {
    mail = captureMail();
    const a = await user('owner@test.local');
    await upload(a, { '/Report/r.md': '# r' });
    const link = await makeLink(a, { path: '/Report', allowedEmails: [' Bea@Test.local ', 'bea@test.local', 'cy@test.local'] });
    expect(link.allowedEmails).toEqual(['bea@test.local', 'cy@test.local']);

    const toBea = await mail.to('bea@test.local', 'link-shared');
    expect(toBea).toHaveLength(1);
    expect(toBea[0].subject).toContain('Report');
    expect(toBea[0].text).toContain(link.url);
    expect(await mail.to('cy@test.local', 'link-shared')).toHaveLength(1);

    const base = `/api/public/s/${link.token}`;
    const out = await anon().get(base);
    expect(out.status).toBe(401);
    expect(out.body.error.code).toBe('link_sign_in_required');
    expect(out.text).not.toContain('Report');
    expect((await anon().get(`${base}/files`)).body.error.code).toBe('link_sign_in_required');

    const dee = await user('dee@test.local');
    const wrong = await dee.client.get(base);
    expect(wrong.status).toBe(403);
    expect(wrong.body.error).toMatchObject({ code: 'link_wrong_account', details: { email: 'dee@test.local' } });

    const bea = await user('bea@test.local');
    expect((await bea.client.get(base)).status).toBe(200);
    expect((await bea.client.raw('GET', `${base}/content?${q({ path: '/r.md' })}`)).status).toBe(200);
    expect((await a.client.get(base)).status).toBe(200);

    // Adding people mails only the new ones; removing them closes the link to them.
    expect(await mail.to('dee@test.local', 'link-shared')).toHaveLength(0);
    const upd = await a.client.patch(`/api/w/${a.ws}/links/${link.id}`, { allowedEmails: ['cy@test.local', 'dee@test.local'] });
    expect(upd.status).toBe(200);
    expect(await mail.to('dee@test.local', 'link-shared')).toHaveLength(1);
    expect(await mail.to('cy@test.local', 'link-shared')).toHaveLength(1);
    expect((await dee.client.get(base)).status).toBe(200);
    expect((await bea.client.get(base)).status).toBe(403);

    // An empty list opens the link to anyone again.
    await a.client.patch(`/api/w/${a.ws}/links/${link.id}`, { allowedEmails: [] });
    expect((await anon().get(base)).status).toBe(200);
  });

  test('people and password combine: the person comes first, then the password', async () => {
    const a = await user('both@test.local');
    await upload(a, { '/x.txt': 'x' });
    const link = await makeLink(a, { path: '/x.txt', allowedEmails: ['eve@test.local'], password: 'two locks' });
    const base = `/api/public/s/${link.token}`;
    const stranger = await user('mal@test.local');
    // A stranger never reaches the password form, even with the right password.
    const tried = await stranger.client.post(`${base}/unlock`, { password: 'two locks' });
    expect(tried.status).toBe(403);
    expect(tried.body.error.code).toBe('link_wrong_account');

    const eve = await user('eve@test.local');
    expect((await eve.client.get(base)).body.error.code).toBe('link_password_required');
    expect((await eve.client.post(`${base}/unlock`, { password: 'two locks' })).status).toBe(204);
    expect(await (await eve.client.raw('GET', `${base}/content`)).text()).toBe('x');
  });

  test('lists are validated', async () => {
    const a = await user('many@test.local');
    await upload(a, { '/x.txt': 'x' });
    const tooMany = Array.from({ length: 51 }, (_, i) => `p${i}@test.local`);
    expect((await a.client.post(`/api/w/${a.ws}/links`, { path: '/x.txt', mode: 'live', allowedEmails: tooMany })).status).toBe(400);
    expect((await a.client.post(`/api/w/${a.ws}/links`, { path: '/x.txt', mode: 'live', allowedEmails: ['not an email'] })).status).toBe(400);
  });
});

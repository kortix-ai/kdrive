// End to end security: workspace isolation, path traversal, active content
// never rendered inline, CSRF origin / content-type checks, admin gating.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { workspaces } from '../../src/db/schema';
import { makeApp } from '../helpers';
import { endWorld, freshWorld, q, upload, user } from './kit';

beforeEach(() => freshWorld());
afterEach(endWorld);
afterAll(endWorld);

describe('workspace isolation', () => {
  test("another user's workspace is indistinguishable from a missing one, on every route", async () => {
    const alice = await user('alice@test.local');
    const bob = await user('bob@test.local');
    const up = await upload(alice, { '/private.txt': 'alice only' });
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, alice.ws));
    const cp = await alice.client.post(`/api/w/${alice.ws}/checkpoints`, { name: 'Mine' });
    const link = await alice.client.post(`/api/w/${alice.ws}/links`, { path: '/private.txt', mode: 'live' });

    const w = alice.ws;
    const gets = [
      `/api/w/${w}/files`,
      `/api/w/${w}/files/stat?${q({ path: '/private.txt' })}`,
      `/api/w/${w}/files/content?${q({ path: '/private.txt' })}`,
      `/api/w/${w}/files/zip?${q({ paths: '/' })}`,
      `/api/w/${w}/search?q=private`,
      `/api/w/${w}/timeline`,
      `/api/w/${w}/commits/head`,
      `/api/w/${w}/versions?${q({ path: '/private.txt' })}`,
      `/api/w/${w}/deleted`,
      `/api/w/${w}/checkpoints`,
      `/api/w/${w}/links`,
    ];
    for (const p of gets) {
      const r = await bob.client.raw('GET', p);
      expect(`${p} ${r.status}`).toBe(`${p} 404`);
      expect(await r.text()).not.toContain('alice only');
    }
    const posts: [string, string, unknown][] = [
      ['POST', `/api/w/${w}/folders`, { path: '/x' }],
      ['POST', `/api/w/${w}/files/delete`, { paths: ['/private.txt'] }],
      ['POST', `/api/w/${w}/files/move`, { items: [{ from: '/private.txt', to: '/p.txt' }] }],
      ['POST', `/api/w/${w}/uploads`, { files: [], dirs: ['/y'], conflict: 'replace' }],
      ['POST', `/api/w/${w}/restore`, { scope: 'drive', at: 'head' }],
      ['POST', `/api/w/${w}/actions/${up.commit.action.id}/undo`, {}],
      ['POST', `/api/w/${w}/checkpoints`, { name: 'x' }],
      ['DELETE', `/api/w/${w}/checkpoints/${cp.body.checkpoint.id}`, undefined],
      ['DELETE', `/api/w/${w}/links/${link.body.link.id}`, undefined],
      ['POST', `/api/workspaces/${w}/duplicate`, { name: 'stolen' }],
      ['PATCH', `/api/workspaces/${w}`, { name: 'renamed' }],
      ['DELETE', `/api/workspaces/${w}`, undefined],
    ];
    for (const [m, p, body] of posts) {
      const r = await bob.client.raw(m, p, {
        body: body === undefined ? null : JSON.stringify(body),
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
      });
      expect(`${m} ${p} ${r.status}`).toBe(`${m} ${p} 404`);
    }
    // Bob's own actions cannot target Alice's action ids either.
    expect((await bob.client.post(`/api/w/${bob.ws}/actions/${up.commit.action.id}/undo`, {})).status).toBe(404);
    // A raw volume id in the workspace slot is never accepted.
    expect((await alice.client.get(`/api/w/${row.volumeId}/files`)).status).toBe(404);
    // Nothing changed for Alice.
    const mine = await alice.client.get(`/api/w/${w}/files`);
    expect(mine.body.entries.map((e: { name: string }) => e.name)).toEqual(['private.txt']);
    expect((await alice.client.get('/api/workspaces')).body.workspaces[0].name).toBe('My Drive');
  });
});

describe('paths', () => {
  test('traversal and invalid names are rejected at the API', async () => {
    const a = await user('paths@test.local');
    await upload(a, { '/in.txt': 'in' });
    const tries = [
      a.client.get(`/api/w/${a.ws}/files?${q({ path: '/../../etc' })}`),
      a.client.get(`/api/w/${a.ws}/files/content?${q({ path: '../in.txt' })}`),
      a.client.post(`/api/w/${a.ws}/folders`, { path: '/../escape' }),
      a.client.post(`/api/w/${a.ws}/files/copy`, { items: [{ from: '/in.txt', to: '/../../out.txt' }] }),
      a.client.post(`/api/w/${a.ws}/uploads`, { files: [{ path: '/../x.txt', size: 0, blocks: [] }], dirs: [], conflict: 'replace' }),
      a.client.post(`/api/w/${a.ws}/uploads`, { files: [{ path: '/a\u0000b', size: 0, blocks: [] }], dirs: [], conflict: 'replace' }),
    ];
    for (const r of await Promise.all(tries)) {
      expect(r.status).toBe(400);
      expect(['invalid_path', 'invalid_name', 'bad_request']).toContain(r.body.error.code);
    }
  });
});

describe('active content', () => {
  test('HTML, SVG, XML and JS are never served inline as themselves', async () => {
    const a = await user('xss@test.local');
    await upload(a, {
      '/page.html': '<script>alert(1)</script>',
      '/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
      '/feed.xml': '<x/>',
      '/app.js': 'alert(1)',
      '/photo.png': 'png',
      '/doc.pdf': '%PDF-1.4',
    });
    for (const name of ['page.html', 'logo.svg', 'feed.xml', 'app.js']) {
      const r = await a.client.raw('GET', `/api/w/${a.ws}/files/content?${q({ path: `/${name}` })}`);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(r.headers.get('content-disposition')).toStartWith('attachment');
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      const csp = r.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain('sandbox');
    }
    const png = await a.client.raw('GET', `/api/w/${a.ws}/files/content?${q({ path: '/photo.png' })}`);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect(png.headers.get('content-disposition')).toStartWith('inline');
    const pdf = await a.client.raw('GET', `/api/w/${a.ws}/files/content?${q({ path: '/doc.pdf' })}`);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('content-security-policy')).not.toContain('sandbox');

    // The same rules hold on public links.
    const link = (await a.client.post(`/api/w/${a.ws}/links`, { path: '/logo.svg', mode: 'live' })).body.link;
    const pub = await makeApp().fetch(new Request(`http://localhost:4101/api/public/s/${link.token}/content`));
    expect(pub.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(pub.headers.get('content-disposition')).toStartWith('attachment');
  });
});

describe('CSRF', () => {
  test('mutations need a same-origin Origin and a JSON body; reads do not', async () => {
    const a = await user('csrf2@test.local');
    const cookie = a.client.cookieHeader();
    const send = (headers: Record<string, string>, body = '{"path":"/x"}') =>
      makeApp().fetch(new Request(`http://localhost:4101/api/w/${a.ws}/folders`, { method: 'POST', headers: { cookie, ...headers }, body }));

    const none = await send({ 'content-type': 'application/json' });
    expect(none.status).toBe(403);
    expect((await none.json()).error.code).toBe('csrf');
    const evil = await send({ 'content-type': 'application/json', origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    const form = await send({ 'content-type': 'text/plain', origin: 'http://localhost:4100' });
    expect(form.status).toBe(403);
    const urlenc = await send({ 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost:4100' }, 'path=/x');
    expect(urlenc.status).toBe(403);
    // DELETE /api/me is a mutation too.
    const del = await makeApp().fetch(
      new Request('http://localhost:4101/api/me', {
        method: 'DELETE',
        headers: { cookie, 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify({ confirm: 'csrf2@test.local' }),
      }),
    );
    expect(del.status).toBe(403);
    expect((await a.client.get('/api/me')).status).toBe(200);

    const good = await send({ 'content-type': 'application/json', origin: 'http://localhost:4100' });
    expect(good.status).toBe(200);
    // A read with no Origin is fine (same-origin GETs omit it).
    const read = await makeApp().fetch(new Request(`http://localhost:4101/api/w/${a.ws}/files`, { headers: { cookie } }));
    expect(read.status).toBe(200);
  });

  test('responses never leak the storage token or the volume id', async () => {
    const a = await user('leak@test.local');
    await upload(a, { '/f.txt': 'f' });
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, a.ws));
    for (const p of ['/api/me', `/api/w/${a.ws}/files`, `/api/w/${a.ws}/timeline`, `/api/workspaces`, '/api/config']) {
      const r = await a.client.get(p);
      expect(r.text).not.toContain(row.volumeId!);
      expect(r.text).not.toContain('PT_TOKEN');
    }
  });
});

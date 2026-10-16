// End to end: upload links. People without an account send files into one
// folder; they never list or read it, nothing is overwritten, every file is
// one undoable action charged to the drive owner, and the limits hold.
import { afterAll, afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { userSettings } from '../../src/db/schema';
import { TestClient } from '../helpers';
import { captureMail, type Mailbox } from '../mail';
import { endWorld, freshWorld, ls, q, text, timeline, upload, user, type User } from './kit';

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

async function uploadLink(a: User, path: string, extra: Record<string, unknown> = {}) {
  const r = await a.client.post(`/api/w/${a.ws}/links`, { path, mode: 'live', kind: 'upload', ...extra });
  if (r.status !== 201) throw new Error(`link ${r.status}: ${r.text}`);
  return r.body.link as { id: string; token: string; url: string; kind: string };
}

/** Sends one file through an upload link, as the public page does. */
async function send(
  token: string,
  name: string,
  body: string | Uint8Array,
  opts: { sender?: string; contentType?: string; as?: TestClient } = {},
) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const res = await (opts.as ?? anon()).raw('POST', `/api/public/u/${token}/files?${q({ name, sender: opts.sender })}`, {
    body: bytes as unknown as BodyInit,
    headers: { 'content-type': opts.contentType ?? 'application/octet-stream', 'content-length': String(bytes.length) },
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : null };
}

describe('upload links', () => {
  test('people send files into the folder; clashes are renamed, never overwritten; each file is one undoable action', async () => {
    const a = await user('inbox@test.local');
    await upload(a, { '/Inbox/report.pdf': 'original', '/Private/secret.txt': 'secret' });
    const link = await uploadLink(a, '/Inbox');
    expect(link.kind).toBe('upload');
    expect(link.url).toBe(`http://localhost:4100/u/${link.token}`);

    const meta = await anon().get(`/api/public/u/${link.token}`);
    expect(meta.status).toBe(200);
    expect(meta.body).toMatchObject({ name: 'Inbox', ownerName: 'inbox', remainingFiles: null });
    expect(JSON.stringify(meta.body)).not.toContain('report.pdf');

    // An upload link never opens as a view link, and a view link never takes files.
    expect((await anon().get(`/api/public/s/${link.token}`)).status).toBe(404);
    expect((await anon().get(`/api/public/s/${link.token}/files`)).status).toBe(404);
    const view = (await a.client.post(`/api/w/${a.ws}/links`, { path: '/Inbox', mode: 'live' })).body.link;
    expect((await anon().get(`/api/public/u/${view.token}`)).status).toBe(404);
    expect((await send(view.token, 'x.txt', 'x')).status).toBe(404);

    const first = await send(link.token, 'report.pdf', 'from Ana', { sender: 'Ana' });
    expect(first.status).toBe(201);
    // The response names what was sent, never what the folder already held.
    expect(first.body).toEqual({ name: 'report.pdf', size: 8 });
    await send(link.token, 'report.pdf', 'from Ben');
    expect(await ls(a, '/Inbox')).toEqual(['report (1).pdf', 'report (2).pdf', 'report.pdf']);
    expect(await text(a, '/Inbox/report.pdf')).toBe('original');
    expect(await text(a, '/Inbox/report (1).pdf')).toBe('from Ana');

    const entries = await timeline(a);
    expect(entries[0]).toMatchObject({ kind: 'upload', summary: 'Upload link · Someone sent report (2).pdf to /Inbox', undoable: true });
    expect(entries[1]).toMatchObject({ kind: 'upload', summary: 'Upload link · Ana sent report (1).pdf to /Inbox' });

    // Undo like any other action.
    const undo = await a.client.post(`/api/w/${a.ws}/actions/${entries[0].actionId}/undo`, {});
    expect(undo.status).toBe(200);
    expect(await ls(a, '/Inbox')).toEqual(['report (1).pdf', 'report.pdf']);

    // The links list shows opens and files received.
    const list = (await a.client.get(`/api/w/${a.ws}/links?${q({ path: '/Inbox' })}`)).body.links;
    const mine = list.find((l: { id: string }) => l.id === link.id);
    expect(mine).toMatchObject({ kind: 'upload', openCount: 1, uploadCount: 2, uploadBytes: 16 });
  });

  test('folders come along; names that climb out of the folder are refused', async () => {
    const a = await user('folders@test.local');
    await upload(a, { '/Drop/keep.txt': 'k', '/Private/secret.txt': 'secret' });
    const link = await uploadLink(a, '/Drop');
    expect((await send(link.token, 'Trip/day 1/a.txt', 'a')).status).toBe(201);
    expect(await ls(a, '/Drop/Trip/day 1')).toEqual(['a.txt']);
    // Undoing it takes the folders away too.
    const [last] = await timeline(a);
    await a.client.post(`/api/w/${a.ws}/actions/${last.actionId}/undo`, {});
    expect(await ls(a, '/Drop')).toEqual(['keep.txt']);

    for (const name of ['../Private/x.txt', 'a/../../x.txt', '..', '.', '/abs.txt', 'a//b.txt', 'a\\b.txt', '', 'bad\u0001.txt']) {
      const r = await send(link.token, name, 'evil');
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('invalid_name');
    }
    expect(await ls(a, '/Private')).toEqual(['secret.txt']);
    expect(await ls(a, '/')).toEqual(['Drop/', 'Private/']);
  });

  test('only a folder, only live; the body must be raw bytes of the declared length', async () => {
    const a = await user('rules@test.local');
    await upload(a, { '/F/a.txt': 'a' });
    expect((await a.client.post(`/api/w/${a.ws}/links`, { path: '/F/a.txt', mode: 'live', kind: 'upload' })).status).toBe(400);
    expect((await a.client.post(`/api/w/${a.ws}/links`, { path: '/F', mode: 'pinned', kind: 'upload' })).status).toBe(400);
    const link = await uploadLink(a, '/F');
    expect((await send(link.token, 'j.txt', '{}', { contentType: 'application/json' })).status).toBe(403);
    const short = await anon().raw('POST', `/api/public/u/${link.token}/files?${q({ name: 'short.txt' })}`, {
      body: 'abc',
      headers: { 'content-type': 'application/octet-stream', 'content-length': '10' },
    });
    expect(short.status).toBeGreaterThanOrEqual(400);
    expect(await ls(a, '/F')).toEqual(['a.txt']);
    // An empty file is fine; a large one is hashed into 1 MiB blocks on the way in.
    expect((await send(link.token, 'empty.txt', '')).status).toBe(201);
    const big = new Uint8Array(2.5 * 1024 * 1024).map((_, i) => (i * 31) % 251);
    expect((await send(link.token, 'big.bin', big)).status).toBe(201);
    const got = await a.client.raw('GET', `/api/w/${a.ws}/files/content?${q({ path: '/F/big.bin' })}`);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(big);
  });

  test('max files, max file size and the owner quota', async () => {
    const a = await user('limits@test.local');
    await upload(a, {}, { dirs: ['/In'] });
    const link = await uploadLink(a, '/In', { maxFiles: 2, maxFileBytes: 10 });
    expect((await anon().get(`/api/public/u/${link.token}`)).body).toMatchObject({ maxFileBytes: 10, remainingFiles: 2 });
    const big = await send(link.token, 'big.txt', '12345678901');
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('payload_too_large');
    expect((await send(link.token, '1.txt', '1')).status).toBe(201);
    expect((await send(link.token, '2.txt', '2')).status).toBe(201);
    const third = await send(link.token, '3.txt', '3');
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('upload_limit');
    expect((await anon().get(`/api/public/u/${link.token}`)).body.remainingFiles).toBe(0);

    // The owner's quota: a sender learns only that the folder is full.
    const open = await uploadLink(a, '/In');
    await db.update(userSettings).set({ quotaBytes: 1 }).where(eq(userSettings.userId, a.userId));
    const full = await send(open.token, 'more.txt', 'more');
    expect(full.status).toBe(413);
    expect(full.body.error).toEqual({ code: 'folder_full', message: "This folder can't accept more files right now." });
    expect(await ls(a, '/In')).toEqual(['1.txt', '2.txt']);
    // A refused file is not counted.
    const l = (await a.client.get(`/api/w/${a.ws}/links`)).body.links.find((x: { id: string }) => x.id === open.id);
    expect(l.uploadCount).toBe(0);
  });

  test('revoked or expired links take nothing; the link follows its folder and detaches when it is deleted', async () => {
    const a = await user('life@test.local');
    await upload(a, {}, { dirs: ['/Box'] });
    const link = await uploadLink(a, '/Box');

    const mv = await a.client.post(`/api/w/${a.ws}/files/move`, { items: [{ from: '/Box', to: '/Moved' }] });
    expect(mv.status).toBe(200);
    expect((await send(link.token, 'x.txt', 'x')).status).toBe(201);
    expect(await ls(a, '/Moved')).toEqual(['x.txt']);

    const other = await uploadLink(a, '/Moved');
    await a.client.del(`/api/w/${a.ws}/links/${other.id}`);
    const revoked = await send(other.token, 'r.txt', 'r');
    expect(revoked.status).toBe(410);
    expect(revoked.body.error.code).toBe('link_revoked');

    const live = await uploadLink(a, '/Moved');
    await a.client.post(`/api/w/${a.ws}/files/delete`, { paths: ['/Moved'] });
    await upload(a, {}, { dirs: ['/Moved'] });
    expect((await send(live.token, 'y.txt', 'y')).status).toBe(404);
    expect(await ls(a, '/Moved')).toEqual([]);

    // Last: moving the clock forward.
    await upload(a, {}, { dirs: ['/Soon'] });
    const soon = await uploadLink(a, '/Soon', { expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    setSystemTime(new Date(Date.now() + 2 * 3600_000));
    const expired = await send(soon.token, 'late.txt', 'late');
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe('link_expired');
  });

  test('one address cannot flood a link', async () => {
    const a = await user('flood@test.local');
    await upload(a, {}, { dirs: ['/F'] });
    const link = await uploadLink(a, '/F');
    let limited = 0;
    for (let i = 0; i < 130 && !limited; i++) {
      const r = await send(link.token, `${i}.txt`, '');
      if (r.status === 429) limited = i;
    }
    expect(limited).toBeGreaterThanOrEqual(100);
  });
});

describe('upload links with access controls', () => {
  test('a password gates the page and every file; the unlock cookie is the upload link\'s own', async () => {
    const a = await user('pwbox@test.local');
    await upload(a, {}, { dirs: ['/Box'] });
    const link = await uploadLink(a, '/Box', { password: 'let me in', allowDownload: false });
    expect(link).toMatchObject({ hasPassword: true, allowDownload: true });

    const v = anon();
    const meta = await v.get(`/api/public/u/${link.token}`);
    expect(meta.status).toBe(401);
    expect(meta.body.error.code).toBe('link_password_required');
    expect(meta.text).not.toContain('Box');
    const locked = await send(link.token, 'a.txt', 'a', { as: v });
    expect(locked.status).toBe(401);
    expect(locked.body.error.code).toBe('link_password_required');

    expect((await v.post(`/api/public/u/${link.token}/unlock`, { password: 'nope' })).body.error.code).toBe('link_password_incorrect');
    const ok = await v.raw('POST', `/api/public/u/${link.token}/unlock`, {
      body: JSON.stringify({ password: 'let me in' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('set-cookie')).toContain(`Path=/api/public/u/${link.token}`);
    expect((await v.get(`/api/public/u/${link.token}`)).status).toBe(200);
    expect((await send(link.token, 'a.txt', 'a', { as: v })).status).toBe(201);
    expect(await ls(a, '/Box')).toEqual(['a.txt']);

    // A new password signs the sender out.
    await a.client.patch(`/api/w/${a.ws}/links/${link.id}`, { password: 'another one' });
    expect((await send(link.token, 'b.txt', 'b', { as: v })).status).toBe(401);
    expect(await ls(a, '/Box')).toEqual(['a.txt']);
  });

  test('only listed people (signed in, verified) can send; the mail asks them to send files', async () => {
    mail = captureMail();
    const a = await user('peoplebox@test.local');
    await upload(a, {}, { dirs: ['/Inbox'] });
    const link = await uploadLink(a, '/Inbox', { allowedEmails: ['bea@test.local'] });
    const toBea = await mail.to('bea@test.local', 'link-shared');
    expect(toBea).toHaveLength(1);
    expect(toBea[0].subject).toContain('send files to');
    expect(toBea[0].text).toContain(`/u/${link.token}`);

    const out = await send(link.token, 'x.txt', 'x');
    expect(out.status).toBe(401);
    expect(out.body.error.code).toBe('link_sign_in_required');
    expect((await anon().get(`/api/public/u/${link.token}`)).body.error.code).toBe('link_sign_in_required');

    const dee = await user('dee-box@test.local');
    const wrong = await send(link.token, 'x.txt', 'x', { as: dee.client });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('link_wrong_account');

    const bea = await user('bea@test.local');
    expect((await bea.client.get(`/api/public/u/${link.token}`)).status).toBe(200);
    expect((await send(link.token, 'from-bea.txt', 'hi', { as: bea.client, sender: 'Bea' })).status).toBe(201);
    expect(await ls(a, '/Inbox')).toEqual(['from-bea.txt']);
  });
});

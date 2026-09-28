// API-files: uploads (block relay, dedup, quota, conflicts, multi-plan), listing,
// content (Range, security headers), zip, folders, move / rename / copy, delete, search.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { BLOCK_SIZE } from '@volumes/shared';
import { db } from '../db/client';
import { actionPaths, actions, uploads, userSettings, workspaces } from '../db/schema';
import { getStore } from '../storage';
import { resetRateLimits } from '../middleware/rate-limit';
import { blocksOf, enc, resetDb, sha256Hex, signInWithWorkspace, uploadFile, type TestClient } from '../../test/helpers';

let n = 0;
const email = (tag: string) => `files-${tag}-${Date.now().toString(36)}-${n++}@test.local`;

// The emulator allows 25 live volumes per process (like a Platinum org) and
// resetDb() does not delete volumes, so every test drops the volumes it made.
const created: string[] = [];
async function setup(tag: string) {
  const r = await signInWithWorkspace(email(tag));
  const [row] = await db.select({ v: workspaces.volumeId }).from(workspaces).where(eq(workspaces.id, r.ws));
  if (row?.v) created.push(row.v);
  return r;
}
async function dropVolumes() {
  for (const v of created.splice(0)) await getStore().deleteVolume(v, { missingOk: true }).catch(() => {});
}

async function wsActions(ws: string) {
  return db.select().from(actions).where(eq(actions.workspaceId, ws));
}

async function list(client: TestClient, ws: string, path = '/', at?: string) {
  const q = new URLSearchParams({ path });
  if (at) q.set('at', at);
  return client.get(`/api/w/${ws}/files?${q}`);
}

function contentPath(ws: string, path: string, extra: Record<string, string> = {}) {
  return `/api/w/${ws}/files/content?${new URLSearchParams({ path, ...extra })}`;
}

/** Minimal zip reader (client-zip stores entries uncompressed). */
function readZip(buf: Uint8Array): Map<string, Uint8Array | null> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('no end of central directory');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array | null>();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) throw new Error('bad central directory entry');
    const csize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const local = dv.getUint32(off + 42, true);
    const name = dec.decode(buf.subarray(off + 46, off + 46 + nameLen));
    const lNameLen = dv.getUint16(local + 26, true);
    const lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    out.set(name, name.endsWith('/') ? null : buf.subarray(start, start + csize));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

beforeAll(resetDb);
// Many sign-ins in one file: keep the dev sign-in limiter (10/min per IP) out of the way.
beforeEach(() => resetRateLimits());
afterEach(dropVolumes);
afterAll(dropVolumes);

describe('uploads', () => {
  test('plan → PUT only missing → commit = one committed action; same bytes again → missing []', async () => {
    const { client, ws } = await setup('up');
    const data = new Uint8Array(BLOCK_SIZE * 2 + 1234);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) % 251;
    const first = await uploadFile(client, ws, '/big.bin', data, { conflict: 'ask' });
    expect(first.plan.missing).toHaveLength(3);
    expect(first.sent).toBe(3);
    expect(first.plan.uploadId).toMatch(/^[0-9a-z]{26}$/);
    expect(JSON.stringify(first.plan)).not.toContain('vu_'); // the Platinum upload id stays server-side
    expect(first.commit.files).toBe(1);
    expect(first.commit.action).toMatchObject({ kind: 'upload', status: 'committed', summary: 'Uploaded big.bin', undoable: true });

    const rows = await wsActions(ws);
    expect(rows.filter((a) => a.status === 'committed')).toHaveLength(1);
    const paths = await db.select().from(actionPaths).where(eq(actionPaths.actionId, first.commit.action.id));
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatchObject({ op: 'added', path: '/big.bin', entryType: 'file', size: data.length });
    expect(paths[0].blockHashes).toEqual(blocksOf(data).map((b) => b.sha));

    const [up] = await db.select().from(uploads).where(eq(uploads.id, first.plan.uploadId));
    expect(up.status).toBe('committed');
    expect(up.ptUploadId).toMatch(/^vu_/);

    // Same bytes under another name: every block is already stored.
    const again = await uploadFile(client, ws, '/copy.bin', data, { conflict: 'ask' });
    expect(again.plan.missing).toEqual([]);
    expect(again.sent).toBe(0);

    const got = await client.raw('GET', contentPath(ws, '/copy.bin'));
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(data);

    // Replacing with identical bytes sends nothing (a new mtime still makes a version).
    const same = await uploadFile(client, ws, '/big.bin', data, { conflict: 'replace' });
    expect(same.sent).toBe(0);
    expect(same.commit.action.summary).toBe('Replaced big.bin');
  });

  test('quota: an upload that would exceed it is 413 with overBytes, and no uploads row', async () => {
    const { client, ws, me } = await setup('quota');
    await uploadFile(client, ws, '/a.txt', 'x'.repeat(5000)); // 8 KiB logical
    await db.update(userSettings).set({ quotaBytes: 16384 }).where(eq(userSettings.userId, me.user.id));
    const size = 20_000;
    const blocks = [sha256Hex(new Uint8Array(size))];
    const r = await client.post(`/api/w/${ws}/uploads`, { files: [{ path: '/b.bin', size, blocks }], dirs: [], conflict: 'ask' });
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('quota_exceeded');
    expect(r.body.error.details).toEqual({ usedBytes: 8192, quotaBytes: 16384, requestedBytes: 20480, overBytes: 12288 });
    const rows = await db.select().from(uploads).where(eq(uploads.workspaceId, ws));
    expect(rows.filter((u) => u.plan.files.some((f) => f.path === '/b.bin'))).toHaveLength(0);
    // Replacing a file only counts the growth.
    const ok = await client.post(`/api/w/${ws}/uploads`, {
      files: [{ path: '/a.txt', size: 6000, blocks: [sha256Hex('y'.repeat(6000))] }],
      dirs: [],
      conflict: 'replace',
    });
    expect(ok.status).toBe(200);
    await client.del(`/api/w/${ws}/uploads/${ok.body.uploadId}`);
  });

  test('conflicts: ask → 409 {conflicts}; keep-both → "a (1).txt"; replace → changed', async () => {
    const { client, ws } = await setup('conflict');
    await uploadFile(client, ws, '/a.txt', 'one', { conflict: 'ask' });
    const blocks = [sha256Hex('two')];
    const ask = await client.post(`/api/w/${ws}/uploads`, { files: [{ path: '/a.txt', size: 3, blocks }], conflict: 'ask' });
    expect(ask.status).toBe(409);
    expect(ask.body.error).toMatchObject({ code: 'conflict', details: { conflicts: ['/a.txt'] } });

    const kb = await uploadFile(client, ws, '/a.txt', 'two', { conflict: 'keep-both' });
    expect(kb.plan.renamed).toEqual([{ from: '/a.txt', to: '/a (1).txt' }]);
    const kb2 = await uploadFile(client, ws, '/a.txt', 'three', { conflict: 'keep-both' });
    expect(kb2.plan.renamed).toEqual([{ from: '/a.txt', to: '/a (2).txt' }]);

    const rep = await uploadFile(client, ws, '/a.txt', 'four', { conflict: 'replace' });
    expect(rep.commit.action.summary).toBe('Replaced a.txt');
    const [row] = await db.select().from(actionPaths).where(eq(actionPaths.actionId, rep.commit.action.id));
    expect(row).toMatchObject({ op: 'changed', size: 4, prevSize: 3 });

    const names = (await list(client, ws)).body.entries.map((e: { name: string }) => e.name);
    expect(names).toEqual(['a (1).txt', 'a (2).txt', 'a.txt']);
    const txt = await client.raw('GET', contentPath(ws, '/a.txt'));
    expect(await txt.text()).toBe('four');
  });

  test('folder upload keeps the tree and empty dirs as one action', async () => {
    const { client, ws } = await setup('tree');
    const files = [
      { path: '/Trip/a.txt', data: enc('a') },
      { path: '/Trip/day 1/b.txt', data: enc('bb') },
    ];
    const plan = await client.post(`/api/w/${ws}/uploads`, {
      files: files.map((f) => ({ path: f.path, size: f.data.length, blocks: [sha256Hex(f.data)] })),
      dirs: ['/Trip/empty'],
      conflict: 'ask',
    });
    expect(plan.status).toBe(200);
    for (const f of files) {
      const sha = sha256Hex(f.data);
      if (!plan.body.missing.includes(sha)) continue;
      const r = await client.raw('PUT', `/api/w/${ws}/uploads/${plan.body.uploadId}/blocks/${sha}`, {
        body: f.data as unknown as BodyInit,
        headers: { 'content-type': 'application/octet-stream' },
      });
      expect(r.status).toBe(204);
    }
    const commit = await client.post(`/api/w/${ws}/uploads/${plan.body.uploadId}/commit`, {});
    expect(commit.status).toBe(200);
    expect(commit.body.action.summary).toBe('Uploaded folder Trip (2 files)');
    expect(commit.body.action.itemCount).toBe(3); // 2 files + 1 empty dir
    const trip = await list(client, ws, '/Trip');
    expect(trip.body.entries.map((e: { name: string; type: string }) => `${e.type}:${e.name}`)).toEqual([
      'dir:day 1',
      'dir:empty',
      'file:a.txt',
    ]);
    // Retrying the commit answers the same action.
    const retry = await client.post(`/api/w/${ws}/uploads/${plan.body.uploadId}/commit`, {});
    expect(retry.status).toBe(200);
    expect(retry.body.action.id).toBe(commit.body.action.id);
  });

  test('multi-plan upload: plans sharing an actionId become one action', async () => {
    const { client, ws } = await setup('multi');
    const one = await uploadFile(client, ws, '/Photos/1.txt', 'p1', { conflict: 'ask' });
    const two = await uploadFile(client, ws, '/Photos/2.txt', 'p2', { conflict: 'ask', actionId: one.plan.actionId });
    expect(two.plan.actionId).toBe(one.plan.actionId);
    const rows = (await wsActions(ws)).filter((a) => a.status === 'committed');
    expect(rows).toHaveLength(1);
    expect(rows[0].commitIds).toHaveLength(2);
    expect(rows[0].itemCount).toBe(2);
    expect(rows[0].summary).toBe('Uploaded folder Photos (2 files)');
    // Someone else's action id is refused.
    const other = await setup('multi-other');
    const r = await other.client.post(`/api/w/${other.ws}/uploads`, {
      files: [{ path: '/x.txt', size: 1, blocks: [sha256Hex('x')] }],
      conflict: 'ask',
      actionId: one.plan.actionId,
    });
    expect(r.status).toBe(404);
  });

  test('block relay guards: sha format, plan membership, size, missing blocks, abort, other users', async () => {
    const { client, ws } = await setup('guards');
    const data = enc('guarded bytes ' + Date.now());
    const sha = sha256Hex(data);
    const plan = await client.post(`/api/w/${ws}/uploads`, { files: [{ path: '/g.txt', size: data.length, blocks: [sha] }], conflict: 'ask' });
    expect(plan.status).toBe(200);
    expect(plan.body.missing).toEqual([sha]);
    const put = (s: string, body: Uint8Array, ct = 'application/octet-stream') =>
      client.raw('PUT', `/api/w/${ws}/uploads/${plan.body.uploadId}/blocks/${s}`, { body: body as unknown as BodyInit, headers: { 'content-type': ct } });

    expect((await put('NOTHEX', data)).status).toBe(400);
    expect((await put(sha256Hex('other'), enc('other'))).status).toBe(400); // not in the plan
    expect((await put(sha, new Uint8Array(BLOCK_SIZE + 1))).status).toBe(413);
    expect((await put(sha, data, 'application/json')).status).toBe(403); // CSRF content-type rule

    // Commit before the block arrived: 409 {missing}, the plan stays alive.
    const early = await client.post(`/api/w/${ws}/uploads/${plan.body.uploadId}/commit`, {});
    expect(early.status).toBe(409);
    expect(early.body.error.details.missing).toEqual([sha]);

    // Another user cannot touch this upload, even through their own workspace.
    const intruder = await setup('guards-intruder');
    const foreign = await intruder.client.raw('PUT', `/api/w/${intruder.ws}/uploads/${plan.body.uploadId}/blocks/${sha}`, {
      body: data as unknown as BodyInit,
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(foreign.status).toBe(404);

    const abort = await client.del(`/api/w/${ws}/uploads/${plan.body.uploadId}`);
    expect(abort.status).toBe(204);
    expect((await put(sha, data)).status).toBe(409);
    const [a] = await db.select().from(actions).where(eq(actions.id, plan.body.actionId));
    expect(a.status).toBe('failed');
    const [u] = await db.select().from(uploads).where(eq(uploads.id, plan.body.uploadId));
    expect(u.status).toBe('aborted');
  });

  test('plan validation: bad names, block counts, the root', async () => {
    const { client, ws } = await setup('validate');
    const bad = async (body: unknown) => (await client.post(`/api/w/${ws}/uploads`, body)).status;
    expect(await bad({ files: [{ path: '/', size: 0, blocks: [] }], conflict: 'ask' })).toBe(400);
    expect(await bad({ files: [{ path: '/../x', size: 0, blocks: [] }], conflict: 'ask' })).toBe(400);
    expect(await bad({ files: [{ path: '/a\u0001b', size: 0, blocks: [] }], conflict: 'ask' })).toBe(400);
    expect(await bad({ files: [{ path: '/a', size: 5, blocks: [] }], conflict: 'ask' })).toBe(400);
    expect(await bad({ files: [], dirs: [], conflict: 'ask' })).toBe(400);
    const cross = await client.raw('POST', `/api/w/${ws}/uploads`, {
      body: '{"files":[]}',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    });
    expect(cross.status).toBe(403);
  });
});

describe('listing, stat, content', () => {
  test('listing: folders first, natural case-insensitive order; time travel reads `at`', async () => {
    const { client, ws } = await setup('list');
    for (const name of ['file10.txt', 'File2.txt', 'b.txt', 'a.txt']) await uploadFile(client, ws, `/${name}`, name);
    await client.post(`/api/w/${ws}/folders`, { path: '/zeta' });
    const r = await list(client, ws);
    expect(r.status).toBe(200);
    expect(r.body.entries.map((e: { name: string }) => e.name)).toEqual(['zeta', 'a.txt', 'b.txt', 'File2.txt', 'file10.txt']);
    const first = r.body.commitId;
    await client.post(`/api/w/${ws}/files/delete`, { paths: ['/a.txt'] });
    const now = await list(client, ws);
    expect(now.body.entries.map((e: { name: string }) => e.name)).not.toContain('a.txt');
    const past = await list(client, ws, '/', first);
    expect(past.body.entries.map((e: { name: string }) => e.name)).toContain('a.txt');
    expect(past.body.commitId).toBe(first);

    const st = await client.get(`/api/w/${ws}/files/stat?path=/b.txt`);
    expect(st.body).toMatchObject({ path: '/b.txt', name: 'b.txt', type: 'file', size: 5 });
    expect(st.body.version).toBeTruthy();
    expect((await client.get(`/api/w/${ws}/files/stat?path=/nope`)).status).toBe(404);
    expect((await list(client, ws, '/b.txt')).status).toBe(409);
    expect((await client.get(`/api/w/${ws}/files?path=/../etc`)).status).toBe(400);
  });

  test('a 1,000-entry folder lists in under 300 ms', async () => {
    const { client, ws } = await setup('big');
    const files = Array.from({ length: 1000 }, (_, i) => ({ path: `/Many/f${i}.txt`, size: 0, blocks: [] }));
    const plan = await client.post(`/api/w/${ws}/uploads`, { files, conflict: 'ask' });
    expect(plan.status).toBe(200);
    expect(plan.body.missing).toEqual([]);
    expect((await client.post(`/api/w/${ws}/uploads/${plan.body.uploadId}/commit`, {})).status).toBe(200);
    await list(client, ws, '/Many'); // warm
    const t0 = performance.now();
    const r = await list(client, ws, '/Many');
    const ms = performance.now() - t0;
    expect(r.body.entries).toHaveLength(1000);
    expect(r.body.entries[1].name).toBe('f1.txt');
    expect(r.body.entries[2].name).toBe('f2.txt');
    expect(ms).toBeLessThan(300);
  });

  test('Range: bytes=0-9 → 206 with 10 bytes; suffix; unsatisfiable → 416; empty file ignores Range', async () => {
    const { client, ws } = await setup('range');
    const text = 'abcdefghijklmnopqrstuvwxyz';
    await uploadFile(client, ws, '/v.mp4', text);
    const r = await client.raw('GET', contentPath(ws, '/v.mp4'), { headers: { range: 'bytes=0-9' } });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe(`bytes 0-9/${text.length}`);
    expect(r.headers.get('content-length')).toBe('10');
    expect(r.headers.get('accept-ranges')).toBe('bytes');
    expect(r.headers.get('content-type')).toBe('video/mp4');
    expect(await r.text()).toBe('abcdefghij');

    const tail = await client.raw('GET', contentPath(ws, '/v.mp4'), { headers: { range: 'bytes=-3' } });
    expect(tail.status).toBe(206);
    expect(await tail.text()).toBe('xyz');

    const bad = await client.raw('GET', contentPath(ws, '/v.mp4'), { headers: { range: 'bytes=100-' } });
    expect(bad.status).toBe(416);
    expect(bad.headers.get('content-range')).toBe(`bytes */${text.length}`);

    const multi = await client.raw('GET', contentPath(ws, '/v.mp4'), { headers: { range: 'bytes=0-1,4-5' } });
    expect(multi.status).toBe(200);
    expect(await multi.text()).toBe(text);

    await uploadFile(client, ws, '/empty.txt', '');
    const empty = await client.raw('GET', contentPath(ws, '/empty.txt'), { headers: { range: 'bytes=0-9' } });
    expect(empty.status).toBe(200);
    expect(await empty.text()).toBe('');

    const dir = await client.raw('GET', contentPath(ws, '/'));
    expect(dir.status).toBe(409);
  });

  test('security headers: active content is text/plain + attachment + nosniff + sandbox CSP; PDF drops sandbox', async () => {
    const { client, ws } = await setup('headers');
    await uploadFile(client, ws, '/page.html', '<script>alert(1)</script>');
    const html = await client.raw('GET', contentPath(ws, '/page.html'));
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(html.headers.get('x-content-type-options')).toBe('nosniff');
    expect(html.headers.get('content-disposition')).toStartWith('attachment;');
    expect(html.headers.get('content-security-policy')).toContain('sandbox');
    expect(html.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(html.headers.get('cache-control')).toBe('no-store');

    await uploadFile(client, ws, '/pic.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const svg = await client.raw('GET', contentPath(ws, '/pic.svg'));
    expect(svg.headers.get('content-type')).toBe('text/plain; charset=utf-8');

    await uploadFile(client, ws, '/doc.pdf', '%PDF-1.4 fake');
    const pdf = await client.raw('GET', contentPath(ws, '/doc.pdf'));
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('content-disposition')).toStartWith('inline;');
    expect(pdf.headers.get('content-security-policy')).not.toContain('sandbox');

    await uploadFile(client, ws, '/naïve résumé.txt', 'hi');
    const dl = await client.raw('GET', contentPath(ws, '/naïve résumé.txt', { download: '1' }));
    const cd = dl.headers.get('content-disposition')!;
    expect(cd).toStartWith('attachment;');
    expect(cd).toContain(`filename*=UTF-8''na%C3%AFve%20r%C3%A9sum%C3%A9.txt`);
    expect(cd).not.toMatch(/[^\x20-\x7e]/);

    // ETag + If-None-Match, immutable caching at a commit id.
    const etag = dl.headers.get('etag')!;
    expect(etag).toMatch(/^"[0-9A-Z]{26}"$/);
    const cached = await client.raw('GET', contentPath(ws, '/doc.pdf'), { headers: { 'if-none-match': pdf.headers.get('etag')! } });
    expect(cached.status).toBe(304);
    const head = (await list(client, ws)).body.commitId;
    const pinned = await client.raw('GET', contentPath(ws, '/doc.pdf', { at: head }));
    expect(pinned.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
  });
});

describe('zip', () => {
  test('a folder zip streams files and keeps the empty subfolder', async () => {
    const { client, ws } = await setup('zip');
    await uploadFile(client, ws, '/Docs/a.txt', 'alpha');
    await uploadFile(client, ws, '/Docs/deep/b.txt', 'beta');
    expect((await client.post(`/api/w/${ws}/folders`, { path: '/Docs/sub' })).status).toBe(200);
    const r = await client.raw('GET', `/api/w/${ws}/files/zip?paths=/Docs`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/zip');
    expect(r.headers.get('content-disposition')).toContain('filename="Docs.zip"');
    const buf = new Uint8Array(await r.arrayBuffer());
    expect(r.headers.get('content-length')).toBe(String(buf.length));
    const z = readZip(buf);
    expect([...z.keys()].sort()).toEqual(['a.txt', 'deep/', 'deep/b.txt', 'sub/']);
    expect(new TextDecoder().decode(z.get('a.txt')!)).toBe('alpha');
    expect(new TextDecoder().decode(z.get('deep/b.txt')!)).toBe('beta');

    // Several roots keep their own names; `at` reads the past.
    const before = (await list(client, ws)).body.commitId;
    await uploadFile(client, ws, '/top.txt', 'top');
    const multi = await client.raw('GET', `/api/w/${ws}/files/zip?paths=/Docs/a.txt&paths=/top.txt`);
    expect(multi.headers.get('content-disposition')).toMatch(/filename="volumes-\d{4}-\d{2}-\d{2}\.zip"/);
    expect([...readZip(new Uint8Array(await multi.arrayBuffer())).keys()].sort()).toEqual(['Docs/a.txt', 'top.txt']);
    const past = await client.raw('GET', `/api/w/${ws}/files/zip?paths=/&at=${before}`);
    expect([...readZip(new Uint8Array(await past.arrayBuffer())).keys()]).not.toContain('top.txt');

    expect((await client.raw('GET', `/api/w/${ws}/files/zip?paths=/missing`)).status).toBe(404);
  });
});

describe('folders, move, copy, delete', () => {
  test('create folder; existing → 409 path_exists; under a file → 409', async () => {
    const { client, ws } = await setup('folder');
    const r = await client.post(`/api/w/${ws}/folders`, { path: '/Projects' });
    expect(r.status).toBe(200);
    expect(r.body.action).toMatchObject({ kind: 'folder.create', status: 'committed', summary: 'Created folder Projects' });
    const again = await client.post(`/api/w/${ws}/folders`, { path: '/Projects' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('path_exists');
    await uploadFile(client, ws, '/f.txt', 'f');
    expect((await client.post(`/api/w/${ws}/folders`, { path: '/f.txt/sub' })).status).toBe(409);
    expect((await client.post(`/api/w/${ws}/folders`, { path: '/bad\u0007name' })).status).toBe(400);
    expect((await client.post(`/api/w/${ws}/folders`, { path: '/' })).status).toBe(400);
  });

  test('rename and move are one action each with ledger rows; guards', async () => {
    const { client, ws } = await setup('move');
    await uploadFile(client, ws, '/a.txt', 'aaa');
    await uploadFile(client, ws, '/c.txt', 'ccc');
    await client.post(`/api/w/${ws}/folders`, { path: '/Docs' });

    const ren = await client.post(`/api/w/${ws}/files/move`, { items: [{ from: '/a.txt', to: '/b.txt' }] });
    expect(ren.status).toBe(200);
    expect(ren.body.action).toMatchObject({ kind: 'rename', summary: 'Renamed a.txt to b.txt', status: 'committed' });
    const [row] = await db.select().from(actionPaths).where(eq(actionPaths.actionId, ren.body.action.id));
    expect(row).toMatchObject({ op: 'moved', path: '/b.txt', fromPath: '/a.txt', entryType: 'file', size: 3 });
    expect(row.blockHashes).toEqual([sha256Hex('aaa')]);

    const mv = await client.post(`/api/w/${ws}/files/move`, {
      items: [
        { from: '/b.txt', to: '/Docs/b.txt' },
        { from: '/c.txt', to: '/Docs/c.txt' },
      ],
    });
    expect(mv.body.action).toMatchObject({ kind: 'move', summary: 'Moved 2 items to /Docs', itemCount: 2 });
    const [a] = await db.select().from(actions).where(eq(actions.id, mv.body.action.id));
    expect(a.commitIds).toHaveLength(2);
    expect((await list(client, ws, '/Docs')).body.entries.map((e: { name: string }) => e.name)).toEqual(['b.txt', 'c.txt']);

    const into = await client.post(`/api/w/${ws}/files/move`, { items: [{ from: '/Docs', to: '/Docs/inner/Docs' }] });
    expect(into.status).toBe(400);
    await uploadFile(client, ws, '/Docs/d.txt', 'd');
    const clash = await client.post(`/api/w/${ws}/files/move`, { items: [{ from: '/Docs/d.txt', to: '/Docs/b.txt' }] });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatchObject({ code: 'path_exists', details: { paths: ['/Docs/b.txt'] } });
    const over = await client.post(`/api/w/${ws}/files/move`, { items: [{ from: '/Docs/d.txt', to: '/Docs/b.txt' }], overwrite: true });
    expect(over.status).toBe(200);
    const missing = await client.post(`/api/w/${ws}/files/move`, { items: [{ from: '/nope', to: '/x' }] });
    expect(missing.status).toBe(404);
    const failedCount = (await wsActions(ws)).filter((x) => x.status === 'failed').length;
    expect(failedCount).toBe(0); // guards run before anything is recorded
  });

  test('copy: files and folders, quota checked, ledger rows `copied`', async () => {
    const { client, ws, me } = await setup('copy');
    await uploadFile(client, ws, '/src/a.txt', 'a');
    await uploadFile(client, ws, '/src/b.txt', 'b');
    const cp = await client.post(`/api/w/${ws}/files/copy`, { items: [{ from: '/src', to: '/dst' }] });
    expect(cp.status).toBe(200);
    expect(cp.body.action).toMatchObject({ kind: 'copy', summary: 'Copied src as dst' });
    expect((await list(client, ws, '/dst')).body.entries.map((e: { name: string }) => e.name)).toEqual(['a.txt', 'b.txt']);
    expect((await list(client, ws, '/src')).body.entries).toHaveLength(2);
    const rows = await db.select().from(actionPaths).where(eq(actionPaths.actionId, cp.body.action.id));
    expect(rows).toEqual([expect.objectContaining({ op: 'copied', path: '/dst', fromPath: '/src', entryType: 'dir', size: 2 })]);
    expect((await client.post(`/api/w/${ws}/files/copy`, { items: [{ from: '/src', to: '/src/inside' }] })).status).toBe(400);
    expect((await client.post(`/api/w/${ws}/files/copy`, { items: [{ from: '/src/a.txt', to: '/src/a.txt' }] })).status).toBe(409);

    await db.update(userSettings).set({ quotaBytes: 5 * 4096 }).where(eq(userSettings.userId, me.user.id));
    const tooMuch = await client.post(`/api/w/${ws}/files/copy`, { items: [{ from: '/src', to: '/dst2' }] });
    expect(tooMuch.status).toBe(413);
    expect(tooMuch.body.error.code).toBe('quota_exceeded');
  });

  test('delete: one action per request, one row per top-level path, undoable', async () => {
    const { client, ws } = await setup('delete');
    await uploadFile(client, ws, '/keep.txt', 'k');
    await uploadFile(client, ws, '/Old/x.txt', 'xx');
    await uploadFile(client, ws, '/Old/y.txt', 'yyy');
    const r = await client.post(`/api/w/${ws}/files/delete`, { paths: ['/Old', '/Old/x.txt', '/keep.txt'] });
    expect(r.status).toBe(200);
    expect(r.body.action).toMatchObject({ kind: 'delete', summary: 'Deleted 2 items', status: 'committed', undoable: true, itemCount: 2 });
    const rows = await db
      .select()
      .from(actionPaths)
      .where(and(eq(actionPaths.actionId, r.body.action.id), eq(actionPaths.op, 'deleted')));
    const byPath = Object.fromEntries(rows.map((x) => [x.path, x]));
    expect(byPath['/Old']).toMatchObject({ entryType: 'dir', size: 5 });
    expect(byPath['/keep.txt']).toMatchObject({ entryType: 'file', size: 1 });
    expect(byPath['/keep.txt'].blockHashes).toEqual([sha256Hex('k')]);
    expect((await list(client, ws)).body.entries).toEqual([]);
    expect((await client.post(`/api/w/${ws}/files/delete`, { paths: ['/'] })).status).toBe(400);
    expect((await client.post(`/api/w/${ws}/files/delete`, { paths: ['/gone'] })).status).toBe(404);
  });
});

describe('search', () => {
  test('case-insensitive basename match, prefix first, limit + truncated, at', async () => {
    const { client, ws } = await setup('search');
    for (const p of ['/Reports/annual report.pdf', '/report.txt', '/misc/Report-2024.csv', '/notes.md']) await uploadFile(client, ws, p, p);
    const r = await client.get(`/api/w/${ws}/search?q=REPORT`);
    expect(r.status).toBe(200);
    const paths = r.body.results.map((e: { path: string }) => e.path);
    expect(paths.slice(0, 3)).toEqual(['/Reports', '/report.txt', '/misc/Report-2024.csv']);
    expect(paths).toContain('/Reports/annual report.pdf');
    expect(paths).not.toContain('/notes.md');
    expect(r.body.truncated).toBe(false);
    const lim = await client.get(`/api/w/${ws}/search?q=report&limit=2`);
    expect(lim.body.results).toHaveLength(2);
    expect(lim.body.truncated).toBe(true);
    const before = r.body.commitId;
    await uploadFile(client, ws, '/report-new.txt', 'n');
    const past = await client.get(`/api/w/${ws}/search?q=report-new&at=${before}`);
    expect(past.body.results).toEqual([]);
    expect((await client.get(`/api/w/${ws}/search?q=`)).status).toBe(400);
  });
});

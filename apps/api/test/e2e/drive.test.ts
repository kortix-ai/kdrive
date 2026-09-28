// End to end: sign-in, quota, uploads (dedup, folders), file operations with
// undo, Range and zip downloads, search. User stories 1-5 and 12.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { BLOCK_SIZE } from '@volumes/shared';
import { blocksOf, TestClient } from '../helpers';
import { dec, endWorld, freshWorld, ls, q, readZip, text, timeline, upload, user, type User } from './kit';

beforeEach(() => freshWorld());
afterEach(endWorld);
afterAll(endWorld);

async function admin(): Promise<User> {
  return user('admin@test.local');
}

describe('sign-in and workspace', () => {
  test('dev sign-in creates the user and one default workspace, idempotently', async () => {
    const anon = new TestClient('anon');
    expect((await anon.get('/api/me')).status).toBe(401);
    const a = await user('story1@test.local');
    expect(a.me.workspaces).toHaveLength(1);
    expect(a.me.workspaces[0]).toMatchObject({ id: a.ws, name: 'My Drive', isDefault: true });
    expect(a.me.usage).toMatchObject({ usedBytes: 0, level: 'ok', quotaBytes: 10 * 1024 ** 3 });
    expect(await ls(a)).toEqual([]);
    const again = await user('STORY1@test.local');
    expect(again.userId).toBe(a.userId);
    expect(again.ws).toBe(a.ws);
    expect(again.me.workspaces).toHaveLength(1);
  });
});

describe('quota', () => {
  test('an upload over quota is refused at plan time with the amount over, before any byte moves', async () => {
    const a = await user('quota@test.local');
    const adm = await admin();
    const set = await adm.client.put(`/api/admin/users/${a.userId}/quota`, { quotaBytes: 64 * 1024 });
    expect(set.status).toBe(200);
    expect(set.body.user.quotaBytes).toBe(64 * 1024);

    const big = new Uint8Array(200 * 1024).fill(7);
    const plan = await a.client.post(`/api/w/${a.ws}/uploads`, {
      files: [{ path: '/big.bin', size: big.length, blocks: blocksOf(big).map((b) => b.sha) }],
      dirs: [],
      conflict: 'replace',
    });
    expect(plan.status).toBe(413);
    expect(plan.body.error.code).toBe('quota_exceeded');
    const d = plan.body.error.details;
    expect(d.quotaBytes).toBe(64 * 1024);
    expect(d.usedBytes).toBe(0);
    expect(d.requestedBytes).toBeGreaterThanOrEqual(big.length);
    expect(d.overBytes).toBe(d.usedBytes + d.requestedBytes - d.quotaBytes);
    expect(await ls(a)).toEqual([]);
    expect((await a.client.get('/api/me/usage')).body.usedBytes).toBe(0);

    // A small file still fits, and the meter reflects it.
    await upload(a, { '/small.txt': 'fits' });
    const usage = (await a.client.get('/api/me/usage')).body;
    expect(usage.usedBytes).toBeGreaterThan(0);
    expect(usage.usedBytes).toBeLessThanOrEqual(64 * 1024);
  });
});

describe('uploads', () => {
  test('block upload with dedup: the same bytes again send 0 blocks', async () => {
    const a = await user('dedup@test.local');
    const bytes = new Uint8Array(BLOCK_SIZE * 2 + 1234);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) % 251;
    const first = await upload(a, { '/data/blob.bin': bytes }, { dirs: ['/data'] });
    expect(first.sent).toBe(3);
    expect(first.commit.files).toBe(1);
    expect(first.commit.action).toMatchObject({ kind: 'upload', status: 'committed' });
    expect(JSON.stringify(first.plan)).not.toContain('upload_id');

    // Same bytes under a new name: Platinum already has every block.
    const second = await upload(a, { '/data/copy.bin': bytes });
    expect(second.plan.missing).toEqual([]);
    expect(second.sent).toBe(0);

    // A one-byte edit in the last block only resends that block.
    const edited = bytes.slice();
    edited[edited.length - 1] ^= 0xff;
    const third = await upload(a, { '/data/blob.bin': edited });
    expect(third.sent).toBe(1);

    const r = await a.client.raw('GET', `/api/w/${a.ws}/files/content?${q({ path: '/data/copy.bin' })}`);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes);
  });

  test('folder upload keeps the tree including empty folders, as one timeline entry', async () => {
    const a = await user('folder@test.local');
    const res = await upload(
      a,
      { '/Trip/day1/a.txt': 'alpha', '/Trip/day2/b.txt': 'bravo', '/Trip/readme.md': '# Trip' },
      { dirs: ['/Trip', '/Trip/day1', '/Trip/day2', '/Trip/empty', '/Trip/empty/deeper'] },
    );
    expect(res.commit.files).toBe(3);
    expect(res.commit.action.summary).toBe('Uploaded folder Trip (3 files)');
    expect(await ls(a, '/Trip')).toEqual(['day1/', 'day2/', 'empty/', 'readme.md']);
    expect(await ls(a, '/Trip/empty')).toEqual(['deeper/']);
    expect(await ls(a, '/Trip/empty/deeper')).toEqual([]);
    expect(await text(a, '/Trip/day2/b.txt')).toBe('bravo');
    const t = await timeline(a);
    expect(t).toHaveLength(1);
    expect(t[0].actionId).toBe(res.commit.action.id);
  });

  test('conflicts: ask → 409 with the paths, keep-both → "name (1).ext", replace → new version', async () => {
    const a = await user('conflict@test.local');
    await upload(a, { '/notes.txt': 'v1' });
    const ask = await a.client.post(`/api/w/${a.ws}/uploads`, {
      files: [{ path: '/notes.txt', size: 2, blocks: blocksOf(new TextEncoder().encode('v2')).map((b) => b.sha) }],
      dirs: [],
      conflict: 'ask',
    });
    expect(ask.status).toBe(409);
    expect(ask.body.error.details.conflicts).toEqual(['/notes.txt']);
    const both = await upload(a, { '/notes.txt': 'v2' }, { conflict: 'keep-both' });
    expect(both.plan.renamed).toEqual([{ from: '/notes.txt', to: '/notes (1).txt' }]);
    expect(await ls(a)).toEqual(['notes (1).txt', 'notes.txt']);
    await upload(a, { '/notes.txt': 'v3' }, { conflict: 'replace' });
    expect(await text(a, '/notes.txt')).toBe('v3');
  });
});

describe('file operations', () => {
  test('create folder, rename, move, copy, delete — each one entry, each undoable', async () => {
    const a = await user('ops@test.local');
    await upload(a, { '/a.txt': 'A', '/b.txt': 'B' });

    const mk = await a.client.post(`/api/w/${a.ws}/folders`, { path: '/Docs' });
    expect(mk.status).toBe(200);
    expect(mk.body.action).toMatchObject({ kind: 'folder.create', summary: 'Created folder Docs' });
    expect((await a.client.post(`/api/w/${a.ws}/folders`, { path: '/Docs' })).status).toBe(409);

    const ren = await a.client.post(`/api/w/${a.ws}/files/move`, { items: [{ from: '/a.txt', to: '/alpha.txt' }] });
    expect(ren.status).toBe(200);
    expect(ren.body.action.summary).toBe('Renamed a.txt to alpha.txt');

    const mv = await a.client.post(`/api/w/${a.ws}/files/move`, {
      items: [
        { from: '/alpha.txt', to: '/Docs/alpha.txt' },
        { from: '/b.txt', to: '/Docs/b.txt' },
      ],
    });
    expect(mv.status).toBe(200);
    expect(mv.body.action.summary).toBe('Moved 2 items to /Docs');
    expect(await ls(a)).toEqual(['Docs/']);

    const cp = await a.client.post(`/api/w/${a.ws}/files/copy`, { items: [{ from: '/Docs', to: '/Docs copy' }] });
    expect(cp.status).toBe(200);
    expect(await ls(a, '/Docs copy')).toEqual(['alpha.txt', 'b.txt']);

    const del = await a.client.post(`/api/w/${a.ws}/files/delete`, { paths: ['/Docs'] });
    expect(del.status).toBe(200);
    expect(del.body.action).toMatchObject({ kind: 'delete', undoable: true });
    expect(await ls(a)).toEqual(['Docs copy/']);

    // Undo the delete: the folder and its files are back.
    const undo = await a.client.post(`/api/w/${a.ws}/actions/${del.body.action.id}/undo`, {});
    expect(undo.status).toBe(200);
    expect(undo.body.action.summary).toBe('Undid: Deleted Docs');
    expect(await ls(a, '/Docs')).toEqual(['alpha.txt', 'b.txt']);
    expect(await text(a, '/Docs/alpha.txt')).toBe('A');

    // Undo the move: files go back to the root.
    const undoMove = await a.client.post(`/api/w/${a.ws}/actions/${mv.body.action.id}/undo`, {});
    expect(undoMove.status).toBe(200);
    expect(await ls(a)).toEqual(['Docs/', 'Docs copy/', 'alpha.txt', 'b.txt']);

    // An undo is itself undoable.
    const redo = await a.client.post(`/api/w/${a.ws}/actions/${undoMove.body.action.id}/undo`, {});
    expect(redo.status).toBe(200);
    expect(await ls(a)).toEqual(['Docs/', 'Docs copy/']);

    const kinds = (await timeline(a)).map((e) => e.kind);
    expect(kinds).toEqual(['undo', 'undo', 'undo', 'delete', 'copy', 'move', 'rename', 'folder.create', 'upload']);
  });

  test('invalid names are rejected', async () => {
    const a = await user('names@test.local');
    for (const bad of ['/..', '/', '/x\u0001y', '/a/b\u007f']) {
      const r = await a.client.post(`/api/w/${a.ws}/folders`, { path: bad });
      expect(r.status).toBe(400);
    }
    await upload(a, { '/f.txt': 'x' });
    const r = await a.client.post(`/api/w/${a.ws}/files/move`, { items: [{ from: '/f.txt', to: '/../../etc/passwd' }] });
    expect(r.status).toBe(400);
  });
});

describe('downloads', () => {
  test('Range download gives 206 with exact bytes (video seeking)', async () => {
    const a = await user('range@test.local');
    const body = 'abcdefghijklmnopqrstuvwxyz';
    await upload(a, { '/clip.mp4': body });
    const url = `/api/w/${a.ws}/files/content?${q({ path: '/clip.mp4' })}`;
    const part = await a.client.raw('GET', url, { headers: { range: 'bytes=5-9' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 5-9/${body.length}`);
    expect(part.headers.get('accept-ranges')).toBe('bytes');
    expect(await part.text()).toBe('fghij');
    const tail = await a.client.raw('GET', url, { headers: { range: 'bytes=-3' } });
    expect(await tail.text()).toBe('xyz');
    const bad = await a.client.raw('GET', url, { headers: { range: 'bytes=100-200' } });
    expect(bad.status).toBe(416);
    const full = await a.client.raw('GET', `${url}&download=1`);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-disposition')).toStartWith('attachment');
    expect(full.headers.get('content-type')).toBe('video/mp4');
  });

  test('folder download is a streamed zip with the tree and empty dirs', async () => {
    const a = await user('zip@test.local');
    await upload(a, { '/Proj/src/main.ts': 'console.log(1)', '/Proj/README.md': '# hi' }, { dirs: ['/Proj/empty'] });
    const r = await a.client.raw('GET', `/api/w/${a.ws}/files/zip?${q({ paths: '/Proj' })}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/zip');
    expect(r.headers.get('content-disposition')).toContain('Proj.zip');
    const zip = readZip(new Uint8Array(await r.arrayBuffer()));
    expect(dec(zip.get('src/main.ts'))).toBe('console.log(1)');
    expect(dec(zip.get('README.md'))).toBe('# hi');
    expect(zip.has('empty/')).toBe(true);
  });
});

describe('search', () => {
  test('finds files by name anywhere in the drive, prefix matches first', async () => {
    const a = await user('search@test.local');
    await upload(a, {
      '/Reports/q3-report.pdf': 'pdf',
      '/report-draft.md': 'md',
      '/misc/other.txt': 'x',
      '/Archive/2025/old report.txt': 'y',
    });
    const r = await a.client.get(`/api/w/${a.ws}/search?${q({ q: 'report' })}`);
    expect(r.status).toBe(200);
    const paths = (r.body.results as { path: string }[]).map((e) => e.path);
    // Name-prefix matches rank before substring matches.
    expect(new Set(paths.slice(0, 2))).toEqual(new Set(['/Reports', '/report-draft.md']));
    expect(new Set(paths)).toEqual(new Set(['/report-draft.md', '/Reports', '/Reports/q3-report.pdf', '/Archive/2025/old report.txt']));
    expect(r.body.truncated).toBe(false);
    const none = await a.client.get(`/api/w/${a.ws}/search?${q({ q: 'zzz' })}`);
    expect(none.body.results).toEqual([]);
  });
});

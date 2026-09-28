import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { TEXT_DIFF_MAX_BYTES } from '@volumes/shared';
import { getStore } from '../storage';
import { cleanWorld, freshWorld, kitFor, mkdir, move, remove, te, upload } from './versioning-test-kit';

describe('file versions', () => {
  beforeEach(() => freshWorld());
  afterEach(cleanWorld);

  test('a file changed 3 times lists 3 versions, newest first, current marked', async () => {
    const k = await kitFor('v1@test.local');
    await upload(k, { '/notes.md': '# one' });
    await upload(k, { '/notes.md': '# two' });
    await upload(k, { '/other.txt': 'unrelated' });
    await upload(k, { '/notes.md': '# three!' });
    const r = await k.client.get(`/api/w/${k.ws}/versions?path=${encodeURIComponent('/notes.md')}`);
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('ledger');
    const v = r.body.versions;
    expect(v).toHaveLength(3);
    expect(v.map((x: any) => x.op)).toEqual(['changed', 'changed', 'added']);
    expect(v.map((x: any) => x.size)).toEqual([8, 5, 5]);
    expect(v.map((x: any) => x.isCurrent)).toEqual([true, false, false]);
    expect(v[2].summary).toBe('Uploaded notes.md');
    // each version reads back its own bytes
    const text = async (at: string) => new TextDecoder().decode(new Uint8Array(await new Response((await getStore().read(k.vol, '/notes.md', { at })).body).arrayBuffer()));
    expect(await text(v[2].commitId)).toBe('# one');
    expect(await text(v[1].commitId)).toBe('# two');
  });

  test('versions follow a rename back to the old name; checkpoint names attach', async () => {
    const k = await kitFor('v2@test.local');
    await upload(k, { '/hero.png': 'img-1' });
    const cp = await k.client.post(`/api/w/${k.ws}/checkpoints`, { name: 'v1.0' });
    expect(cp.status).toBe(201);
    await move(k, '/hero.png', '/cover.png');
    await upload(k, { '/cover.png': 'img-2!' });
    const r = await k.client.get(`/api/w/${k.ws}/versions?path=/cover.png`);
    const v = r.body.versions;
    expect(v.map((x: any) => x.op)).toEqual(['changed', 'moved', 'added']);
    expect(v[1].summary).toBe('Renamed hero.png to cover.png');
    expect(v[0].isCurrent).toBe(true);
    expect(v[2].checkpointNames).toEqual([]); // the checkpoint holds /hero.png, not /cover.png
    const hero = await k.client.get(`/api/w/${k.ws}/versions?path=/hero.png`);
    expect(hero.body.versions).toHaveLength(1);
    expect(hero.body.versions[0].checkpointNames).toEqual(['v1.0']);
    expect(hero.body.versions[0].isCurrent).toBe(false);
  });

  test('chain fallback when the ledger knows nothing', async () => {
    const k = await kitFor('v3@test.local');
    const s = getStore();
    await s.write(k.vol, '/ext.txt', te('1'));
    await s.write(k.vol, '/ext.txt', te('22'));
    await s.write(k.vol, '/ext.txt', te('333'));
    const r = await k.client.get(`/api/w/${k.ws}/versions?path=/ext.txt`);
    expect(r.body.source).toBe('chain');
    expect(r.body.versions.map((x: any) => x.size)).toEqual([3, 2, 1]);
    expect(r.body.versions[0].isCurrent).toBe(true);
    const none = await k.client.get(`/api/w/${k.ws}/versions?path=/nope.txt`);
    expect(none.body.versions).toEqual([]);
    expect((await k.client.get(`/api/w/${k.ws}/versions?path=/../x`)).status).toBe(400);
  });

  test('a deleted file still lists its versions (not current)', async () => {
    const k = await kitFor('v4@test.local');
    await upload(k, { '/gone.txt': 'a' });
    await upload(k, { '/gone.txt': 'bb' });
    await remove(k, '/gone.txt');
    const r = await k.client.get(`/api/w/${k.ws}/versions?path=/gone.txt`);
    expect(r.body.versions).toHaveLength(2);
    expect(r.body.versions.some((x: any) => x.isCurrent)).toBe(false);
  });
});

describe('compare file', () => {
  beforeEach(() => freshWorld());
  afterEach(cleanWorld);

  test('both sides with URLs; kinds; one side missing; too large for diff', async () => {
    const k = await kitFor('cf1@test.local');
    const a = await upload(k, { '/doc.md': 'hello world' });
    const b = await upload(k, { '/doc.md': 'hello brave world' });
    const q = (path: string, x: string, y: string) =>
      k.client.get(`/api/w/${k.ws}/compare/file?path=${encodeURIComponent(path)}&a=${x}&b=${y}`);
    const r = await q('/doc.md', a.action.headCommitId!, 'head');
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe('text');
    expect(r.body.tooLargeForDiff).toBe(false);
    expect(r.body.a).toMatchObject({ commitId: a.action.headCommitId, size: 11, mime: expect.stringContaining('markdown') });
    expect(r.body.b.commitId).toBe(b.action.headCommitId);
    expect(r.body.a.version).not.toBe(r.body.b.version);
    expect(r.body.a.contentUrl).toBe(`/api/w/${k.ws}/files/content?path=%2Fdoc.md&at=${a.action.headCommitId}`);
    expect(r.body.a.downloadUrl).toBe(`${r.body.a.contentUrl}&download=1`);

    const img = await upload(k, { '/p.png': 'png' });
    const r2 = await q('/p.png', a.action.headCommitId!, img.action.headCommitId!);
    expect(r2.body.kind).toBe('image');
    expect(r2.body.a).toBeNull();
    expect(r2.body.b.size).toBe(3);

    const big = new Uint8Array(TEXT_DIFF_MAX_BYTES + 1).fill(97);
    const c1 = await upload(k, { '/big.csv': big });
    const r3 = await q('/big.csv', c1.action.headCommitId!, 'head');
    expect(r3.body.kind).toBe('csv');
    expect(r3.body.tooLargeForDiff).toBe(true);

    expect((await q('/nothing.txt', 'head', 'head')).status).toBe(404);
    await mkdir(k, '/folder');
    expect((await q('/folder', 'head', 'head')).body.error.code).toBe('not_a_file');
    expect((await q('/doc.md', 'vc_01ARZ3NDEKTSV4RRFFQ69G5FAV', 'head')).status).toBe(410);
  });
});

describe('compare drive', () => {
  beforeEach(() => freshWorld());
  afterEach(cleanWorld);

  test('ledger: added, removed, changed and moved between two points (order-insensitive)', async () => {
    const k = await kitFor('cd1@test.local');
    const base = await upload(k, { '/keep.txt': 'k', '/edit.txt': 'e1', '/old.txt': 'o', '/ren.txt': 'r', '/dir/a.txt': 'a' });
    await upload(k, { '/edit.txt': 'e22' });
    await remove(k, '/old.txt');
    await move(k, '/ren.txt', '/renamed.txt');
    await move(k, '/dir', '/dir2');
    await upload(k, { '/new/n.txt': 'n' });
    await upload(k, { '/tmp.txt': 't' });
    await remove(k, '/tmp.txt'); // added then deleted: cancels
    const a = base.action.headCommitId!;
    const r = await k.client.get(`/api/w/${k.ws}/compare/drive?a=head&b=${a}`); // reversed on purpose
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('ledger');
    expect(r.body.a.commitId).toBe(a);
    const changes = r.body.changes.map((c: any) => `${c.op} ${c.fromPath ? c.fromPath + ' -> ' : ''}${c.path}`);
    expect(changes.sort()).toEqual(
      ['added /new', 'changed /edit.txt', 'moved /dir -> /dir2', 'moved /ren.txt -> /renamed.txt', 'removed /old.txt'].sort(),
    );
    const edit = r.body.changes.find((c: any) => c.path === '/edit.txt');
    expect(edit).toMatchObject({ sizeA: 2, sizeB: 3, type: 'file' });
    const same = await k.client.get(`/api/w/${k.ws}/compare/drive?a=${a}&b=${a}`);
    expect(same.body.changes).toEqual([]);
  });

  test('tree fallback when a change came from outside the app (moves by size+mtime)', async () => {
    const k = await kitFor('cd2@test.local');
    const base = await upload(k, { '/a.txt': 'aaa', '/b.txt': 'b', '/d/x.txt': 'x', '/d/y.txt': 'yy' });
    const s = getStore();
    await s.move(k.vol, '/a.txt', '/z.txt');
    await s.remove(k.vol, '/b.txt');
    await s.write(k.vol, '/c.txt', te('c'));
    await s.move(k.vol, '/d', '/e');
    const r = await k.client.get(`/api/w/${k.ws}/compare/drive?a=${base.action.headCommitId}&b=head`);
    expect(r.body.source).toBe('tree');
    const changes = r.body.changes.map((c: any) => `${c.op} ${c.fromPath ? c.fromPath + ' -> ' : ''}${c.path}`);
    expect(changes.sort()).toEqual(['added /c.txt', 'moved /a.txt -> /z.txt', 'moved /d -> /e', 'removed /b.txt'].sort());
    const moved = r.body.changes.find((c: any) => c.path === '/e');
    expect(moved.sizeA).toBe(3);
  });
});

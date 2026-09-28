// End to end: timeline, time travel, file versions, compare (file and drive),
// restore (file / folder / drive) with undo, checkpoints and the tag budget,
// recently deleted. User stories 7-11.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { workspaces } from '../../src/db/schema';
import { dec, endWorld, freshWorld, head, ls, q, text, timeline, upload, user, type User } from './kit';

beforeEach(() => freshWorld());
afterEach(endWorld);
afterAll(endWorld);

const api = (u: User, p: string) => `/api/w/${u.ws}${p}`;

describe('timeline and time travel', () => {
  test('one user action = one entry, even across several plans; entries carry paths and deltas', async () => {
    const a = await user('tl@test.local');
    const first = await upload(a, { '/a.txt': 'one' });
    // A big upload split into two plans that share one actionId.
    const p1 = await upload(a, { '/Photos/1.jpg': 'img-1' }, { dirs: [] });
    await upload(a, { '/Photos/2.jpg': 'img-2' }, { actionId: p1.commit.action.id });
    await a.client.post(api(a, '/folders'), { path: '/Empty' });

    const t = await timeline(a);
    expect(t.map((e) => e.kind)).toEqual(['folder.create', 'upload', 'upload']);
    expect(t[0].isHead).toBe(true);
    expect(t[1].actionId).toBe(p1.commit.action.id);
    expect(t[1].itemCount).toBe(2);
    expect(t[1].paths.map((p: { path: string }) => p.path).sort()).toEqual(['/Photos/1.jpg', '/Photos/2.jpg']);
    expect(t[2].actionId).toBe(first.commit.action.id);
    expect(t[2].bytesDelta).toBeGreaterThan(0);
    expect(t[2].actor).toMatchObject({ email: 'tl@test.local' });

    // Paging never splits an entry.
    const page = await a.client.get(api(a, `/timeline?limit=2`));
    expect(page.body.entries).toHaveLength(2);
    const rest = await a.client.get(api(a, `/timeline?${q({ limit: '2', before: page.body.nextCursor })}`));
    expect(rest.body.entries.map((e: { actionId: string }) => e.actionId)).toEqual([first.commit.action.id]);
  });

  test('time travel: the whole drive reads as of a past version', async () => {
    const a = await user('tt@test.local');
    await upload(a, { '/doc.md': '# v1', '/keep.txt': 'k' });
    const past = await head(a);
    await upload(a, { '/doc.md': '# v2', '/new.txt': 'n' });
    await a.client.post(api(a, '/files/delete'), { paths: ['/keep.txt'] });

    expect(await ls(a)).toEqual(['doc.md', 'new.txt']);
    expect(await ls(a, '/', past)).toEqual(['doc.md', 'keep.txt']);
    expect(await text(a, '/doc.md', past)).toBe('# v1');
    const st = await a.client.get(api(a, `/files/stat?${q({ path: '/doc.md', at: past })}`));
    expect(st.body.commitId).toBe(past);
    const s = await a.client.get(api(a, `/search?${q({ q: 'keep', at: past })}`));
    expect(s.body.results.map((e: { path: string }) => e.path)).toEqual(['/keep.txt']);
    const commit = await a.client.get(api(a, `/commits/${past}`));
    expect(commit.body).toMatchObject({ id: past, action: { kind: 'upload' } });
    // Past content is immutable, so it may be cached forever.
    const r = await a.client.raw('GET', api(a, `/files/content?${q({ path: '/doc.md', at: past })}`));
    expect(r.headers.get('cache-control')).toContain('immutable');
    // Mutations never take `at`.
    const unknown = await a.client.get(api(a, `/files?${q({ path: '/', at: 'vc_00000000000000000000000000' })}`));
    expect(unknown.status).toBe(410);
    expect(unknown.body.error.code).toBe('version_gone');
  });
});

describe('file versions and compare', () => {
  test('versions follow a file through edits and a rename; compare gives both sides', async () => {
    const a = await user('ver@test.local');
    await upload(a, { '/draft.txt': 'line one\nline two\n' });
    const v1 = await head(a);
    await upload(a, { '/draft.txt': 'line one\nline 2\nline three\n' });
    await a.client.post(api(a, '/files/move'), { items: [{ from: '/draft.txt', to: '/final.txt' }] });
    await upload(a, { '/final.txt': 'line one\nline 2\nline three\nfin\n' });
    const v4 = await head(a);

    const vs = await a.client.get(api(a, `/versions?${q({ path: '/final.txt' })}`));
    expect(vs.status).toBe(200);
    expect(vs.body.source).toBe('ledger');
    const versions = vs.body.versions as { commitId: string; size: number; isCurrent: boolean; path?: string }[];
    expect(versions.length).toBeGreaterThanOrEqual(3);
    expect(versions[0]).toMatchObject({ commitId: v4, isCurrent: true });
    expect(versions.at(-1)!.size).toBe('line one\nline two\n'.length);

    const cmp = await a.client.get(api(a, `/compare/file?${q({ path: '/final.txt', a: v1, b: v4 })}`));
    expect(cmp.status).toBe(200);
    expect(cmp.body.kind).toBe('text');
    // Side a is the file at v1, when it was still called draft.txt: compare follows the rename.
    const sideA = cmp.body.a;
    const sideB = cmp.body.b;
    expect(sideA).toMatchObject({ commitId: v1, size: 'line one\nline two\n'.length });
    expect(sideA.contentUrl).toContain(encodeURIComponent('/draft.txt'));
    expect(sideB).toMatchObject({ commitId: v4, size: 'line one\nline 2\nline three\nfin\n'.length, mime: expect.stringContaining('text/plain') });
    const bBytes = await a.client.raw('GET', sideB.contentUrl.replace(/^https?:\/\/[^/]+/, ''));
    expect(await bBytes.text()).toBe('line one\nline 2\nline three\nfin\n');
    const aBytes = await a.client.raw('GET', sideA.contentUrl.replace(/^https?:\/\/[^/]+/, ''));
    expect(await aBytes.text()).toBe('line one\nline two\n');
    // The oldest version names its path then, so it can be opened and downloaded.
    expect(versions.at(-1)).toMatchObject({ commitId: v1, path: '/draft.txt' });
    expect(versions[0]).toMatchObject({ path: '/final.txt' });
    // Restoring a version from before the rename writes it to the current name.
    const rr = await a.client.post(api(a, '/restore'), { scope: 'file', path: '/final.txt', at: v1 });
    expect(rr.status).toBe(200);
    expect(await text(a, '/final.txt')).toBe('line one\nline two\n');
    expect(await ls(a)).toEqual(['final.txt']);
    await a.client.post(api(a, `/actions/${rr.body.action.id}/undo`), {});
    expect(await text(a, '/final.txt')).toBe('line one\nline 2\nline three\nfin\n');

    // Both sides of a same-name compare exist.
    await upload(a, { '/data.csv': 'id,name\n1,a\n' });
    const c1 = await head(a);
    await upload(a, { '/data.csv': 'id,name\n1,b\n2,c\n' });
    const c2 = await head(a);
    const csv = await a.client.get(api(a, `/compare/file?${q({ path: '/data.csv', a: c1, b: c2 })}`));
    expect(csv.body.kind).toBe('csv');
    expect(csv.body.a.size).toBe(12);
    expect(csv.body.b.size).toBe(16);
    const dl = await a.client.raw('GET', csv.body.a.downloadUrl.replace(/^https?:\/\/[^/]+/, ''));
    expect(dl.headers.get('content-disposition')).toStartWith('attachment');
    expect(await dl.text()).toBe('id,name\n1,a\n');
  });

  test('drive compare lists added, removed, changed and moved paths', async () => {
    const a = await user('dc@test.local');
    await upload(a, { '/keep.txt': 'same', '/edit.txt': 'before', '/gone.txt': 'bye', '/old-name.txt': 'moving' });
    const from = await head(a);
    await upload(a, { '/edit.txt': 'after!', '/added.txt': 'hi' });
    await a.client.post(api(a, '/files/delete'), { paths: ['/gone.txt'] });
    await a.client.post(api(a, '/files/move'), { items: [{ from: '/old-name.txt', to: '/new-name.txt' }] });
    const to = await head(a);

    const r = await a.client.get(api(a, `/compare/drive?${q({ a: from, b: to })}`));
    expect(r.status).toBe(200);
    const byPath = Object.fromEntries((r.body.changes as { path: string; op: string; fromPath?: string }[]).map((c) => [c.path, c]));
    expect(byPath['/added.txt'].op).toBe('added');
    expect(byPath['/gone.txt'].op).toBe('removed');
    expect(byPath['/edit.txt'].op).toBe('changed');
    expect(byPath['/new-name.txt']).toMatchObject({ op: 'moved', fromPath: '/old-name.txt' });
    expect(byPath['/keep.txt']).toBeUndefined();
    // Reversed arguments are swapped by the server.
    const rev = await a.client.get(api(a, `/compare/drive?${q({ a: to, b: from })}`));
    expect(rev.body.a.commitId).toBe(from);
    expect(rev.body.changes.length).toBe(r.body.changes.length);
  });
});

describe('restore', () => {
  test('file restore brings old bytes back as a new version without resending blocks; undo reverts it', async () => {
    const a = await user('rf@test.local');
    await upload(a, { '/essay.md': 'first draft' });
    const v1 = await head(a);
    await upload(a, { '/essay.md': 'second draft' });

    const r = await a.client.post(api(a, '/restore'), { scope: 'file', path: '/essay.md', at: v1 });
    expect(r.status).toBe(200);
    expect(r.body.action).toMatchObject({ kind: 'restore.file', undoable: true });
    expect(r.body.action.summary).toStartWith('Restored essay.md to ');
    expect(await text(a, '/essay.md')).toBe('first draft');

    const u = await a.client.post(api(a, `/actions/${r.body.action.id}/undo`), {});
    expect(u.status).toBe(200);
    expect(await text(a, '/essay.md')).toBe('second draft');
    const kinds = (await timeline(a)).map((e) => e.kind);
    expect(kinds.slice(0, 2)).toEqual(['undo', 'restore.file']);

    const missing = await a.client.post(api(a, '/restore'), { scope: 'file', path: '/nope.md', at: v1 });
    expect(missing.status).toBe(404);
  });

  test('folder restore restores changed files, recreates removed ones and removes files added later', async () => {
    const a = await user('rfo@test.local');
    await upload(a, { '/Site/index.html': '<h1>v1</h1>', '/Site/css/app.css': 'body{}' }, { dirs: ['/Site/img'] });
    const v1 = await head(a);
    await upload(a, { '/Site/index.html': '<h1>v2</h1>', '/Site/extra.js': 'x()' });
    await a.client.post(api(a, '/files/delete'), { paths: ['/Site/css'] });
    await upload(a, { '/outside.txt': 'untouched' });

    const r = await a.client.post(api(a, '/restore'), { scope: 'folder', path: '/Site', at: v1 });
    expect(r.status).toBe(200);
    expect(r.body.action.kind).toBe('restore.folder');
    expect(await ls(a, '/Site')).toEqual(['css/', 'img/', 'index.html']);
    expect(await text(a, '/Site/index.html')).toBe('<h1>v1</h1>');
    expect(await text(a, '/Site/css/app.css')).toBe('body{}');
    expect(await text(a, '/outside.txt')).toBe('untouched');

    await a.client.post(api(a, `/actions/${r.body.action.id}/undo`), {});
    expect(await ls(a, '/Site')).toEqual(['img/', 'extra.js', 'index.html']);
    expect(await text(a, '/Site/index.html')).toBe('<h1>v2</h1>');
  });

  test('drive restore rolls everything back, auto-checkpoints first, and is undoable', async () => {
    const a = await user('rd@test.local');
    await upload(a, { '/a.txt': 'A1' });
    const v1 = await head(a);
    await upload(a, { '/a.txt': 'A2', '/b.txt': 'B' });
    const before = await head(a);

    const r = await a.client.post(api(a, '/restore'), { scope: 'drive', at: v1 });
    expect(r.status).toBe(200);
    expect(r.body.action.kind).toBe('restore.drive');
    expect(r.body.checkpoint.name).toStartWith('Before restore');
    expect(await ls(a)).toEqual(['a.txt']);
    expect(await text(a, '/a.txt')).toBe('A1');

    const cps = await a.client.get(api(a, '/checkpoints'));
    expect(cps.body.checkpoints[0]).toMatchObject({ auto: true, commitId: before });

    const u = await a.client.post(api(a, `/actions/${r.body.action.id}/undo`), {});
    expect(u.status).toBe(200);
    expect(await ls(a)).toEqual(['a.txt', 'b.txt']);
    expect(await text(a, '/a.txt')).toBe('A2');
    // The undo made no second checkpoint.
    expect((await a.client.get(api(a, '/checkpoints'))).body.checkpoints).toHaveLength(1);
  });
});

describe('checkpoints', () => {
  test('create on head or a past version, rename, list, remove; readable by tag', async () => {
    const a = await user('cp@test.local');
    await upload(a, { '/x.txt': 'x1' });
    const v1 = await head(a);
    await upload(a, { '/x.txt': 'x2' });

    const c1 = await a.client.post(api(a, '/checkpoints'), { name: 'First draft', note: 'before edits', at: v1 });
    expect(c1.status).toBe(201);
    expect(c1.body.checkpoint).toMatchObject({ name: 'First draft', note: 'before edits', commitId: v1, auto: false });
    const c2 = await a.client.post(api(a, '/checkpoints'), { name: 'Now' });
    expect(c2.body.checkpoint.commitId).toBe(await head(a));

    const upd = await a.client.patch(api(a, `/checkpoints/${c1.body.checkpoint.id}`), { name: 'Draft 1' });
    expect(upd.body.checkpoint.name).toBe('Draft 1');

    const list = await a.client.get(api(a, '/checkpoints'));
    expect(list.body.checkpoints.map((c: { name: string }) => c.name).sort()).toEqual(['Draft 1', 'Now']);
    expect(list.body.budget).toMatchObject({ used: 2, max: 100, checkpoints: 2, pinnedLinks: 0 });

    // Timeline badges.
    const t = await timeline(a);
    expect(t.find((e) => e.commitId === v1)!.checkpoints.map((c: { name: string }) => c.name)).toEqual(['Draft 1']);
    // File versions carry checkpoint names.
    const vs = await a.client.get(api(a, `/versions?${q({ path: '/x.txt' })}`));
    expect(vs.body.versions.find((v: { commitId: string }) => v.commitId === v1).checkpointNames).toEqual(['Draft 1']);

    const del = await a.client.del(api(a, `/checkpoints/${c1.body.checkpoint.id}`));
    expect(del.status).toBe(204);
    expect((await a.client.get(api(a, '/checkpoints'))).body.budget.used).toBe(1);
  });

  test('the 100-tag budget is enforced (shared with pinned links); a full budget skips the drive auto-checkpoint', async () => {
    const a = await user('budget@test.local');
    await upload(a, { '/f.txt': 'v1' });
    const v1 = await head(a);
    await upload(a, { '/f.txt': 'v2' });
    const pinned = await a.client.post(api(a, '/links'), { path: '/f.txt', mode: 'pinned' });
    expect(pinned.status).toBe(201);
    for (let i = 0; i < 99; i++) {
      const r = await a.client.post(api(a, '/checkpoints'), { name: `cp ${i}` });
      if (r.status !== 201) throw new Error(`checkpoint ${i}: ${r.status} ${r.text}`);
    }
    const list = await a.client.get(api(a, '/checkpoints'));
    expect(list.body.budget).toMatchObject({ used: 100, checkpoints: 99, pinnedLinks: 1 });
    const over = await a.client.post(api(a, '/checkpoints'), { name: 'one too many' });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('tag_budget_exceeded');
    const overLink = await a.client.post(api(a, '/links'), { path: '/f.txt', mode: 'pinned' });
    expect(overLink.status).toBe(409);

    const r = await a.client.post(api(a, '/restore'), { scope: 'drive', at: v1 });
    expect(r.status).toBe(200);
    expect(r.body.checkpointSkipped).toBe(true);
    expect(await text(a, '/f.txt')).toBe('v1');
  });
});

describe('recently deleted', () => {
  test('lists deleted items with a restore point and restores them through file restore', async () => {
    const a = await user('rdel@test.local');
    await upload(a, { '/old/report.pdf': 'pdf-bytes', '/memo.txt': 'memo' });
    await a.client.post(api(a, '/files/delete'), { paths: ['/memo.txt'] });
    await a.client.post(api(a, '/files/delete'), { paths: ['/old'] });

    const d = await a.client.get(api(a, '/deleted'));
    expect(d.status).toBe(200);
    const items = d.body.items as { path: string; type: string; restorable: boolean; restoreAt: string }[];
    expect(items.map((i) => i.path)).toEqual(['/old', '/memo.txt']);
    expect(items[0]).toMatchObject({ type: 'dir', restorable: true });

    const memo = items[1];
    const r = await a.client.post(api(a, '/restore'), { scope: 'file', path: memo.path, at: memo.restoreAt });
    expect(r.status).toBe(200);
    expect(await text(a, '/memo.txt')).toBe('memo');
    const folder = items[0];
    const rf = await a.client.post(api(a, '/restore'), { scope: 'folder', path: folder.path, at: folder.restoreAt });
    expect(rf.status).toBe(200);
    expect(await text(a, '/old/report.pdf')).toBe('pdf-bytes');

    // Restored items leave the list.
    expect((await a.client.get(api(a, '/deleted'))).body.items).toEqual([]);
  });
});

describe('versions survive thinning', () => {
  test('past versions stay readable by tag after retention runs', async () => {
    let now = Date.now();
    const store = await freshWorld({ now: () => now });
    const a = await user('thin@test.local');
    await upload(a, { '/f.txt': 'keep me' });
    const v1 = await head(a);
    await a.client.post(api(a, '/checkpoints'), { name: 'Keep' });
    for (let i = 0; i < 55; i++) {
      if (i % 25 === 0) resetRateLimits(); // upload plans are limited to 30/min per user
      await upload(a, { '/f.txt': `edit ${i}` });
    }
    now += 9 * 24 * 3600_000;
    const [row] = await db.select({ v: workspaces.volumeId }).from(workspaces).where(eq(workspaces.id, a.ws));
    await store.gc(row.v!);
    now += 3 * 24 * 3600_000; // past the 48 h grace: thinned commits are purged
    await store.gc(row.v!);
    const t = await timeline(a, 200);
    // Every entry the timeline shows is still readable.
    for (const e of t) expect((await a.client.get(api(a, `/commits/${e.commitId}`))).status).toBe(200);
    expect(t.length).toBeLessThanOrEqual(51);
    expect(t.find((e) => e.commitId === v1)).toBeTruthy();
    expect(dec(new TextEncoder().encode(await text(a, '/f.txt', v1)))).toBe('keep me');
  });
});

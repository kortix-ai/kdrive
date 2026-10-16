// End to end: comments on files and the drive's tags (labels). Every member
// comments, editors tag; both follow their item through renames and moves, go
// away with a delete, and come back with an undo or a restore.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Json } from '../helpers';
import { endWorld, freshWorld, head, q, upload, user, type User } from './kit';

beforeEach(async () => {
  await freshWorld();
});
afterEach(endWorld);
afterAll(endWorld);


async function join(owner: User, who: User, role: 'editor' | 'viewer'): Promise<User> {
  const inv = await owner.client.post(`/api/workspaces/${owner.ws}/invites`, { email: who.me.user.email, role });
  expect(inv.status).toBe(201);
  const mine = (await who.client.get('/api/invitations')).body.invitations.find((i: Json) => i.workspaceId === owner.ws);
  expect((await who.client.post(`/api/invitations/${mine.id}/accept`, {})).status).toBe(200);
  return { ...who, ws: owner.ws };
}

const w = (u: Pick<User, 'ws'>, p: string) => `/api/w/${u.ws}${p}`;
const comments = async (u: User, path: string): Promise<Json[]> => {
  const r = await u.client.get(w(u, `/comments?${q({ path })}`));
  expect(r.status).toBe(200);
  return r.body.comments;
};
const post = (u: User, path: string, body: string, parentId?: string) => u.client.post(w(u, '/comments'), { path, body, parentId });
const labels = async (u: User): Promise<Json> => (await u.client.get(w(u, '/labels'))).body;
const tagsOn = (l: Json, path: string): string[] => {
  const a = (l.assignments as Json[]).find((x) => x.path === path);
  return a ? a.labelIds.map((id: string) => (l.labels as Json[]).find((x) => x.id === id)!.name) : [];
};

describe('comments', () => {
  test('owner, editor and viewer comment; replies, edit, resolve, delete rules', async () => {
    const ada = await user('ada@test.local');
    await upload(ada, { '/plan.md': 'v1' });
    const ben = await join(ada, await user('ben@test.local'), 'editor');
    const vic = await join(ada, await user('vic@test.local'), 'viewer');

    const first = await post(ada, '/plan.md', '  Looks good.\r\nSee https://example.com  ');
    expect(first.status).toBe(201);
    const c1 = first.body.comment;
    expect(c1).toMatchObject({ path: '/plan.md', parentId: null, body: 'Looks good.\nSee https://example.com', canEdit: true, canDelete: true });
    expect(c1.author.email).toBe('ada@test.local');
    expect(c1.commitId).toBe(await head(ada));
    expect(typeof c1.commitAt).toBe('string');

    // A viewer comments and replies; replying to a reply lands in the same thread.
    const r1 = (await post(vic, '/plan.md', 'Question from a viewer', c1.id)).body.comment;
    expect(r1.parentId).toBe(c1.id);
    const r2 = (await post(ben, '/plan.md', 'Answer', r1.id)).body.comment;
    expect(r2.parentId).toBe(c1.id);

    // Edit own only.
    expect((await ben.client.patch(w(ben, `/comments/${c1.id}`), { body: 'hijack' })).status).toBe(403);
    const edited = await vic.client.patch(w(vic, `/comments/${r1.id}`), { body: 'Better question' });
    expect(edited.status).toBe(200);
    expect(edited.body.comment.editedAt).not.toBeNull();

    // Anyone resolves / reopens a thread; only roots resolve; a reply reopens.
    expect((await vic.client.patch(w(vic, `/comments/${r1.id}`), { resolved: true })).status).toBe(400);
    const res = await vic.client.patch(w(vic, `/comments/${c1.id}`), { resolved: true });
    expect(res.body.comment.resolvedAt).not.toBeNull();
    let counts = (await ada.client.get(w(ada, '/comments/counts'))).body.counts;
    expect(counts).toEqual([{ path: '/plan.md', count: 3, open: 0 }]);
    await post(ben, '/plan.md', 'One more', c1.id);
    expect((await comments(ada, '/plan.md')).find((c) => c.id === c1.id)!.resolvedAt).toBeNull();

    // Delete: own, or anything for the owner (audited); a root takes its replies.
    expect((await vic.client.del(w(vic, `/comments/${r2.id}`))).status).toBe(403);
    expect((await ben.client.del(w(ben, `/comments/${r2.id}`))).status).toBe(204);
    expect((await ada.client.del(w(ada, `/comments/${r1.id}`))).status).toBe(204);
    const audit = (await ada.client.get('/api/me/audit')).body.events.map((e: Json) => e.kind);
    expect(audit).toContain('comment.delete');
    expect((await ada.client.del(w(ada, `/comments/${c1.id}`))).status).toBe(204);
    expect(await comments(ada, '/plan.md')).toEqual([]);
    counts = (await ada.client.get(w(ada, '/comments/counts'))).body.counts;
    expect(counts).toEqual([]);
  });

  test('refusals: empty, too long, missing file, folders, strangers', async () => {
    const ada = await user('ada2@test.local');
    await upload(ada, { '/docs/a.txt': 'a' });
    expect((await post(ada, '/docs/a.txt', '   ')).status).toBe(400);
    expect((await post(ada, '/docs/a.txt', 'x'.repeat(4001))).status).toBe(400);
    expect((await post(ada, '/docs/a.txt', 'x'.repeat(4000))).status).toBe(201);
    expect((await post(ada, '/nope.txt', 'hi')).body.error.code).toBe('path_not_found');
    expect((await post(ada, '/docs', 'hi')).body.error.code).toBe('not_a_file');
    const eve = await user('eve@test.local');
    expect((await eve.client.get(`/api/w/${ada.ws}/comments?${q({ path: '/docs/a.txt' })}`)).status).toBe(404);
    expect((await eve.client.post(`/api/w/${ada.ws}/comments`, { path: '/docs/a.txt', body: 'hi' })).status).toBe(404);
  });

  test('comments follow renames and moves, leave with a delete and come back with undo or restore', async () => {
    const ada = await user('ada3@test.local');
    await upload(ada, { '/a/notes.md': 'n1', '/b/keep.txt': 'k' });
    const c = (await post(ada, '/a/notes.md', 'hello')).body.comment;

    const mv = await ada.client.post(w(ada, '/files/move'), { items: [{ from: '/a', to: '/b/a' }] });
    expect(mv.status).toBe(200);
    expect((await comments(ada, '/b/a/notes.md')).map((x) => x.id)).toEqual([c.id]);
    const rn = await ada.client.post(w(ada, '/files/move'), { items: [{ from: '/b/a/notes.md', to: '/b/a/renamed.md' }] });
    expect(await comments(ada, '/b/a/notes.md')).toEqual([]);
    expect((await comments(ada, '/b/a/renamed.md')).map((x) => x.id)).toEqual([c.id]);

    // Undo the rename: back to the old name.
    expect((await ada.client.post(w(ada, `/actions/${rn.body.action.id}/undo`), {})).status).toBe(200);
    expect((await comments(ada, '/b/a/notes.md')).map((x) => x.id)).toEqual([c.id]);

    // Delete: gone (and a new file there starts clean); undo brings it back.
    const del = await ada.client.post(w(ada, '/files/delete'), { paths: ['/b/a/notes.md'] });
    expect(await comments(ada, '/b/a/notes.md')).toEqual([]);
    expect((await ada.client.get(w(ada, '/comments/counts'))).body.counts).toEqual([]);
    expect((await ada.client.post(w(ada, `/actions/${del.body.action.id}/undo`), {})).status).toBe(200);
    expect((await comments(ada, '/b/a/notes.md')).map((x) => x.id)).toEqual([c.id]);

    // Delete again, then restore from Recently deleted.
    await ada.client.post(w(ada, '/files/delete'), { paths: ['/b/a/notes.md'] });
    const gone = (await ada.client.get(w(ada, '/deleted'))).body.items.find((i: Json) => i.path === '/b/a/notes.md');
    expect(gone.restoreAt).toBeTruthy();
    const rr = await ada.client.post(w(ada, '/restore'), { scope: 'file', path: '/b/a/notes.md', at: gone.restoreAt });
    expect(rr.status).toBe(200);
    expect((await comments(ada, '/b/a/notes.md')).map((x) => x.id)).toEqual([c.id]);
  });
});

describe('tags', () => {
  test('editors manage tags, viewers read them; names are unique ignoring case', async () => {
    const ada = await user('ada4@test.local');
    await upload(ada, { '/r.pdf': 'r', '/docs/x.md': 'x' });
    const ben = await join(ada, await user('ben4@test.local'), 'editor');
    const vic = await join(ada, await user('vic4@test.local'), 'viewer');

    const made = await ben.client.post(w(ben, '/labels'), { name: '  Needs   review ', color: 'clay' });
    expect(made.status).toBe(201);
    const nr = made.body.label;
    expect(nr).toMatchObject({ name: 'Needs review', color: 'clay', count: 0 });
    expect((await ada.client.post(w(ada, '/labels'), { name: 'NEEDS REVIEW', color: 'sky' })).status).toBe(409);
    expect((await ada.client.post(w(ada, '/labels'), { name: 'x'.repeat(33), color: 'sky' })).status).toBe(400);
    expect((await ada.client.post(w(ada, '/labels'), { name: 'Bad', color: 'neon' })).status).toBe(400);
    expect((await vic.client.post(w(vic, '/labels'), { name: 'Mine', color: 'sky' })).status).toBe(403);

    const fin = (await ada.client.post(w(ada, '/labels'), { name: 'Final', color: 'sage' })).body.label;
    const as = await ben.client.post(w(ben, '/labels/assign'), { labelId: nr.id, paths: ['/r.pdf', '/docs'], assigned: true });
    expect(as.status).toBe(200);
    // Assigning twice is a no-op.
    await ben.client.post(w(ben, '/labels/assign'), { labelId: nr.id, paths: ['/r.pdf'], assigned: true });
    await ada.client.post(w(ada, '/labels/assign'), { labelId: fin.id, paths: ['/r.pdf'], assigned: true });
    expect((await vic.client.post(w(vic, '/labels/assign'), { labelId: fin.id, paths: ['/docs'], assigned: true })).status).toBe(403);
    const missing = await ada.client.post(w(ada, '/labels/assign'), { labelId: fin.id, paths: ['/missing'], assigned: true });
    expect(missing.body.error.code).toBe('path_not_found');

    const seen = await labels(vic);
    expect(tagsOn(seen, '/r.pdf').sort()).toEqual(['Final', 'Needs review']);
    expect(tagsOn(seen, '/docs')).toEqual(['Needs review']);
    expect(seen.labels.map((l: Json) => `${l.name}:${l.count}`)).toEqual(['Final:1', 'Needs review:2']);

    // Rename and recolour; a clash with another name is refused.
    expect((await ada.client.patch(w(ada, `/labels/${fin.id}`), { name: 'needs REVIEW' })).status).toBe(409);
    const up = await ada.client.patch(w(ada, `/labels/${fin.id}`), { name: 'Approved', color: 'moss' });
    expect(up.body.label).toMatchObject({ name: 'Approved', color: 'moss', count: 1 });

    // Unassign, then delete a tag (it leaves every item).
    await ben.client.post(w(ben, '/labels/assign'), { labelId: nr.id, paths: ['/docs'], assigned: false });
    expect(tagsOn(await labels(ada), '/docs')).toEqual([]);
    expect((await vic.client.del(w(vic, `/labels/${nr.id}`))).status).toBe(403);
    expect((await ben.client.del(w(ben, `/labels/${nr.id}`))).status).toBe(204);
    expect(tagsOn(await labels(ada), '/r.pdf')).toEqual(['Approved']);
    const kinds = (await ben.client.get('/api/me/audit')).body.events.map((e: Json) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['label.create', 'label.delete']));
  });

  test('tags follow moves, leave with a delete and come back with undo; copies start clean', async () => {
    const ada = await user('ada5@test.local');
    await upload(ada, { '/p/one.txt': '1', '/p/two.txt': '2' });
    const t = (await ada.client.post(w(ada, '/labels'), { name: 'Hot', color: 'rose' })).body.label;
    await ada.client.post(w(ada, '/labels/assign'), { labelId: t.id, paths: ['/p', '/p/one.txt'], assigned: true });

    await ada.client.post(w(ada, '/files/move'), { items: [{ from: '/p', to: '/q' }] });
    let l = await labels(ada);
    expect(l.assignments.map((a: Json) => a.path)).toEqual(['/q', '/q/one.txt']);
    const items = (await ada.client.get(w(ada, `/labels/${t.id}/items`))).body.items;
    expect(items.map((e: Json) => `${e.path}:${e.type}`)).toEqual(['/q:dir', '/q/one.txt:file']);

    const del = await ada.client.post(w(ada, '/files/delete'), { paths: ['/q'] });
    l = await labels(ada);
    expect(l.assignments).toEqual([]);
    expect(l.labels[0].count).toBe(0);
    expect((await ada.client.post(w(ada, `/actions/${del.body.action.id}/undo`), {})).status).toBe(200);
    l = await labels(ada);
    expect(l.assignments.map((a: Json) => a.path)).toEqual(['/q', '/q/one.txt']);

    await ada.client.post(w(ada, '/files/copy'), { items: [{ from: '/q', to: '/r' }] });
    expect((await labels(ada)).assignments.map((a: Json) => a.path)).toEqual(['/q', '/q/one.txt']);
  });
});

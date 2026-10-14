// End to end: Settings → Storage. The overview of the user's own drives (by kind
// of file, per drive, largest files, recent replaced / deleted content), and who
// in a shared drive wrote the files that are there now, through moves,
// overwrites, copies, restores, agents and duplicates.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { actions } from '../../src/db/schema';
import { captureMail, type Mailbox } from '../mail';
import { endWorld, freshWorld, upload, user, type User } from './kit';
import type { Json } from '../helpers';

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

const bytes = (n: number, fill = 'x') => fill.repeat(n);

/** `owner` invites `who` with `role`, and `who` accepts. Returns `who` pointed at the owner's drive. */
async function join(owner: User, who: User, role: 'editor' | 'viewer'): Promise<User> {
  expect((await owner.client.post(`/api/workspaces/${owner.ws}/invites`, { email: who.me.user.email, role })).status).toBe(201);
  const inv = (await who.client.get('/api/invitations')).body.invitations.find((i: Json) => i.workspaceId === owner.ws);
  expect((await who.client.post(`/api/invitations/${inv.id}/accept`, {})).status).toBe(200);
  return { ...who, ws: owner.ws };
}

async function people(u: Pick<User, 'client' | 'ws'>): Promise<Json> {
  const r = await u.client.get(`/api/w/${u.ws}/storage/people`);
  if (r.status !== 200) throw new Error(`people ${r.status}: ${r.text}`);
  return r.body;
}

/** email → [bytes, files] for everyone listed, plus the untracked share. */
function shares(body: Json): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const p of body.people as Json[]) out[p.person.email] = [p.bytes, p.files];
  out.untracked = [body.untracked.bytes, body.untracked.files];
  return out;
}

async function overview(u: User): Promise<Json> {
  const r = await u.client.get('/api/me/storage');
  if (r.status !== 200) throw new Error(`storage ${r.status}: ${r.text}`);
  return r.body;
}

const cat = (body: Json, c: string) => (body.categories as Json[]).find((x) => x.category === c);

describe('overview', () => {
  test('bytes and files by kind, per drive, the largest files, and what history keeps', async () => {
    const ada = await user('ada@test.local');
    await upload(ada, {
      '/Photos/beach.png': bytes(3000),
      '/Photos/dog.jpg': bytes(1000),
      '/clip.mp4': bytes(5000),
      '/song.wav': bytes(2000),
      '/Docs/report.pdf': bytes(1500),
      '/notes.md': bytes(100),
      '/src/main.ts': bytes(200),
      '/backup.zip': bytes(800),
      '/blob.bin': bytes(50),
    });
    const work = (await ada.client.post('/api/workspaces', { name: 'Work' })).body.workspace.id as string;
    await upload({ ...ada, ws: work }, { '/Film/cut.mov': bytes(9000) });

    let body = await overview(ada);
    expect(cat(body, 'images')).toEqual({ category: 'images', bytes: 4000, files: 2 });
    expect(cat(body, 'videos')).toEqual({ category: 'videos', bytes: 14000, files: 2 });
    expect(cat(body, 'audio')).toEqual({ category: 'audio', bytes: 2000, files: 1 });
    expect(cat(body, 'documents')).toEqual({ category: 'documents', bytes: 1600, files: 2 });
    expect(cat(body, 'code')).toEqual({ category: 'code', bytes: 200, files: 1 });
    expect(cat(body, 'archives')).toEqual({ category: 'archives', bytes: 800, files: 1 });
    expect(cat(body, 'other')).toEqual({ category: 'other', bytes: 50, files: 1 });
    expect(body.fileBytes).toBe(22650);
    expect(body.files).toBe(10);
    expect(body.partial).toBe(false);

    // Per drive: the quota's numbers (whole pages plus folders) next to the files' own sizes.
    expect(body.drives.map((d: Json) => [d.name, d.files, d.fileBytes, d.members])).toEqual([
      ['My Drive', 9, 13650, 0],
      ['Work', 1, 9000, 0],
    ]);
    expect(body.usedBytes).toBe(body.drives[0].bytes + body.drives[1].bytes);
    expect(body.usedBytes).toBe((await ada.client.get('/api/me/usage')).body.usedBytes);
    expect(body.drives[1].categories.find((c: Json) => c.category === 'videos')).toMatchObject({ bytes: 9000, files: 1 });

    // Largest first, across drives, with the drive they are in.
    expect(body.largest.slice(0, 3).map((f: Json) => [f.workspaceName, f.path, f.size, f.category])).toEqual([
      ['Work', '/Film/cut.mov', 9000, 'videos'],
      ['My Drive', '/clip.mp4', 5000, 'videos'],
      ['My Drive', '/Photos/beach.png', 3000, 'images'],
    ]);
    expect(body.largest).toHaveLength(10);
    expect(body.largest.at(-1).path).toBe('/blob.bin');

    // Nothing replaced or deleted yet.
    expect(body.history).toMatchObject({ windowDays: 7, replacedBytes: 0, replacedFiles: 0, deletedBytes: 0, deletedItems: 0 });
    await upload(ada, { '/notes.md': bytes(300, 'y') });
    expect((await ada.client.post(`/api/w/${ada.ws}/files/delete`, { paths: ['/blob.bin', '/Photos'] })).status).toBe(200);
    body = await overview(ada);
    expect(body.history).toMatchObject({ replacedBytes: 100, replacedFiles: 1, deletedBytes: 4050, deletedItems: 2 });
    expect(cat(body, 'images')).toMatchObject({ bytes: 0, files: 0 });
    expect(cat(body, 'documents')).toMatchObject({ bytes: 1800, files: 2 });
  });

  test('only your own drives: a drive shared with you is not in your overview', async () => {
    const ada = await user('ada2@test.local');
    const ben = await user('ben2@test.local');
    await upload(ada, { '/a.png': bytes(500) });
    await join(ada, ben, 'editor');
    const b = await overview(ben);
    expect(b.drives).toHaveLength(1);
    expect(b.files).toBe(0);
    const a = await overview(ada);
    expect(a.drives[0]).toMatchObject({ files: 1, members: 1 });
  });
});

describe('people', () => {
  test('a file counts toward whoever last wrote it; moves and renames keep the writer', async () => {
    const ada = await user('ada3@test.local');
    const ben0 = await user('ben3@test.local');
    const cy0 = await user('cy3@test.local');
    const ben = await join(ada, ben0, 'editor');
    const cy = await join(ada, cy0, 'viewer');

    await upload(ada, { '/shared/a.txt': bytes(10), '/shared/b.txt': bytes(20) });
    await upload(ben, { '/ben/c.txt': bytes(30), '/ben/d.bin': bytes(40) });
    // Ben moves Ada's file: still Ada's.
    expect((await ben.client.post(`/api/w/${ada.ws}/files/move`, { items: [{ from: '/shared/a.txt', to: '/moved/a.txt' }] })).status).toBe(200);
    // Ben overwrites Ada's other file: now Ben's.
    await upload(ben, { '/shared/b.txt': bytes(25, 'b') });
    // Ada moves Ben's whole folder, then renames a file in it: still Ben's.
    expect((await ada.client.post(`/api/w/${ada.ws}/files/move`, { items: [{ from: '/ben', to: '/archive/ben' }] })).status).toBe(200);
    expect((await ada.client.post(`/api/w/${ada.ws}/files/move`, { items: [{ from: '/archive/ben/d.bin', to: '/archive/ben/data.bin' }] })).status).toBe(200);
    // A copy is new bytes from whoever copied.
    expect((await ada.client.post(`/api/w/${ada.ws}/files/copy`, { items: [{ from: '/archive/ben/c.txt', to: '/c-copy.txt' }] })).status).toBe(200);

    const body = await people(ada);
    expect(body.files).toBe(5);
    expect(body.fileBytes).toBe(135);
    expect(shares(body)).toEqual({
      'ben3@test.local': [95, 3],
      'ada3@test.local': [40, 2],
      'cy3@test.local': [0, 0],
      untracked: [0, 0],
    });
    expect(body.people.map((p: Json) => p.role)).toEqual(['editor', 'owner', 'viewer']);
    expect(body.partial).toBe(false);

    // Every member sees the same split, the viewer included; nobody else sees it.
    expect(shares(await people(ben))).toEqual(shares(body));
    expect(shares(await people(cy))).toEqual(shares(body));
    const eve = await user('eve3@test.local');
    expect((await eve.client.get(`/api/w/${ada.ws}/storage/people`)).status).toBe(404);

    // A folder copy is the copier's; a folder delete takes everything in it away.
    expect((await ben.client.post(`/api/w/${ada.ws}/files/copy`, { items: [{ from: '/moved', to: '/moved-copy' }] })).status).toBe(200);
    expect((await ada.client.post(`/api/w/${ada.ws}/files/delete`, { paths: ['/archive'] })).status).toBe(200);
    expect(shares(await people(ada))).toMatchObject({ 'ben3@test.local': [35, 2], 'ada3@test.local': [40, 2] });

    // Someone who left keeps their share, marked former.
    expect((await ada.client.del(`/api/workspaces/${ada.ws}/members/${ben.userId}`)).status).toBe(204);
    const after = await people(ada);
    expect(after.people.find((p: Json) => p.person.email === 'ben3@test.local')).toMatchObject({ role: 'former', bytes: 35, files: 2 });
  });

  test('a restore or an undo is new bytes from whoever ran it', async () => {
    const ada = await user('ada4@test.local');
    const ben = await join(ada, await user('ben4@test.local'), 'editor');
    await upload(ada, { '/plan.md': bytes(10) });
    const del = await ben.client.post(`/api/w/${ada.ws}/files/delete`, { paths: ['/plan.md'] });
    expect(del.status).toBe(200);
    expect(shares(await people(ada))).toMatchObject({ 'ada4@test.local': [0, 0], 'ben4@test.local': [0, 0] });
    // Ben undoes his delete: the file comes back by Ben's hand.
    expect((await ben.client.post(`/api/w/${ada.ws}/actions/${del.body.action.id}/undo`, {})).status).toBe(200);
    expect(shares(await people(ada))).toMatchObject({ 'ada4@test.local': [0, 0], 'ben4@test.local': [10, 1] });
  });

  test("an agent's change counts toward its person; a duplicate's original files are untracked", async () => {
    const ada = await user('ada5@test.local');
    const { commit } = await upload(ada, { '/agent.md': bytes(70), '/mine.md': bytes(5) });
    await upload(ada, { '/mine.md': bytes(6) });
    // Mark the first upload as made by an AI agent acting for Ada.
    await db.update(actions).set({ actorKind: 'agent', agentName: 'Helper', agentCredential: 'pat:x' }).where(eq(actions.id, commit.action.id));
    const body = await people(ada);
    expect(body.people).toEqual([
      { person: { id: ada.userId, name: expect.anything(), email: 'ada5@test.local' }, role: 'owner', bytes: 76, files: 2, agentBytes: 70 },
    ]);

    const dup = await ada.client.post(`/api/workspaces/${ada.ws}/duplicate`, { name: 'Copy' });
    expect(dup.status).toBe(201);
    const copy = { ...ada, ws: dup.body.workspace.id as string };
    expect(shares(await people(copy))).toEqual({ 'ada5@test.local': [0, 0], untracked: [76, 2] });
    // A change in the copy is attributed as usual.
    await upload(copy, { '/new.md': bytes(4) });
    expect(shares(await people(copy))).toEqual({ 'ada5@test.local': [4, 1], untracked: [76, 2] });
  });
});

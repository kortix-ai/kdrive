// End to end: Starred and Recent. Stars are per person, follow their item through
// renames and moves like a live link, leave with a delete (and come back with its undo),
// and hide when access to the drive ends. Recent merges the person's opens with their
// own changes from the ledger, newest first, and drops what no longer exists.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { recentOpens } from '../../src/db/schema';
import { RECENT_OPENS_CAP } from '../../src/services/recent';
import { endWorld, freshWorld, upload, user, type User } from './kit';

beforeEach(async () => {
  await freshWorld();
});
afterEach(() => endWorld());
afterAll(endWorld);

async function join(owner: User, who: User, role: 'editor' | 'viewer'): Promise<User> {
  expect((await owner.client.post(`/api/workspaces/${owner.ws}/invites`, { email: who.me.user.email, role })).status).toBe(201);
  const list = (await who.client.get('/api/invitations')).body.invitations;
  const mine = list.find((i: { workspaceId: string }) => i.workspaceId === owner.ws);
  expect((await who.client.post(`/api/invitations/${mine.id}/accept`, {})).status).toBe(200);
  return { ...who, ws: owner.ws };
}

const star = (u: User, paths: string[], starred = true) => u.client.post('/api/stars', { workspaceId: u.ws, paths, starred });
const starredPaths = async (u: User) => ((await u.client.get('/api/stars')).body.items as { path: string }[]).map((i) => i.path);
const driveStars = async (u: User) => (await u.client.get(`/api/w/${u.ws}/stars`)).body.paths as string[];
const recent = async (u: User) => (await u.client.get('/api/recent')).body.items as { path: string; reason: string; workspaceId: string }[];

describe('starred', () => {
  test('star and unstar files and folders; the list names the drive and reads the item now', async () => {
    const a = await user('star-basic@test.local');
    await upload(a, { '/docs/plan.md': 'plan', '/b.txt': 'bee' });

    const r = await star(a, ['/docs', '/b.txt']);
    expect(r.status).toBe(200);
    expect(r.body.paths).toEqual(['/b.txt', '/docs']);
    // Starring twice is harmless.
    expect((await star(a, ['/b.txt'])).body.paths).toEqual(['/b.txt', '/docs']);

    const list = (await a.client.get('/api/stars')).body.items;
    expect(list).toHaveLength(2);
    expect(list.find((i: { path: string }) => i.path === '/docs')).toMatchObject({ type: 'dir', name: 'docs', workspaceName: 'My Drive', workspaceId: a.ws });
    expect(list.find((i: { path: string }) => i.path === '/b.txt')).toMatchObject({ type: 'file', size: 3 });

    expect((await star(a, ['/docs'], false)).body.paths).toEqual(['/b.txt']);
    expect(await driveStars(a)).toEqual(['/b.txt']);

    // Nothing there, the drive itself, and someone else's drive.
    expect((await star(a, ['/nope.txt'])).status).toBe(404);
    expect((await star(a, ['/'])).status).toBe(400);
    const b = await user('star-other@test.local');
    expect((await b.client.post('/api/stars', { workspaceId: a.ws, paths: ['/b.txt'], starred: true })).status).toBe(404);
    expect(await starredPaths(b)).toEqual([]);
  });

  test('stars follow renames and folder moves, leave with a delete and come back with its undo', async () => {
    const a = await user('star-follow@test.local');
    await upload(a, { '/docs/plan.md': 'plan', '/other.txt': 'o' }, { dirs: ['/archive'] });
    await star(a, ['/docs/plan.md', '/other.txt']);

    expect((await a.client.post(`/api/w/${a.ws}/files/move`, { items: [{ from: '/docs/plan.md', to: '/docs/roadmap.md' }] })).status).toBe(200);
    expect((await a.client.post(`/api/w/${a.ws}/files/move`, { items: [{ from: '/docs', to: '/archive/docs' }] })).status).toBe(200);
    expect(await driveStars(a)).toEqual(['/archive/docs/roadmap.md', '/other.txt']);

    // Something new at the old path is not starred.
    await upload(a, { '/docs/plan.md': 'new plan' });
    expect(await driveStars(a)).toEqual(['/archive/docs/roadmap.md', '/other.txt']);

    const del = await a.client.post(`/api/w/${a.ws}/files/delete`, { paths: ['/archive'] });
    expect(del.status).toBe(200);
    expect(await starredPaths(a)).toEqual(['/other.txt']);

    expect((await a.client.post(`/api/w/${a.ws}/actions/${del.body.action.id}/undo`, {})).status).toBe(200);
    expect((await starredPaths(a)).sort()).toEqual(['/archive/docs/roadmap.md', '/other.txt']);
  });

  test('stars are private, viewers can star, and losing access hides them', async () => {
    const owner = await user('star-owner@test.local');
    const viewer = await join(owner, await user('star-viewer@test.local'), 'viewer');
    await upload(owner, { '/shared.md': 'hi' });

    expect((await star(viewer, ['/shared.md'])).status).toBe(200);
    expect(await starredPaths(viewer)).toEqual(['/shared.md']);
    expect(await starredPaths(owner)).toEqual([]);
    expect(await driveStars(owner)).toEqual([]);

    expect((await owner.client.del(`/api/workspaces/${owner.ws}/members/${viewer.userId}`)).status).toBe(204);
    expect(await starredPaths(viewer)).toEqual([]);
    expect((await viewer.client.get(`/api/w/${owner.ws}/stars`)).status).toBe(404);
  });
});

describe('recent', () => {
  test('own changes and opens across drives, newest first, without what is gone', async () => {
    const owner = await user('recent-owner@test.local');
    const ed = await join(owner, await user('recent-editor@test.local'), 'editor');
    await upload(owner, { '/theirs.md': 'from the owner', '/old.md': 'x' });
    const mine = { ...ed, ws: ed.me.defaultWorkspaceId as string };
    await upload(mine, { '/mine.txt': 'mine' });

    // The owner's upload is not the editor's change; opening it is.
    expect((await recent(ed)).map((i) => `${i.path}:${i.reason}`)).toEqual(['/mine.txt:edited']);
    expect((await ed.client.post('/api/recent/opened', { workspaceId: owner.ws, path: '/theirs.md' })).status).toBe(204);
    expect((await ed.client.post('/api/recent/opened', { workspaceId: owner.ws, path: '/old.md' })).status).toBe(204);
    const items = await recent(ed);
    expect(items.map((i) => `${i.path}:${i.reason}`)).toEqual(['/old.md:opened', '/theirs.md:opened', '/mine.txt:edited']);
    expect(items[0].workspaceId).toBe(owner.ws);

    // Re-opening moves an item up without a second row; editing it makes it "edited".
    await ed.client.post('/api/recent/opened', { workspaceId: owner.ws, path: '/theirs.md' });
    expect((await db.select().from(recentOpens).where(eq(recentOpens.userId, ed.userId))).length).toBe(2);
    await upload(ed, { '/old.md': 'edited by ed' });
    expect((await recent(ed)).map((i) => `${i.path}:${i.reason}`)).toEqual(['/old.md:edited', '/theirs.md:opened', '/mine.txt:edited']);

    // A rename by someone else carries the open along; a delete drops it.
    await owner.client.post(`/api/w/${owner.ws}/files/move`, { items: [{ from: '/theirs.md', to: '/renamed.md' }] });
    await owner.client.post(`/api/w/${owner.ws}/files/delete`, { paths: ['/old.md'] });
    expect((await recent(ed)).map((i) => i.path)).toEqual(['/renamed.md', '/mine.txt']);

    // Someone else's drive is never readable through Recent.
    const stranger = await user('recent-stranger@test.local');
    expect((await stranger.client.post('/api/recent/opened', { workspaceId: owner.ws, path: '/renamed.md' })).status).toBe(404);
  });

  test(`keeps at most ${RECENT_OPENS_CAP} opens per person`, async () => {
    const a = await user('recent-cap@test.local');
    const now = Date.now();
    await db.insert(recentOpens).values(
      Array.from({ length: RECENT_OPENS_CAP + 5 }, (_, i) => ({ userId: a.userId, workspaceId: a.ws, path: `/f${i}.txt`, openedAt: new Date(now - (i + 1) * 1000) })),
    );
    await a.client.post('/api/recent/opened', { workspaceId: a.ws, path: '/latest.txt' });
    const rows = await db.select().from(recentOpens).where(eq(recentOpens.userId, a.userId));
    expect(rows.length).toBe(RECENT_OPENS_CAP);
    expect(rows.some((r) => r.path === '/latest.txt')).toBe(true);
    expect(rows.some((r) => r.path === `/f${RECENT_OPENS_CAP + 4}.txt`)).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { db } from '../db/client';
import { workspaces } from '../db/schema';
import { newId } from '../lib/ids';
import { getStore } from '../storage';
import { buildTimeline } from './timeline';
import { toCtx } from './workspaces';
import { cleanWorld, freshWorld, kitFor, mkdir, move, remove, upload, te } from './versioning-test-kit';

describe('timeline', () => {
  beforeEach(() => freshWorld());
  afterEach(cleanWorld);

  test('upload → rename → delete: 3 entries newest first; reading at the first entry lists the original file', async () => {
    const k = await kitFor('tl1@test.local');
    await upload(k, { '/a.txt': 'hello' });
    await move(k, '/a.txt', '/b.txt');
    await remove(k, '/b.txt');

    const r = await k.client.get(`/api/w/${k.ws}/timeline`);
    expect(r.status).toBe(200);
    const e = r.body.entries;
    expect(e.map((x: any) => x.kind)).toEqual(['delete', 'rename', 'upload']);
    expect(e[0].summary).toBe('Deleted b.txt');
    expect(e[0].isHead).toBe(true);
    expect(e[1].isHead).toBe(false);
    expect(e[0].undoable).toBe(true);
    expect(e[2].paths).toEqual([{ op: 'added', path: '/a.txt', fromPath: null }]);
    expect(e[1].paths).toEqual([{ op: 'moved', path: '/b.txt', fromPath: '/a.txt' }]);
    // Real file bytes from the ledger, not 4 KiB storage pages.
    expect(e[2].bytesDelta).toBe(5);
    expect(e[1].bytesDelta).toBe(0);
    expect(e[0].bytesDelta).toBe(-5);
    expect(e[2].actor).toEqual({ name: expect.anything(), email: 'tl1@test.local' });
    expect(e.every((x: any) => x.mergedCount === 0)).toBe(true);
    expect(r.body.headCommitId).toBe(e[0].commitId);
    expect(r.body.nextCursor).toBeNull();

    const at = await getStore().list(k.vol, '/', { at: e[2].commitId });
    expect(at.entries.map((x) => x.path)).toEqual(['/a.txt']);
    const now = await getStore().list(k.vol, '/');
    expect(now.entries).toEqual([]);

    const commit = await k.client.get(`/api/w/${k.ws}/commits/${e[1].commitId}`);
    expect(commit.status).toBe(200);
    expect(commit.body.action.kind).toBe('rename');
    expect(commit.body.id).toBe(e[1].commitId);
    const head = await k.client.get(`/api/w/${k.ws}/commits/head`);
    expect(head.body.id).toBe(e[0].commitId);
  });

  test('one action with several commits is one entry; paging never splits it', async () => {
    const k = await kitFor('tl2@test.local');
    await upload(k, { '/x/1.txt': '1', '/x/2.txt': '2', '/x/3.txt': '3' });
    await remove(k, '/x/1.txt', '/x/2.txt', '/x/3.txt'); // 3 commits, one action
    await mkdir(k, '/docs');

    const all = await k.client.get(`/api/w/${k.ws}/timeline`);
    expect(all.body.entries.map((x: any) => x.kind)).toEqual(['folder.create', 'delete', 'upload']);
    expect(all.body.entries[1].itemCount).toBe(3);

    const p1 = await k.client.get(`/api/w/${k.ws}/timeline?limit=2`);
    expect(p1.body.entries.map((x: any) => x.kind)).toEqual(['folder.create', 'delete']);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await k.client.get(`/api/w/${k.ws}/timeline?limit=2&before=${p1.body.nextCursor}`);
    expect(p2.body.entries.map((x: any) => x.kind)).toEqual(['upload']);
    expect(p2.body.nextCursor).toBeNull();
  });

  test('checkpoint badges and external commits', async () => {
    const k = await kitFor('tl3@test.local');
    await upload(k, { '/a.txt': 'a' });
    const cp = await k.client.post(`/api/w/${k.ws}/checkpoints`, { name: 'First draft' });
    expect(cp.status).toBe(201);
    await getStore().write(k.vol, '/outside.txt', te('x')); // not through the app
    const r = await k.client.get(`/api/w/${k.ws}/timeline`);
    const [ext, up] = r.body.entries;
    expect(ext.kind).toBe('external');
    expect(ext.summary).toBe('Changed outside the app');
    expect(ext.undoable).toBe(false);
    expect(ext.actionId).toBeNull();
    expect(up.checkpoints).toEqual([{ id: cp.body.checkpoint.id, name: 'First draft' }]);
  });

  test('a duplicated workspace starts with "Workspace duplicated from …"', async () => {
    const k = await kitFor('tl6@test.local');
    const v1 = await upload(k, { '/a.txt': 'a' });
    await upload(k, { '/b.txt': 'b' });
    const id = newId();
    const forked = await getStore().forkVolume(k.vol, `vx-${id}`, v1.action.headCommitId!);
    const [row] = await db
      .insert(workspaces)
      .values({ id, userId: k.ctx.userId, name: 'Copy', volumeName: `vx-${id}`, volumeId: forked.id, forkedFromWorkspaceId: k.ws, forkedAtCommit: v1.action.headCommitId })
      .returning();
    const copy = { ...k, ctx: { ws: toCtx({ ...row, volumeId: forked.id }), userId: k.ctx.userId }, vol: forked.id, ws: id };
    await upload(copy, { '/c.txt': 'c' });
    const t = await buildTimeline(copy.ctx.ws, { limit: 50 });
    expect(t.entries.map((e) => e.kind)).toEqual(['upload', 'fork']);
    expect(t.entries[1]).toMatchObject({ summary: 'Workspace duplicated from My Drive', itemCount: 1, actionId: null, undoable: false });
  });

  test('bad cursor and bad limit are 400', async () => {
    const k = await kitFor('tl4@test.local');
    expect((await k.client.get(`/api/w/${k.ws}/timeline?limit=0`)).status).toBe(400);
    expect((await k.client.get(`/api/w/${k.ws}/commits/..%2Fetc`)).status).toBe(400);
    const gone = await k.client.get(`/api/w/${k.ws}/commits/vc_01ARZ3NDEKTSV4RRFFQ69G5FAV`);
    expect(gone.status).toBe(410);
    expect(gone.body.error.code).toBe('version_gone');
  });

  test('fake clock 8 days ahead with > 50 commits: thinned entries merge, none point at an unreadable commit', async () => {
    let now = Date.parse('2026-09-01T10:00:00Z');
    const store = await freshWorld({ now: () => now });
    const k = await kitFor('tl5@test.local');
    // 60 actions, one minute apart
    for (let i = 0; i < 60; i++) {
      await upload(k, { [`/f${i}.txt`]: `v${i}` });
      now += 60_000;
    }
    now += 8 * 24 * 3600_000; // 8 days later
    await store.gc(k.vol);

    const r = await k.client.get(`/api/w/${k.ws}/timeline?limit=200`);
    expect(r.status).toBe(200);
    const entries = r.body.entries;
    // newest 50 commits survive; the 10 thinned uploads merge into the oldest surviving entry
    expect(entries).toHaveLength(50);
    const oldest = entries[entries.length - 1];
    expect(oldest.mergedCount).toBe(10);
    expect(oldest.itemCount).toBe(11);
    expect(oldest.paths.length).toBe(5);
    expect(entries.slice(0, -1).every((e: any) => e.mergedCount === 0)).toBe(true);
    for (const e of entries) {
      const l = await store.list(k.vol, '/', { at: e.commitId });
      expect(l.commitId).toBe(e.commitId);
    }
    // 48 h later the thinned commits are purged; the timeline is unchanged
    now += 49 * 3600_000;
    await store.gc(k.vol);
    const again = await k.client.get(`/api/w/${k.ws}/timeline?limit=200`);
    expect(again.body.entries.map((e: any) => e.commitId)).toEqual(entries.map((e: any) => e.commitId));
    for (const e of again.body.entries) await store.stat(k.vol, '/', { at: e.commitId });

    // Paging with a small limit keeps the merge on the right entry
    const p1 = await k.client.get(`/api/w/${k.ws}/timeline?limit=49`);
    const p2 = await k.client.get(`/api/w/${k.ws}/timeline?limit=49&before=${p1.body.nextCursor}`);
    expect(p1.body.entries.every((e: any) => e.mergedCount === 0)).toBe(true);
    expect(p2.body.entries).toHaveLength(1);
    expect(p2.body.entries[0].mergedCount).toBe(10);
  });
});

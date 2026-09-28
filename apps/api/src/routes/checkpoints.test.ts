import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { auditEvents } from '../db/schema';
import { getStore } from '../storage';
import { cleanWorld, freshWorld, kitFor, upload } from '../services/versioning-test-kit';

describe('checkpoints', () => {
  beforeEach(() => freshWorld());
  afterEach(cleanWorld);

  test('create (head and past), rename, edit note, delete; audited', async () => {
    const k = await kitFor('cp1@test.local');
    const v1 = await upload(k, { '/a.txt': 'a' });
    await upload(k, { '/b.txt': 'bb' });
    const base = `/api/w/${k.ws}/checkpoints`;

    const past = await k.client.post(base, { name: '  First draft ', note: 'before b', at: v1.action.headCommitId });
    expect(past.status).toBe(201);
    expect(past.body.checkpoint).toMatchObject({ name: 'First draft', note: 'before b', commitId: v1.action.headCommitId, auto: false, fileCount: 1, logicalBytes: 4096 });
    const now = await k.client.post(base, { name: 'Now' });
    expect(now.body.checkpoint.commitId).toBe((await getStore().getVolume(k.vol)).headCommitId);
    expect(now.body.checkpoint.fileCount).toBe(2);

    const tags = await getStore().listTags(k.vol);
    expect(tags.map((t) => t.name).sort()).toEqual([`cp-${now.body.checkpoint.id}`, `cp-${past.body.checkpoint.id}`].sort());

    const list = await k.client.get(base);
    expect(list.body.checkpoints.map((c: any) => c.name)).toEqual(['Now', 'First draft']);
    expect(list.body.budget).toEqual({ used: 2, max: 100, checkpoints: 2, pinnedLinks: 0 });

    const ren = await k.client.patch(`${base}/${past.body.checkpoint.id}`, { name: 'Draft 1' });
    expect(ren.status).toBe(200);
    expect(ren.body.checkpoint).toMatchObject({ name: 'Draft 1', note: 'before b' });
    const note = await k.client.patch(`${base}/${past.body.checkpoint.id}`, { note: '' });
    expect(note.body.checkpoint.note).toBe('');
    expect((await k.client.patch(`${base}/${past.body.checkpoint.id}`, {})).status).toBe(400);
    expect((await k.client.patch(`${base}/${past.body.checkpoint.id}`, { name: '' })).status).toBe(400);

    const del = await k.client.del(`${base}/${past.body.checkpoint.id}`);
    expect(del.status).toBe(204);
    expect((await getStore().listTags(k.vol)).map((t) => t.name)).toEqual([`cp-${now.body.checkpoint.id}`]);
    expect((await k.client.del(`${base}/${past.body.checkpoint.id}`)).status).toBe(404);

    const kinds = (await db.select().from(auditEvents).where(eq(auditEvents.workspaceId, k.ws))).map((e) => e.kind).sort();
    expect(kinds).toEqual(['checkpoint.create', 'checkpoint.create', 'checkpoint.delete', 'checkpoint.update', 'checkpoint.update'].sort());
  });

  test('the 101st tag returns 409 tag_budget_exceeded (shared with pinned links)', async () => {
    const k = await kitFor('cp2@test.local');
    await upload(k, { '/a.txt': 'a' });
    for (let i = 0; i < 97; i++) await getStore().putTag(k.vol, `ln-x${i}`, 'head');
    const base = `/api/w/${k.ws}/checkpoints`;
    for (let i = 0; i < 3; i++) expect((await k.client.post(base, { name: `cp ${i}` })).status).toBe(201);
    const list = await k.client.get(base);
    expect(list.body.budget).toEqual({ used: 100, max: 100, checkpoints: 3, pinnedLinks: 97 });
    const over = await k.client.post(base, { name: 'one too many' });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('tag_budget_exceeded');
    expect((await k.client.get(base)).body.checkpoints).toHaveLength(3);
  });

  test('scoping and validation', async () => {
    const k = await kitFor('cp3@test.local');
    const other = await kitFor('cp3-other@test.local');
    await upload(k, { '/a.txt': 'a' });
    const mine = await k.client.post(`/api/w/${k.ws}/checkpoints`, { name: 'mine' });
    // another user's workspace id → 404; another workspace's checkpoint id → 404
    expect((await other.client.get(`/api/w/${k.ws}/checkpoints`)).status).toBe(404);
    expect((await other.client.del(`/api/w/${other.ws}/checkpoints/${mine.body.checkpoint.id}`)).status).toBe(404);
    expect((await k.client.post(`/api/w/${k.ws}/checkpoints`, { name: '' })).status).toBe(400);
    expect((await k.client.post(`/api/w/${k.ws}/checkpoints`, { name: 'x'.repeat(81) })).status).toBe(400);
    expect((await k.client.post(`/api/w/${k.ws}/checkpoints`, { name: 'bad', at: '../x' })).status).toBe(400);
    const gone = await k.client.post(`/api/w/${k.ws}/checkpoints`, { name: 'gone', at: 'vc_01ARZ3NDEKTSV4RRFFQ69G5FAV' });
    expect(gone.status).toBe(410);
    expect((await getStore().listTags(k.vol)).length).toBe(1);
  });
});

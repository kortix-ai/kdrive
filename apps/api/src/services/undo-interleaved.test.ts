// Undo of an action whose commits are interleaved with other writers' commits
// (a multi-plan upload), and of actions followed by a commit whose response was
// lost. An undo must never silently throw away another action's write.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { actions, uploads } from '../db/schema';
import { getStore, setStoreForTests } from '../storage';
import type { EmulatedStore } from '../storage/emulated';
import { VolumeStoreError } from '../storage/types';
import { uploadFile } from '../../test/helpers';
import { statOrNull } from './tree';
import { cleanWorld, freshWorld, kitFor, readText, type Kit } from './versioning-test-kit';

const T = 1_700_000_000_000;

describe('undo of a multi-plan upload with other writes between its plans', () => {
  beforeEach(() => freshWorld());
  afterEach(cleanWorld);

  test('a newer write to one of its paths landing between its plans is not undone (409)', async () => {
    const k = await kitFor('mp1@test.local');
    const p1 = await uploadFile(k.client, k.ws, '/u/a.txt', 'AAAA', { mtime: T });
    const U = p1.commit.action.id as string;
    await uploadFile(k.client, k.ws, '/u/a.txt', 'XXXX-newer', { mtime: T });
    await uploadFile(k.client, k.ws, '/u/b.txt', 'BBBB', { mtime: T, actionId: U });
    const u = await k.client.post(`/api/w/${k.ws}/actions/${U}/undo`, {});
    expect(u.status).toBe(409);
    expect(u.body.error.details.paths).toEqual(['/u/a.txt']);
    expect(await readText(k, '/u/a.txt')).toBe('XXXX-newer');
    expect(await readText(k, '/u/b.txt')).toBe('BBBB');
  });

  test('still refused when an unrelated later action also exists', async () => {
    const k = await kitFor('mp2@test.local');
    const p1 = await uploadFile(k.client, k.ws, '/u/a.txt', 'AAAA', { mtime: T });
    const U = p1.commit.action.id as string;
    await uploadFile(k.client, k.ws, '/u/a.txt', 'XXXX-newer', { mtime: T });
    await uploadFile(k.client, k.ws, '/u/b.txt', 'BBBB', { mtime: T, actionId: U });
    await uploadFile(k.client, k.ws, '/elsewhere.txt', 'e', { mtime: T });
    const u = await k.client.post(`/api/w/${k.ws}/actions/${U}/undo`, {});
    expect(u.status).toBe(409);
    expect(u.body.error.details.paths).toEqual(['/u/a.txt']);
    expect(await readText(k, '/u/a.txt')).toBe('XXXX-newer');
  });

  test('a folder upload whose second plan came after another action added a file inside it is refused', async () => {
    const k = await kitFor('mp3@test.local');
    const plan = await k.client.post(`/api/w/${k.ws}/uploads`, { files: [], dirs: ['/proj'], conflict: 'replace' });
    expect(plan.status).toBe(200);
    const c = await k.client.post(`/api/w/${k.ws}/uploads/${plan.body.uploadId}/commit`, {});
    expect(c.status).toBe(200);
    const U = c.body.action.id as string;
    await uploadFile(k.client, k.ws, '/proj/theirs.txt', 'someone else newer work', { mtime: T });
    await uploadFile(k.client, k.ws, '/proj/mine.txt', 'mine', { mtime: T, actionId: U });
    const u = await k.client.post(`/api/w/${k.ws}/actions/${U}/undo`, {});
    expect(u.status).toBe(409);
    expect(u.body.error.details.paths).toEqual(['/proj/theirs.txt']);
    expect(await statOrNull(k.ctx.ws, '/proj/theirs.txt')).not.toBeNull();
    expect(await readText(k, '/proj/mine.txt')).toBe('mine');
  });

  test('other writes between its plans that touch none of its paths do not block the undo', async () => {
    const k = await kitFor('mp4@test.local');
    await uploadFile(k.client, k.ws, '/u/a.txt', 'old a', { mtime: T });
    const p1 = await uploadFile(k.client, k.ws, '/u/a.txt', 'AAAA', { mtime: T });
    const U = p1.commit.action.id as string;
    await uploadFile(k.client, k.ws, '/elsewhere.txt', 'e', { mtime: T });
    await uploadFile(k.client, k.ws, '/u/b.txt', 'BBBB', { mtime: T, actionId: U });
    await uploadFile(k.client, k.ws, '/later.txt', 'l', { mtime: T });
    const u = await k.client.post(`/api/w/${k.ws}/actions/${U}/undo`, {});
    expect(u.status).toBe(200);
    expect(await readText(k, '/u/a.txt')).toBe('old a');
    expect(await statOrNull(k.ctx.ws, '/u/b.txt')).toBeNull();
    expect(await readText(k, '/elsewhere.txt')).toBe('e');
    expect(await readText(k, '/later.txt')).toBe('l');
  });
});

/** Plans /a.txt := `text` and sends its blocks; returns the upload id. */
async function planAndSend(k: Kit, text: string): Promise<string> {
  return (await planAndSendFull(k, text)).uploadId;
}

async function planAndSendFull(k: Kit, text: string): Promise<{ uploadId: string; actionId: string }> {
  const body = new TextEncoder().encode(text);
  const sha = new Bun.CryptoHasher('sha256').update(body).digest('hex');
  const plan = await k.client.post(`/api/w/${k.ws}/uploads`, {
    files: [{ path: '/a.txt', size: body.length, blocks: [sha], mtime: T }],
    dirs: [],
    conflict: 'replace',
  });
  expect(plan.status).toBe(200);
  for (const s of plan.body.missing) {
    const put = await k.client.raw('PUT', `/api/w/${k.ws}/uploads/${plan.body.uploadId}/blocks/${s}`, {
      body: body as unknown as BodyInit,
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(put.status).toBe(204);
  }
  return { uploadId: plan.body.uploadId, actionId: plan.body.actionId };
}

/** Commits with the store answering 503 after the commit landed, and the head unreadable right after. */
async function commitWithLostResponse(k: Kit, store: EmulatedStore, uploadId: string) {
  store.injectFault('commitUpload', { error: new VolumeStoreError(503, 'unavailable', 'lost'), afterApply: true });
  return withHeadUnreadableAfter(store, 'commitUpload', () => k.client.post(`/api/w/${k.ws}/uploads/${uploadId}/commit`, {}));
}

/** Runs `fn` with the head unreadable once, right after the store's `op` is called. */
async function withHeadUnreadableAfter<T>(store: EmulatedStore, op: 'commitUpload' | 'move' | 'remove', fn: () => Promise<T>): Promise<T> {
  let failHead = false;
  const proxy = new Proxy(store, {
    get(t, prop, receiver) {
      if (prop === op) {
        return async (...a: unknown[]) => {
          failHead = true;
          return (t[op] as (...x: unknown[]) => unknown).apply(t, a);
        };
      }
      if (prop === 'getVolume') {
        return async (...a: unknown[]) => {
          if (failHead) {
            failHead = false;
            throw new VolumeStoreError(503, 'unavailable', 'head unreadable');
          }
          return (t.getVolume as (...x: unknown[]) => unknown).apply(t, a);
        };
      }
      const v = Reflect.get(t, prop, receiver);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  setStoreForTests(proxy as unknown as EmulatedStore);
  try {
    return await fn();
  } finally {
    setStoreForTests(store);
  }
}

describe('a commit whose response was lost', () => {
  let store: EmulatedStore;
  beforeEach(async () => {
    store = await freshWorld();
  });
  afterEach(cleanWorld);

  test('an undo of an earlier action never overwrites it', async () => {
    const k = await kitFor('lost1@test.local');
    await uploadFile(k.client, k.ws, '/a.txt', 'AAAA', { mtime: T });
    const target = await uploadFile(k.client, k.ws, '/a.txt', 'BBBB', { mtime: T });
    const id = await planAndSend(k, 'newer-CCCCC!');
    const c = await commitWithLostResponse(k, store, id);
    expect(c.status).toBe(503);
    expect(await readText(k, '/a.txt')).toBe('newer-CCCCC!'); // it landed
    const u = await k.client.post(`/api/w/${k.ws}/actions/${target.commit.action.id}/undo`, {});
    expect(u.status).toBe(409);
    expect(u.body.error.details.paths).toEqual(['/a.txt']);
    expect(await readText(k, '/a.txt')).toBe('newer-CCCCC!');
  });

  test('the ledger records it once the store confirms it, so the timeline and its own undo are right', async () => {
    const k = await kitFor('lost2@test.local');
    await uploadFile(k.client, k.ws, '/a.txt', 'AAAA', { mtime: T });
    const id = await planAndSend(k, 'newer-CCCCC!');
    const c = await commitWithLostResponse(k, store, id);
    expect(c.status).toBe(503);
    const head = (await getStore().getVolume(k.vol)).headCommitId;
    const [up] = await db.select().from(uploads).where(eq(uploads.id, id));

    // The timeline (any later look at the ledger) records the landed commit.
    const tl = await k.client.get(`/api/w/${k.ws}/timeline`);
    expect(tl.status).toBe(200);
    const [a] = await db.select().from(actions).where(eq(actions.id, up.actionId!));
    expect(a.status).toBe('committed');
    expect(a.commitIds).toEqual([head]);
    expect(a.headCommitId).toBe(head);
    expect(tl.body.entries[0]).toMatchObject({ commitId: head });
    const [after] = await db.select().from(uploads).where(eq(uploads.id, id));
    expect(after.status).toBe('committed');

    // A retried commit answers the recorded result.
    const again = await k.client.post(`/api/w/${k.ws}/uploads/${id}/commit`, {});
    expect(again.status).toBe(200);
    expect(again.body.action).toMatchObject({ id: a.id, status: 'committed', headCommitId: head });

    // And it undoes like any upload.
    const u = await k.client.post(`/api/w/${k.ws}/actions/${a.id}/undo`, {});
    expect(u.status).toBe(200);
    expect(await readText(k, '/a.txt')).toBe('AAAA');
  });

  test('an undo right after it (no timeline load) also records it first', async () => {
    const k = await kitFor('lost3@test.local');
    await uploadFile(k.client, k.ws, '/a.txt', 'AAAA', { mtime: T });
    const id = await planAndSend(k, 'newer-CCCCC!');
    expect((await commitWithLostResponse(k, store, id)).status).toBe(503);
    const [up] = await db.select().from(uploads).where(eq(uploads.id, id));
    const u = await k.client.post(`/api/w/${k.ws}/actions/${up.actionId}/undo`, {});
    expect(u.status).toBe(200);
    expect(await readText(k, '/a.txt')).toBe('AAAA');
  });

  test('a commit that did not land is not recorded', async () => {
    const k = await kitFor('lost4@test.local');
    await uploadFile(k.client, k.ws, '/a.txt', 'AAAA', { mtime: T });
    const id = await planAndSend(k, 'newer-CCCCC!');
    store.injectFault('commitUpload', { error: new VolumeStoreError(503, 'unavailable', 'down') });
    const c = await k.client.post(`/api/w/${k.ws}/uploads/${id}/commit`, {});
    expect(c.status).toBe(503);
    // Another action lands meanwhile: its commit is not this upload's.
    await uploadFile(k.client, k.ws, '/b.txt', 'b', { mtime: T });
    await k.client.get(`/api/w/${k.ws}/timeline`);
    const [up] = await db.select().from(uploads).where(eq(uploads.id, id));
    expect(up.status).toBe('uploading');
    const [a] = await db.select().from(actions).where(eq(actions.id, up.actionId!));
    expect(a.status).toBe('pending');
    expect(a.commitIds).toEqual([]);
    // The retry commits it normally.
    const again = await k.client.post(`/api/w/${k.ws}/uploads/${id}/commit`, {});
    expect(again.status).toBe(200);
    expect(await readText(k, '/a.txt')).toBe('newer-CCCCC!');
  });
});

describe('a lost commit is recorded only for the action whose changes it holds', () => {
  let store: EmulatedStore;
  beforeEach(async () => {
    store = await freshWorld();
  });
  afterEach(cleanWorld);

  /** U1 plans /a.txt := MINE and its commit never lands; U2 plans /a.txt := THRS (same size) and its commit lands with the response lost. */
  async function twoUploads(k: Kit) {
    await uploadFile(k.client, k.ws, '/a.txt', 'base', { mtime: T });
    const u1 = await planAndSendFull(k, 'MINE');
    store.injectFault('commitUpload', { error: new VolumeStoreError(503, 'unavailable', 'down') });
    expect((await k.client.post(`/api/w/${k.ws}/uploads/${u1.uploadId}/commit`, {})).status).toBe(503);
    const u2 = await planAndSendFull(k, 'THRS');
    expect((await commitWithLostResponse(k, store, u2.uploadId)).status).toBe(503);
    expect(await readText(k, '/a.txt')).toBe('THRS');
    return { u1, u2, landed: (await getStore().getVolume(k.vol)).headCommitId };
  }

  test('an older upload of the same size never takes a newer upload’s landed commit', async () => {
    const k = await kitFor('lostw1@test.local');
    const { u1, u2, landed } = await twoUploads(k);
    expect((await k.client.get(`/api/w/${k.ws}/timeline`)).status).toBe(200);
    const [a1] = await db.select().from(actions).where(eq(actions.id, u1.actionId));
    const [a2] = await db.select().from(actions).where(eq(actions.id, u2.actionId));
    expect(a1.commitIds).toEqual([]);
    expect(a1.status).toBe('pending');
    expect(a2.commitIds).toEqual([landed]);
    expect(a2.status).toBe('committed');
    const [r1] = await db.select().from(uploads).where(eq(uploads.id, u1.uploadId));
    expect(r1.status).toBe('uploading');
    // Undoing U1 cannot throw away U2's bytes.
    const u = await k.client.post(`/api/w/${k.ws}/actions/${u1.actionId}/undo`, {});
    expect(u.status).not.toBe(200);
    expect(await readText(k, '/a.txt')).toBe('THRS');
  });

  test('a retried commit of the older upload lands its own bytes instead of claiming the other commit', async () => {
    const k = await kitFor('lostw2@test.local');
    const { u1, landed } = await twoUploads(k);
    const again = await k.client.post(`/api/w/${k.ws}/uploads/${u1.uploadId}/commit`, {});
    expect(again.status).toBe(200);
    expect(again.body.action.headCommitId).not.toBe(landed);
    expect(await readText(k, '/a.txt')).toBe('MINE');
    // Undoing it would revert the other upload's write in between: refused.
    const u = await k.client.post(`/api/w/${k.ws}/actions/${u1.actionId}/undo`, {});
    expect(u.status).toBe(409);
    expect(await readText(k, '/a.txt')).toBe('MINE');
  });

  test('a landed commit that two open uploads match equally is given to neither', async () => {
    const k = await kitFor('lostw4@test.local');
    await uploadFile(k.client, k.ws, '/a.txt', 'base', { mtime: T });
    const u1 = await planAndSendFull(k, 'SAME');
    store.injectFault('commitUpload', { error: new VolumeStoreError(503, 'unavailable', 'down') });
    expect((await k.client.post(`/api/w/${k.ws}/uploads/${u1.uploadId}/commit`, {})).status).toBe(503);
    const u2 = await planAndSendFull(k, 'SAME');
    expect((await commitWithLostResponse(k, store, u2.uploadId)).status).toBe(503);
    expect(await readText(k, '/a.txt')).toBe('SAME');

    expect((await k.client.get(`/api/w/${k.ws}/timeline`)).status).toBe(200);
    const [a1] = await db.select().from(actions).where(eq(actions.id, u1.actionId));
    const [a2] = await db.select().from(actions).where(eq(actions.id, u2.actionId));
    expect(a1.commitIds).toEqual([]);
    expect(a2.commitIds).toEqual([]);
    // The unclaimed commit counts as another writer's: undoing the base upload is refused.
    const [base] = await db.select().from(actions).where(eq(actions.status, 'committed'));
    expect((await k.client.post(`/api/w/${k.ws}/actions/${base.id}/undo`, {})).status).toBe(409);
    expect(await readText(k, '/a.txt')).toBe('SAME');
  });

  test('a pending delete that never landed does not take a later move’s commit', async () => {
    const k = await kitFor('lostw3@test.local');
    await uploadFile(k.client, k.ws, '/a.txt', 'AAAA', { mtime: T });
    await uploadFile(k.client, k.ws, '/src.txt', 'SRC-precious', { mtime: T });
    store.injectFault('remove', { error: new VolumeStoreError(503, 'unavailable', 'down') });
    const del = await withHeadUnreadableAfter(store, 'remove', () => k.client.post(`/api/w/${k.ws}/files/delete`, { paths: ['/a.txt'] }));
    expect(del.status).toBe(503);
    expect(await readText(k, '/a.txt')).toBe('AAAA');
    store.injectFault('move', { error: new VolumeStoreError(503, 'unavailable', 'lost'), afterApply: true });
    const mv = await withHeadUnreadableAfter(store, 'move', () =>
      k.client.post(`/api/w/${k.ws}/files/move`, { items: [{ from: '/src.txt', to: '/a.txt' }], overwrite: true }),
    );
    expect(mv.status).toBe(503);
    expect(await readText(k, '/a.txt')).toBe('SRC-precious');
    const moveHead = (await getStore().getVolume(k.vol)).headCommitId;
    const pending = await db.select().from(actions).where(eq(actions.status, 'pending'));
    expect(pending.map((a) => a.kind).sort()).toEqual(['delete', 'rename']);
    await db.update(actions).set({ createdAt: new Date(Date.now() - 10 * 60_000) }).where(eq(actions.status, 'pending'));

    expect((await k.client.get(`/api/w/${k.ws}/timeline`)).status).toBe(200);
    const after = await db.select().from(actions).where(eq(actions.workspaceId, pending[0].workspaceId));
    const delA = after.find((a) => a.kind === 'delete')!;
    const mvA = after.find((a) => a.kind === 'rename')!;
    expect(delA.status).toBe('failed');
    expect(delA.commitIds).toEqual([]);
    expect(mvA.status).toBe('committed');
    expect(mvA.commitIds).toEqual([moveHead]);
    expect((await k.client.post(`/api/w/${k.ws}/actions/${delA.id}/undo`, {})).status).not.toBe(200);
    expect(await readText(k, '/a.txt')).toBe('SRC-precious');
  });
});

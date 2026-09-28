// End to end: the review fixes for versioning integrity, share links, quotas,
// upload commits and storage failures. Each test is the reported scenario.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { actions, userSettings } from '../../src/db/schema';
import { finalize, recordIntent, attachCommit } from '../../src/services/ledger';
import { toCtx } from '../../src/services/workspaces';
import { workspaces } from '../../src/db/schema';
import { VolumeStoreError } from '../../src/storage/types';
import type { EmulatedStore } from '../../src/storage/emulated';
import { blocksOf, enc, type Json } from '../helpers';
import { endWorld, freshWorld, head, ls, q, text, timeline, upload, user, type User } from './kit';

let store: EmulatedStore;
beforeEach(async () => {
  store = await freshWorld({ slotWaitMs: 200 });
});
afterEach(endWorld);
afterAll(endWorld);

const api = (u: User, p: string) => `/api/w/${u.ws}${p}`;
const pub = (token: string, p = '') => `/api/public/s/${token}${p}`;

/** Plan + send every missing block, but do not commit. */
async function planAndSend(u: User, files: Record<string, string>, conflict: 'ask' | 'replace' | 'keep-both' = 'replace') {
  const list = Object.entries(files).map(([path, v]) => ({ path, bytes: enc(v), blocks: blocksOf(enc(v)) }));
  const plan = await u.client.post(api(u, '/uploads'), {
    files: list.map((f) => ({ path: f.path, size: f.bytes.length, blocks: f.blocks.map((b) => b.sha) })),
    dirs: [],
    conflict,
  });
  if (plan.status !== 200) throw new Error(`plan ${plan.status}: ${plan.text}`);
  const missing = new Set<string>(plan.body.missing);
  for (const f of list) {
    for (const b of f.blocks) {
      if (!missing.delete(b.sha)) continue;
      const r = await u.client.raw('PUT', api(u, `/uploads/${plan.body.uploadId}/blocks/${b.sha}`), {
        body: b.bytes as unknown as BodyInit,
        headers: { 'content-type': 'application/octet-stream' },
      });
      if (r.status !== 204) throw new Error(`block ${r.status}`);
    }
  }
  return plan.body as Json;
}

const commit = (u: User, uploadId: string) => u.client.post(api(u, `/uploads/${uploadId}/commit`), {});
const setQuota = (u: User, bytes: number) => db.update(userSettings).set({ quotaBytes: bytes }).where(eq(userSettings.userId, u.userId));

async function restoreFile(u: User, path: string, at: string) {
  const r = await u.client.post(api(u, '/restore'), { scope: 'file', path, at });
  expect(r.status).toBe(200);
  return r.body;
}

describe('restore never writes the wrong bytes', () => {
  test('a same-size block list from another version is not trusted (drive restore, move, replace)', async () => {
    const a = await user('lkb-a@test.local');
    const first = await upload(a, { '/a.txt': 'AAAA' });
    await upload(a, { '/a.txt': 'BBBB' });
    expect((await a.client.post(api(a, '/restore'), { scope: 'drive', at: first.commit.action.headCommitId })).status).toBe(200);
    expect(await text(a, '/a.txt')).toBe('AAAA');
    const mv = await a.client.post(api(a, '/files/move'), { items: [{ from: '/a.txt', to: '/c.txt' }] });
    const moveCommit = mv.body.action.headCommitId as string;
    expect(await text(a, '/c.txt', moveCommit)).toBe('AAAA');
    await upload(a, { '/c.txt': 'CCCC' });
    await restoreFile(a, '/c.txt', moveCommit);
    expect(await text(a, '/c.txt')).toBe('AAAA');
  });

  test('a file inside a copied folder restores to the copied bytes, not an older same-size file', async () => {
    const a = await user('lkb-b@test.local');
    await upload(a, { '/dst/x.txt': 'OLD1' });
    await a.client.post(api(a, '/files/delete'), { paths: ['/dst'] });
    await upload(a, { '/src/x.txt': 'NEW1' });
    const cp = await a.client.post(api(a, '/files/copy'), { items: [{ from: '/src', to: '/dst' }] });
    const copyCommit = cp.body.action.headCommitId as string;
    await upload(a, { '/dst/x.txt': 'LATE' });
    await restoreFile(a, '/dst/x.txt', copyCommit);
    expect(await text(a, '/dst/x.txt')).toBe('NEW1');
    const folder = await a.client.post(api(a, '/restore'), { scope: 'folder', path: '/dst', at: copyCommit });
    expect(folder.status).toBe(200);
    expect(await text(a, '/dst/x.txt')).toBe('NEW1');
  });

  test('a move racing an upload commit records the bytes it actually moved', async () => {
    const a = await user('race@test.local');
    for (let i = 0; i < 4; i++) {
      await upload(a, { [`/a${i}.txt`]: `AAAA${i}` });
      const plan = await planAndSend(a, { [`/a${i}.txt`]: `BBBB${i}` });
      const [c, mv] = await Promise.all([
        commit(a, plan.uploadId),
        a.client.post(api(a, '/files/move'), { items: [{ from: `/a${i}.txt`, to: `/m${i}.txt` }] }),
      ]);
      expect(c.status).toBe(200);
      expect(mv.status).toBe(200);
      const at = mv.body.action.headCommitId as string;
      const then = await text(a, `/m${i}.txt`, at);
      await upload(a, { [`/m${i}.txt`]: `CCCC${i}` });
      await restoreFile(a, `/m${i}.txt`, at);
      expect(await text(a, `/m${i}.txt`)).toBe(then);
    }
  });
});

describe('undo', () => {
  test('undoing a copy puts back only the copy, never its source', async () => {
    const a = await user('undo-copy@test.local');
    await upload(a, { '/src/a.txt': 'v1' });
    const cp = await a.client.post(api(a, '/files/copy'), { items: [{ from: '/src/a.txt', to: '/b.txt' }] });
    await upload(a, { '/src/a.txt': 'v2-edited' });
    expect((await a.client.post(api(a, `/actions/${cp.body.action.id}/undo`), {})).status).toBe(200);
    expect(await ls(a)).toEqual(['src/']);
    expect(await text(a, '/src/a.txt')).toBe('v2-edited');

    const cp2 = await a.client.post(api(a, '/files/copy'), { items: [{ from: '/src', to: '/dst' }] });
    await upload(a, { '/src/later.txt': 'keep me' });
    expect((await a.client.post(api(a, `/actions/${cp2.body.action.id}/undo`), {})).status).toBe(200);
    expect(await ls(a, '/src')).toEqual(['a.txt', 'later.txt']);
    expect(await ls(a)).toEqual(['src/']);
  });

  test('undo refuses when later changes to the same items would be lost', async () => {
    const a = await user('undo-later@test.local');
    const mk = await a.client.post(api(a, '/folders'), { path: '/box' });
    await upload(a, { '/box/important.txt': 'data' });
    const r = await a.client.post(api(a, `/actions/${mk.body.action.id}/undo`), {});
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('Later changes would be lost');
    expect(await ls(a, '/box')).toEqual(['important.txt']);

    // Unrelated later work does not block an undo.
    const mk2 = await a.client.post(api(a, '/folders'), { path: '/empty' });
    await upload(a, { '/elsewhere.txt': 'x' });
    expect((await a.client.post(api(a, `/actions/${mk2.body.action.id}/undo`), {})).status).toBe(200);
    // Undoing twice is refused.
    const again = await a.client.post(api(a, `/actions/${mk2.body.action.id}/undo`), {});
    expect(again.status).toBe(409);
    expect(again.body.error.message).toContain('already undone');
  });
});

describe('quota', () => {
  test('a restore is checked in logical bytes, like an upload', async () => {
    const a = await user('rq@test.local');
    const files: Record<string, string> = {};
    for (let i = 0; i < 20; i++) files[`/f/${i}.txt`] = 'x';
    await upload(a, files);
    const del = await a.client.post(api(a, '/files/delete'), { paths: ['/f'] });
    await upload(a, { '/big.bin': 'y'.repeat(20 * 1024) });
    // 20 files x 4 KiB + the folder = 86,016 logical bytes on top of 20 KiB.
    await setQuota(a, 100 * 1024);
    const undo = await a.client.post(api(a, `/actions/${del.body.action.id}/undo`), {});
    expect(undo.status).toBe(413);
    expect(undo.body.error.code).toBe('quota_exceeded');
    expect(await ls(a)).toEqual(['big.bin']);
  });

  test('uploads in flight reserve their bytes: two plans cannot both squeeze under the quota', async () => {
    const a = await user('rsv@test.local');
    await setQuota(a, 64 * 1024);
    const body = 'z'.repeat(40 * 1024);
    const blocks = blocksOf(enc(body));
    const mk = (path: string) =>
      a.client.post(api(a, '/uploads'), { files: [{ path, size: body.length, blocks: blocks.map((b) => b.sha) }], dirs: [], conflict: 'replace' });
    const [p1, p2] = await Promise.all([mk('/one.bin'), mk('/two.bin')]);
    expect([p1.status, p2.status].sort()).toEqual([200, 413]);
    const okPlan = p1.status === 200 ? p1 : p2;
    // Aborting frees the reservation.
    await a.client.del(api(a, `/uploads/${okPlan.body.uploadId}`));
    expect((await mk('/three.bin')).status).toBe(200);
  });
});

describe('upload commit', () => {
  test('a file created between plan and commit is a conflict, not silently replaced', async () => {
    const a = await user('ucx@test.local');
    await upload(a, { '/x.txt': 'copied content' });
    const plan = await planAndSend(a, { '/n.txt': 'uploaded' }, 'ask');
    await a.client.post(api(a, '/files/copy'), { items: [{ from: '/x.txt', to: '/n.txt' }] });
    const r = await commit(a, plan.uploadId);
    expect(r.status).toBe(409);
    expect(r.body.error.details.conflicts).toEqual(['/n.txt']);
    expect(await text(a, '/n.txt')).toBe('copied content');
    // The plan is still alive: the browser decides, e.g. aborts and re-plans with keep-both.
    expect((await a.client.del(api(a, `/uploads/${plan.uploadId}`))).status).toBe(204);
  });

  test('a head that moved since the plan still commits as ONE fast version with its own base', async () => {
    const a = await user('ucm@test.local');
    await upload(a, { '/keep.txt': 'k' });
    const plan = await planAndSend(a, { '/new.txt': 'fresh' }, 'ask');
    const ren = await a.client.post(api(a, '/files/move'), { items: [{ from: '/keep.txt', to: '/kept.txt' }] });
    const r = await commit(a, plan.uploadId);
    expect(r.status).toBe(200);
    const [row] = await db.select().from(actions).where(eq(actions.id, r.body.action.id));
    expect(row.commitIds).toHaveLength(1);
    expect(row.baseCommitId).toBe(ren.body.action.headCommitId);
    expect(row.headCommitId).toBe(await head(a));
    // Undoing the upload removes only what it added.
    expect((await a.client.post(api(a, `/actions/${row.id}/undo`), {})).status).toBe(200);
    expect(await ls(a)).toEqual(['kept.txt']);
  });

  test('retryable commit failures keep the upload alive; the retry commits', async () => {
    const a = await user('ucr@test.local');
    const plan = await planAndSend(a, { '/r.txt': 'retry me' });
    store.injectFault('commitUpload', { error: new VolumeStoreError(429, 'rate_limited', 'slow down', { retryAfterSeconds: 1 }) });
    const first = await commit(a, plan.uploadId);
    expect(first.status).toBe(429);
    const second = await commit(a, plan.uploadId);
    expect(second.status).toBe(200);
    expect(await text(a, '/r.txt')).toBe('retry me');
  });

  test('a commit whose response was lost is recognised on the retry', async () => {
    const a = await user('ucl@test.local');
    const plan = await planAndSend(a, { '/l.txt': 'landed' });
    store.injectFault('commitUpload', { error: new VolumeStoreError(503, 'unavailable', 'timeout'), afterApply: true });
    const r = await commit(a, plan.uploadId);
    expect(r.status).toBe(200);
    expect(r.body.action.status).toBe('committed');
    expect((await timeline(a))[0]).toMatchObject({ kind: 'upload', undoable: true });
  });

  test('an aborted plan keeps its upload slot until it expires (Platinum has no abort)', async () => {
    const a = await user('slots@test.local');
    for (let i = 0; i < 4; i++) {
      const p = await planAndSend(a, { [`/s${i}.txt`]: `s${i}` });
      expect((await a.client.del(api(a, `/uploads/${p.uploadId}`))).status).toBe(204);
    }
    const blocks = blocksOf(enc('five'));
    const fifth = await a.client.post(api(a, '/uploads'), {
      files: [{ path: '/s4.txt', size: 4, blocks: blocks.map((b) => b.sha) }],
      dirs: [],
      conflict: 'replace',
    });
    expect(fifth.status).toBe(429);
  });
});

describe('storage failures', () => {
  test('a mutation that timed out after landing is recorded as done, not failed', async () => {
    const a = await user('sf@test.local');
    await upload(a, { '/f.txt': 'f' });
    store.injectFault('move', { error: new VolumeStoreError(503, 'unavailable', 'timeout'), afterApply: true });
    const r = await a.client.post(api(a, '/files/move'), { items: [{ from: '/f.txt', to: '/g.txt' }] });
    expect(r.status).toBe(503);
    const t = await timeline(a);
    expect(t[0]).toMatchObject({ kind: 'rename', undoable: true, summary: 'Renamed f.txt to g.txt' });
    expect(t.some((e) => e.kind === 'external')).toBe(false);
  });

  test('a finished action is never downgraded by a late reconcile or failure', async () => {
    const a = await user('cas@test.local');
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, a.ws));
    const ctx = { ws: toCtx(row as typeof row & { volumeId: string }), userId: a.userId };
    const intent = await recordIntent(ctx, { kind: 'upload', summary: 'x', paths: [] });
    const h = await head(a);
    await attachCommit(intent.actionId, { commitId: h, headCommitId: h, outcome: 'fast', overwritten: [], skipped: [] });
    expect((await finalize(intent.actionId, 'committed')).status).toBe('committed');
    expect((await finalize(intent.actionId, 'failed', 'late')).status).toBe('committed');
    // `queued` never claims the old head for this action.
    const other = await recordIntent(ctx, { kind: 'upload', summary: 'y', paths: [] });
    await attachCommit(other.actionId, { commitId: 'vc_side', headCommitId: h, outcome: 'queued', overwritten: [], skipped: [] });
    const [o] = await db.select().from(actions).where(eq(actions.id, other.actionId));
    expect(o.commitIds).toEqual([]);
  });

  test('the emulator commits a plan made on an older head as a side commit plus a merge', async () => {
    const a = await user('merge@test.local');
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, a.ws));
    const vol = row.volumeId!;
    const b = blocksOf(enc('side'));
    const plan = await store.planUpload(vol, { files: [{ path: '/side.txt', size: 4, blocks: b.map((x) => x.sha) }], dirs: [], overwrite: false });
    await store.putBlock(vol, plan.uploadId, b[0].sha, b[0].bytes);
    await store.write(vol, '/other.txt', enc('moved the head'));
    const r = await store.commitUpload(vol, plan.uploadId);
    expect(r.outcome).toBe('merged');
    expect(r.commitId).not.toBe(r.headCommitId);
    expect((await store.getCommit(vol, r.headCommitId)).kind).toBe('merge');
    const hist = await store.history(vol);
    expect(hist.commits.some((c) => c.id === r.commitId)).toBe(false);
    expect((await store.stat(vol, '/side.txt')).version).toBe(r.commitId.slice(3));
  });

  test('stored bytes are budgeted like Platinum: uncommitted plans keep counting', async () => {
    store = await freshWorld({ maxBytesPerVolume: 3 * 1024 * 1024, slotWaitMs: 50 });
    const a = await user('stored@test.local');
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, a.ws));
    const vol = row.volumeId!;
    const big = (n: number) => Array.from({ length: 3 }, (_, i) => String(n * 10 + i).padStart(64, '0'));
    for (let i = 0; i < 4; i++) {
      const p = await store.planUpload(vol, { files: [{ path: `/b${i}.bin`, size: 3 * 1024 * 1024, blocks: big(i) }], dirs: [], overwrite: true });
      store.releaseUpload(p.uploadId);
    }
    await expect(store.planUpload(vol, { files: [{ path: '/x', size: 1, blocks: ['f'.repeat(64)] }], dirs: [], overwrite: true })).rejects.toMatchObject({
      code: 'quota_exceeded',
      extra: { limit: 'stored_bytes' },
    });
    const r = await a.client.post(api(a, '/uploads'), { files: [{ path: '/x', size: 1, blocks: ['f'.repeat(64)] }], dirs: [], conflict: 'replace' });
    expect(r.status).toBe(413);
    expect(r.body.error.details.limit).toBe('stored_bytes');
    expect(r.body.error.message).toContain('History is full');
  });
});

describe('share links follow the item', () => {
  test('rename keeps the link on the item; whatever moves into the old path is not exposed', async () => {
    const a = await user('lnk@test.local');
    await upload(a, { '/Shared/s.txt': 'shared', '/Private/p.txt': 'private text' });
    const link = await a.client.post(api(a, '/links'), { path: '/Shared', mode: 'live' });
    const token = link.body.link.token as string;
    await a.client.post(api(a, '/files/move'), { items: [{ from: '/Shared', to: '/Shared-old' }] });
    await a.client.post(api(a, '/files/move'), { items: [{ from: '/Private', to: '/Shared' }] });
    const files = await a.client.get(pub(token, '/files'));
    expect(files.status).toBe(200);
    expect(files.body.entries.map((e: Json) => e.name)).toEqual(['s.txt']);
    expect((await a.client.raw('GET', pub(token, `/content?${q({ path: '/p.txt' })}`))).status).toBe(404);
    // The Share dialog of the renamed folder lists it; the new occupant's does not.
    expect((await a.client.get(api(a, `/links?${q({ path: '/Shared-old' })}`))).body.links).toHaveLength(1);
    expect((await a.client.get(api(a, `/links?${q({ path: '/Shared' })}`))).body.links).toHaveLength(0);
  });

  test('delete detaches the link; a new item at that path is never served; undo brings it back', async () => {
    const a = await user('lnk-del@test.local');
    await upload(a, { '/Doc.txt': 'the shared doc' });
    const link = await a.client.post(api(a, '/links'), { path: '/Doc.txt', mode: 'live' });
    const token = link.body.link.token as string;
    const del = await a.client.post(api(a, '/files/delete'), { paths: ['/Doc.txt'] });
    expect((await a.client.get(pub(token))).status).toBe(404);
    await upload(a, { '/Doc.txt': 'a brand new doc' });
    expect((await a.client.get(pub(token))).status).toBe(404);
    expect((await a.client.raw('GET', pub(token, '/content'))).status).toBe(404);
    expect((await a.client.get(api(a, `/links?${q({ path: '/Doc.txt' })}`))).body.links).toHaveLength(0);
    // Undoing the delete would throw the new doc away: refused.
    expect((await a.client.post(api(a, `/actions/${del.body.action.id}/undo`), {})).status).toBe(409);
  });

  test('undoing a delete re-attaches its links; undoing a move moves them back', async () => {
    const a = await user('lnk-undo@test.local');
    await upload(a, { '/f.txt': 'file' });
    const token = (await a.client.post(api(a, '/links'), { path: '/f.txt', mode: 'live' })).body.link.token as string;
    const del = await a.client.post(api(a, '/files/delete'), { paths: ['/f.txt'] });
    expect((await a.client.get(pub(token))).status).toBe(404);
    expect((await a.client.post(api(a, `/actions/${del.body.action.id}/undo`), {})).status).toBe(200);
    expect((await a.client.get(pub(token))).status).toBe(200);
    const mv = await a.client.post(api(a, '/files/move'), { items: [{ from: '/f.txt', to: '/g.txt' }] });
    expect((await a.client.get(pub(token))).body.name).toBe('g.txt');
    expect((await a.client.post(api(a, `/actions/${mv.body.action.id}/undo`), {})).status).toBe(200);
    const meta = await a.client.get(pub(token));
    expect(meta.status).toBe(200);
    expect(meta.body.name).toBe('f.txt');
  });

  test("a file link's /zip never zips a folder that took the file's path", async () => {
    const a = await user('lnk-zip@test.local');
    await upload(a, { '/Doc.txt': 'doc' });
    const token = (await a.client.post(api(a, '/links'), { path: '/Doc.txt', mode: 'live' })).body.link.token as string;
    const zipOfFile = await a.client.raw('GET', pub(token, '/zip'));
    expect(zipOfFile.status).toBe(200);
    expect(zipOfFile.headers.get('content-disposition')).toContain('attachment');
    expect(await zipOfFile.text()).toBe('doc');
    // Even with the link still attached (a pinned-at-head-style path race), a type change is gone.
    await db.execute(sql`UPDATE share_links SET path = '/Doc2' WHERE token = ${token}`);
    await upload(a, { '/Doc2/tax-return.txt': 'secret' });
    expect((await a.client.raw('GET', pub(token, '/zip'))).status).toBe(404);
    expect((await a.client.get(pub(token))).status).toBe(404);
  });
});

describe('recently deleted and batch restore', () => {
  test('restoring several deleted items is one action; an item whose name was reused stays listed', async () => {
    const a = await user('rd@test.local');
    await upload(a, { '/a.txt': 'a', '/b.txt': 'b', '/R/old': 'old' });
    const d1 = await a.client.post(api(a, '/files/delete'), { paths: ['/a.txt', '/b.txt'] });
    const at = d1.body.action.baseCommitId as string;
    const r = await a.client.post(api(a, '/restore'), { scope: 'file', paths: ['/a.txt', '/b.txt'], at });
    expect(r.status).toBe(200);
    expect(r.body.action.summary).toBe('Restored 2 items to an earlier version');
    expect(r.body.action.restoredTo).toBeTruthy();
    expect(await ls(a)).toEqual(['R/', 'a.txt', 'b.txt']);
    expect((await timeline(a))[0].kind).toBe('restore.file');

    await a.client.post(api(a, '/files/delete'), { paths: ['/R'] });
    await a.client.post(api(a, '/folders'), { path: '/R' });
    await upload(a, { '/R/newwork': 'new' });
    const items = (await a.client.get(api(a, '/deleted'))).body.items as Json[];
    const old = items.find((i) => i.path === '/R');
    expect(old).toMatchObject({ occupied: true, restorable: true });
  });
});

describe('drive compare', () => {
  test('a file deleted and restored with the same bytes is not "changed"', async () => {
    const a = await user('dc@test.local');
    const first = await upload(a, { '/Documents/old-draft.md': 'same bytes' });
    const del = await a.client.post(api(a, '/files/delete'), { paths: ['/Documents/old-draft.md'] });
    await a.client.post(api(a, `/actions/${del.body.action.id}/undo`), {});
    const r = await a.client.get(api(a, `/compare/drive?${q({ a: first.commit.action.headCommitId, b: 'head' })}`));
    expect(r.status).toBe(200);
    expect(r.body.changes).toEqual([]);
  });
});

describe('rate limits', () => {
  test('block PUTs do not spend the general per-user budget', async () => {
    const a = await user('blk@test.local');
    const bytes = enc('block budget');
    const b = blocksOf(bytes);
    const plan = await a.client.post(api(a, '/uploads'), { files: [{ path: '/b.txt', size: bytes.length, blocks: [b[0].sha] }], dirs: [], conflict: 'replace' });
    let limited = false;
    for (let i = 0; i < 2000 && !limited; i++) limited = (await a.client.raw('GET', '/api/me/usage')).status === 429;
    expect(limited).toBe(true);
    const put = await a.client.raw('PUT', api(a, `/uploads/${plan.body.uploadId}/blocks/${b[0].sha}`), {
      body: b[0].bytes as unknown as BodyInit,
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(put.status).toBe(204);
  });
});

describe('dedup never leaks other users’ files', () => {
  test('a plan reports blocks another user stores as missing; the owner skips them', async () => {
    const alice = await user('dd-alice@test.local');
    const bob = await user('dd-bob@test.local');
    const secret = enc('alice payroll letter: 123,456');
    await upload(alice, { '/secret.txt': 'alice payroll letter: 123,456' });
    const sha = blocksOf(secret)[0].sha;
    const probe = await bob.client.post(api(bob, '/uploads'), { files: [{ path: '/probe.txt', size: secret.length, blocks: [sha] }], dirs: [], conflict: 'replace' });
    expect(probe.status).toBe(200);
    expect(probe.body.missing).toEqual([sha]);
    const again = await upload(alice, { '/copy.txt': 'alice payroll letter: 123,456' });
    expect(again.sent).toBe(0);
  });
});

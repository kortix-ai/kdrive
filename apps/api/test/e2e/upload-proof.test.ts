// End to end: an upload may only commit blocks its user has proven they hold,
// either by sending the bytes in this upload or because content they already
// own lists them. The store dedups across every user, so a block hash alone
// must never be enough to put someone else's bytes into a workspace.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { actions, uploads, workspaces } from '../../src/db/schema';
import { reconcilePending } from '../../src/services/ledger';
import { toCtx } from '../../src/services/workspaces';
import type { EmulatedStore } from '../../src/storage/emulated';
import { blocksOf, enc, type Json } from '../helpers';
import { endWorld, freshWorld, head, ls, text, upload, user, type User } from './kit';

let store: EmulatedStore;
beforeEach(async () => {
  store = await freshWorld({ slotWaitMs: 200 });
});
afterEach(endWorld);
afterAll(endWorld);

const api = (u: User, p: string) => `/api/w/${u.ws}${p}`;

const SECRET = 'alice private letter: salary 98,765';

/** Plans one file by its block hashes only (no bytes are sent). */
function planByHash(u: User, path: string, size: number, blocks: string[], extra: Json = {}) {
  return u.client.post(api(u, '/uploads'), { files: [{ path, size, blocks }], dirs: [], conflict: 'replace', ...extra });
}

function putBlock(u: User, uploadId: string, sha: string, bytes: Uint8Array) {
  return u.client.raw('PUT', api(u, `/uploads/${uploadId}/blocks/${sha}`), {
    body: bytes as unknown as BodyInit,
    headers: { 'content-type': 'application/octet-stream' },
  });
}

const commit = (u: User, uploadId: string) => u.client.post(api(u, `/uploads/${uploadId}/commit`), {});

async function ctxOf(u: User) {
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, u.ws));
  return toCtx(row as typeof row & { volumeId: string });
}

describe('upload commit needs proof of possession', () => {
  test('a block hash another user stores cannot be committed without sending its bytes', async () => {
    const alice = await user('pp-alice@test.local');
    const bob = await user('pp-bob@test.local');
    const bytes = enc(SECRET);
    await upload(alice, { '/private.txt': SECRET });
    const sha = blocksOf(bytes)[0].sha;

    const plan = await planByHash(bob, '/copied.txt', bytes.length, [sha]);
    expect(plan.status).toBe(200);
    expect(plan.body.missing).toEqual([sha]);

    // No PUT at all: refused, and the plan stays alive for the bytes.
    const early = await commit(bob, plan.body.uploadId);
    expect(early.status).toBe(409);
    expect(early.body.error.details.missing).toEqual([sha]);
    expect(await ls(bob)).not.toContain('copied.txt');

    // Bytes that do not hash to the claimed block are refused too.
    const forged = enc('x'.repeat(bytes.length));
    expect((await putBlock(bob, plan.body.uploadId, sha, forged)).status).toBe(400);
    const still = await commit(bob, plan.body.uploadId);
    expect(still.status).toBe(409);
    expect(still.body.error.details.missing).toEqual([sha]);
    expect(await ls(bob)).not.toContain('copied.txt');

    // Someone who really holds the bytes proves it by sending them.
    expect((await putBlock(bob, plan.body.uploadId, sha, bytes)).status).toBe(204);
    const done = await commit(bob, plan.body.uploadId);
    expect(done.status).toBe(200);
    expect(await text(bob, '/copied.txt')).toBe(SECRET);
  });

  test('the owner still skips blocks their own files hold', async () => {
    const alice = await user('pp-owner@test.local');
    await upload(alice, { '/a.txt': SECRET });
    const again = await upload(alice, { '/b.txt': SECRET });
    expect(again.plan.missing).toEqual([]);
    expect(again.sent).toBe(0);
    expect(await text(alice, '/b.txt')).toBe(SECRET);
  });

  test('a restarted relay forgets what was sent and asks for it again (fails closed)', async () => {
    const bob = await user('pp-restart@test.local');
    const bytes = enc('bob bytes, sent once');
    const [b] = blocksOf(bytes);
    const plan = await planByHash(bob, '/r.txt', bytes.length, [b.sha]);
    expect(plan.body.missing).toEqual([b.sha]);
    expect((await putBlock(bob, plan.body.uploadId, b.sha, b.bytes)).status).toBe(204);
    const { forgetReceivedBlocksForTests } = await import('../../src/services/proven-blocks');
    forgetReceivedBlocksForTests();
    const again = await commit(bob, plan.body.uploadId);
    expect(again.status).toBe(409);
    expect(again.body.error.details.missing).toEqual([b.sha]);
    expect((await putBlock(bob, plan.body.uploadId, b.sha, b.bytes)).status).toBe(204);
    expect((await commit(bob, plan.body.uploadId)).status).toBe(200);
  });
});

describe('only committed content counts as held', () => {
  test('a block list in an unfinished part of a multi-part upload is not proof', async () => {
    const alice = await user('mp-alice@test.local');
    const bob = await user('mp-bob@test.local');
    const bytes = enc(SECRET);
    await upload(alice, { '/private.txt': SECRET });
    const sha = blocksOf(bytes)[0].sha;

    // Part 1 commits Bob's own file; part 2 joins that (now committed) action
    // with Alice's hash and is then abandoned.
    const first = await upload(bob, { '/mine.txt': 'bob own file' });
    const part2 = await planByHash(bob, '/grab.txt', bytes.length, [sha], { actionId: first.plan.actionId });
    expect(part2.status).toBe(200);
    expect((await bob.client.del(api(bob, `/uploads/${part2.body.uploadId}`))).status).toBe(204);

    const probe = await planByHash(bob, '/copied.txt', bytes.length, [sha]);
    expect(probe.status).toBe(200);
    expect(probe.body.missing).toEqual([sha]);
    const c = await commit(bob, probe.body.uploadId);
    expect(c.status).toBe(409);
    expect(await ls(bob)).not.toContain('copied.txt');
  });

  test('a later part of an upload cannot plan a file an earlier part already planned', async () => {
    const bob = await user('mp-dup@test.local');
    const first = await upload(bob, { '/x.txt': 'first part' });
    const other = enc('second part');
    const again = await planByHash(bob, '/x.txt', other.length, [blocksOf(other)[0].sha], { actionId: first.plan.actionId });
    expect(again.status).toBe(400);
  });

  test('restore never trusts the block list of an upload plan that did not commit', async () => {
    const alice = await user('rs-alice@test.local');
    const bob = await user('rs-bob@test.local');
    const secret = enc(SECRET);
    await upload(alice, { '/private.txt': SECRET });
    const sha = blocksOf(secret)[0].sha;
    const own = 'B'.repeat(secret.length); // Bob's own bytes, same size

    // Bob plans /x.txt with Alice's hash and never sends the bytes...
    const plan = await planByHash(bob, '/x.txt', secret.length, [sha]);
    expect(plan.status).toBe(200);
    // ...while a commit no action claims writes his own bytes there, and the
    // plan goes stale. That commit does not hold the planned bytes, so
    // reconciliation does not give it to the upload action.
    const ctx = await ctxOf(bob);
    await store.write(ctx.volumeId, '/x.txt', enc(own), { overwrite: true });
    const v = await head(bob);
    await db.update(uploads).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(uploads.id, plan.body.uploadId));
    await reconcilePending(ctx, { olderThanMs: 0 });
    const [{ status }] = (await db.execute(sql`SELECT status FROM actions WHERE id = ${plan.body.actionId}`)) as unknown as { status: string }[];
    expect(status).toBe('failed');
    // Even an upload action that does end up holding that commit only claims
    // the planned list: the plan never committed, so its hashes are not content.
    await db.update(actions).set({ status: 'committed', commitIds: [v], headCommitId: v }).where(eq(actions.id, plan.body.actionId));

    // Neither a new plan nor a restore may treat Alice's hash as Bob's.
    const probe = await planByHash(bob, '/copied.txt', secret.length, [sha]);
    expect(probe.body.missing).toEqual([sha]);
    expect((await commit(bob, probe.body.uploadId)).status).toBe(409);

    await upload(bob, { '/x.txt': 'something newer' });
    const r = await bob.client.post(api(bob, '/restore'), { scope: 'file', path: '/x.txt', at: v });
    expect(r.status).toBe(200);
    expect(await text(bob, '/x.txt')).toBe(own);
  });
});

describe('duplicating a workspace stays inside the owner’s content', () => {
  test('another user’s workspace or version cannot be forked', async () => {
    const alice = await user('fk-alice@test.local');
    const bob = await user('fk-bob@test.local');
    await upload(alice, { '/private.txt': SECRET });
    const aliceHead = await head(alice);
    const other = await bob.client.post(`/api/workspaces/${alice.ws}/duplicate`, { name: 'Stolen' });
    expect(other.status).toBe(404);
    // A version id is looked up in the source volume only: Alice's is unknown there.
    const at = await bob.client.post(`/api/workspaces/${bob.ws}/duplicate`, { name: 'Stolen', at: aliceHead });
    expect([404, 410]).toContain(at.status);
    const mine = await db.select().from(workspaces).where(eq(workspaces.userId, bob.userId));
    expect(mine).toHaveLength(1);
  });
});

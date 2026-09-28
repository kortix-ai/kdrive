import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { resetDb, signInWithWorkspace } from '../../test/helpers';
import { db } from '../db/client';
import { actions } from '../db/schema';
import { getStore } from '../storage';
import { getWorkspaceForUser } from './workspaces';
import {
  actionsByCommits,
  actionsInRange,
  appendPaths,
  attachCommit,
  contentHashOf,
  deletedRows,
  finalize,
  getAction,
  exactBlockLists,
  pathRows,
  reconcilePending,
  recordIntent,
  withAction,
  type ActionCtx,
} from './ledger';

const enc = (s: string) => new TextEncoder().encode(s);

async function ctxFor(email: string): Promise<ActionCtx> {
  const { client, ws } = await signInWithWorkspace(email);
  const me = await client.get('/api/me');
  const w = await getWorkspaceForUser(me.body.user.id, ws);
  return { ws: w!, userId: me.body.user.id };
}

describe('ledger', () => {
  beforeEach(resetDb);

  test('withAction: intent → commit → finalize (committed, bytesDelta, itemCount)', async () => {
    const ctx = await ctxFor('ledger1@test.local');
    const store = getStore();
    const { result, action } = await withAction(
      ctx,
      { kind: 'upload', summary: 'Uploaded a.txt', paths: [{ op: 'added', path: '/a.txt', entryType: 'file', size: 5, blockHashes: ['ab'.repeat(32)] }] },
      async (rec) => {
        const r = await store.write(ctx.ws.volumeId, '/a.txt', enc('hello'));
        await rec.commit(r);
        return r;
      },
    );
    expect(action.status).toBe('committed');
    expect(action.headCommitId).toBe(result.commitId);
    expect(action.baseCommitId).not.toBe(result.commitId);
    expect(action.itemCount).toBe(1);
    expect(action.bytesDelta).toBe(5); // the file's real size, not its 4 KiB page
    expect(action.undoable).toBe(true);
    const row = await getAction(ctx.ws.id, action.id);
    expect(row!.commitIds).toEqual([result.commitId]);
    const byCommit = await actionsByCommits(ctx.ws.id, [result.commitId, 'vc_unknown']);
    expect(byCommit.get(result.commitId)!.id).toBe(action.id);
    expect(byCommit.has('vc_unknown')).toBe(false);
  });

  test('withAction: noop and failed', async () => {
    const ctx = await ctxFor('ledger2@test.local');
    const store = getStore();
    await store.write(ctx.ws.volumeId, '/same.txt', enc('same'));
    const { action } = await withAction(ctx, { kind: 'upload', summary: 'noop', paths: [] }, async (rec) => {
      await rec.commit(await store.write(ctx.ws.volumeId, '/same.txt', enc('same')));
    });
    expect(action.status).toBe('noop');
    expect(action.undoable).toBe(false);

    let id = '';
    await expect(
      withAction(ctx, { kind: 'delete', summary: 'boom', paths: [] }, async (rec) => {
        id = rec.actionId;
        await store.remove(ctx.ws.volumeId, '/missing', { recursive: true });
      }),
    ).rejects.toThrow();
    const failed = await getAction(ctx.ws.id, id);
    expect(failed!.status).toBe('failed');
    expect(failed!.error).toContain('not found');
  });

  test('withAction: partial failure after a commit stays committed with meta.partial', async () => {
    const ctx = await ctxFor('ledger3@test.local');
    const store = getStore();
    let id = '';
    await expect(
      withAction(ctx, { kind: 'delete', summary: 'two deletes', paths: [] }, async (rec) => {
        id = rec.actionId;
        await rec.commit(await store.write(ctx.ws.volumeId, '/x.txt', enc('x')));
        throw new Error('second step failed');
      }),
    ).rejects.toThrow('second step failed');
    const row = await getAction(ctx.ws.id, id);
    expect(row!.status).toBe('committed');
    expect(row!.meta.partial).toBe(true);
  });

  test('two-request flow: recordIntent + appendPaths + attachCommit + finalize (re-finalise keeps the last head)', async () => {
    const ctx = await ctxFor('ledger4@test.local');
    const store = getStore();
    const { actionId, baseCommitId } = await recordIntent(ctx, {
      kind: 'upload',
      summary: 'Uploaded 2 files',
      paths: [{ op: 'added', path: '/one.txt', entryType: 'file', size: 3, blockHashes: [] }],
    });
    expect(baseCommitId).toBe((await store.getVolume(ctx.ws.volumeId)).headCommitId);
    await appendPaths(actionId, ctx.ws.id, [{ op: 'added', path: '/two.txt', entryType: 'file', size: 3 }]);
    const r1 = await store.write(ctx.ws.volumeId, '/one.txt', enc('one'));
    await attachCommit(actionId, r1);
    const s1 = await finalize(actionId, 'committed');
    expect(s1.headCommitId).toBe(r1.commitId);
    const r2 = await store.write(ctx.ws.volumeId, '/two.txt', enc('two'));
    await attachCommit(actionId, r2);
    await attachCommit(actionId, r2); // idempotent
    const s2 = await finalize(actionId, 'committed');
    expect(s2.headCommitId).toBe(r2.commitId);
    expect(s2.itemCount).toBe(2);
    expect((await getAction(ctx.ws.id, actionId))!.commitIds).toEqual([r1.commitId, r2.commitId]);
    const rows = await pathRows(ctx.ws.id, '/one.txt');
    expect(rows[0].contentHash).toBe(contentHashOf([]));
  });

  test('queries: pathRows (fromPath, descendants), exactBlockLists, deletedRows, actionsInRange', async () => {
    const ctx = await ctxFor('ledger5@test.local');
    const store = getStore();
    const blocks = ['aa'.repeat(32)];
    const t0 = new Date(Date.now() - 1000);
    await withAction(ctx, { kind: 'upload', summary: 'up', paths: [{ op: 'added', path: '/dir/f.bin', entryType: 'file', size: 10, blockHashes: blocks }] }, async (rec) => {
      await rec.commit(await store.write(ctx.ws.volumeId, '/dir/f.bin', enc('0123456789')));
    });
    await withAction(ctx, { kind: 'move', summary: 'mv', paths: [{ op: 'moved', path: '/dir/g.bin', fromPath: '/dir/f.bin', entryType: 'file', size: 10, blockHashes: blocks }] }, async (rec) => {
      await rec.commit(await store.move(ctx.ws.volumeId, '/dir/f.bin', '/dir/g.bin'));
    });
    const moved = await store.stat(ctx.ws.volumeId, '/dir/g.bin');
    // Trusted only for the exact version its action wrote.
    expect((await exactBlockLists(ctx.ws.id, [moved])).get('/dir/g.bin')).toEqual(blocks);
    expect((await exactBlockLists(ctx.ws.id, [{ ...moved, version: '01ZZZZZZZZZZZZZZZZZZZZZZZZ' }])).size).toBe(0);
    expect((await exactBlockLists(ctx.ws.id, [{ ...moved, size: 11 }])).size).toBe(0);
    await withAction(ctx, { kind: 'delete', summary: 'rm', paths: [{ op: 'deleted', path: '/dir', entryType: 'dir', size: 10 }] }, async (rec) => {
      await rec.commit(await store.remove(ctx.ws.volumeId, '/dir', { recursive: true }));
    });
    const f = await pathRows(ctx.ws.id, '/dir/f.bin');
    expect(f.map((r) => r.op)).toEqual(['moved', 'added']);
    const all = await pathRows(ctx.ws.id, '/dir', { includeDescendants: true });
    expect(all.length).toBe(3);
    const del = await deletedRows(ctx.ws.id, 10);
    expect(del.map((d) => d.path)).toEqual(['/dir']);
    expect(del[0].action.kind).toBe('delete');
    const range = await actionsInRange(ctx.ws.id, t0, new Date());
    expect(range.map((a) => a.kind)).toEqual(['upload', 'move', 'delete']);
    expect(range[1].paths[0].fromPath).toBe('/dir/f.bin');
  });

  test('reconcilePending attaches the single unclaimed commit, else fails', async () => {
    const ctx = await ctxFor('ledger6@test.local');
    const store = getStore();
    const a = await recordIntent(ctx, { kind: 'rename', summary: 'lost response', paths: [] });
    const r = await store.write(ctx.ws.volumeId, '/orphan.txt', enc('o'));
    const b = await recordIntent(ctx, { kind: 'delete', summary: 'never ran', paths: [] });
    // age both intents past the 2-minute window
    await db.update(actions).set({ createdAt: new Date(Date.now() - 10 * 60_000) }).where(eq(actions.workspaceId, ctx.ws.id));
    await reconcilePending(ctx.ws);
    const ra = await getAction(ctx.ws.id, a.actionId);
    const rb = await getAction(ctx.ws.id, b.actionId);
    expect(ra!.status).toBe('committed');
    expect(ra!.headCommitId).toBe(r.commitId);
    expect(rb!.status).toBe('failed');
  });
});

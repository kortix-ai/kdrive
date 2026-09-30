import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { actionPaths, actions, userSettings } from '../db/schema';
import { ApiError } from '../lib/http';
import { getStore } from '../storage';
import type { WorkspaceCtx } from '../types';
import { blocksOf, enc } from '../../test/helpers';
import { endWorld, freshWorld, upload, user, type User } from '../../test/e2e/kit';
import { agentBatchSummary, applyAgentBatch, guardConflicts, partialActionOf, type BatchOp } from './agent-batch';
import { headOf } from './files-ops';
import { buildTimeline } from './timeline';
import { listTree } from './tree';
import { undoAction } from './undo';
import { readStream } from './versioning-util';
import { getUsage } from './quota';
import { getWorkspaceForUser } from './workspaces';

let u: User;
let ws: WorkspaceCtx;
const actor = { kind: 'agent' as const, name: 'Batch agent', credential: 'pat:test-token' };
const ctx = () => ({ ws, userId: u.userId, actor });

async function run(ops: BatchOp[], base?: string, extra: { force?: boolean; kind?: 'agent.batch' | 'proposal.accept' } = {}) {
  return applyAgentBatch(ctx(), {
    ops,
    baseCommitId: base ?? (await headOf(ws)),
    force: extra.force,
    kind: extra.kind ?? 'agent.batch',
    summary: agentBatchSummary(ops, ''),
    meta: { ops: ops.length },
  });
}

async function readText(path: string): Promise<string> {
  const r = await getStore().read(ws.volumeId, path);
  return new TextDecoder().decode(await readStream(r.body));
}

async function tree(): Promise<string[]> {
  return (await listTree(ws, '/', await headOf(ws))).entries.map((e) => `${e.type === 'dir' ? 'd' : 'f'} ${e.path}`).sort();
}

async function thrown(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('expected a rejection');
}

beforeEach(async () => {
  await freshWorld();
  u = await user('batch@test.local');
  ws = (await getWorkspaceForUser(u.userId, u.ws))!;
});
afterAll(() => endWorld());

describe('applyAgentBatch', () => {
  test('a mixed batch is ONE agent action; ops see the ones before them', async () => {
    await upload(u, { '/old/gone.txt': 'bye', '/keep.txt': 'k' });
    const { action, results } = await run([
      { op: 'mkdir', path: '/proj' },
      { op: 'write', path: '/proj/readme.md', bytes: enc('# hi') },
      { op: 'write', path: '/proj/logo.bin', bytes: new Uint8Array([0, 1, 2, 250]) },
      { op: 'move', from: '/proj/readme.md', to: '/proj/README.md' },
      { op: 'copy', from: '/proj/README.md', to: '/copy/README.md' },
      { op: 'delete', path: '/old' },
    ]);
    expect(action.status).toBe('committed');
    expect(action.kind).toBe('agent.batch');
    expect(action.agent).toEqual({ kind: 'token', name: 'Batch agent', credential: 'pat:test-token' });
    expect(results.map((r) => r.result)).toEqual(['folder', 'created', 'created', 'moved', 'copied', 'deleted']);
    expect(await tree()).toEqual(['d /copy', 'd /proj', 'f /copy/README.md', 'f /keep.txt', 'f /proj/README.md', 'f /proj/logo.bin']);
    expect(await readText('/copy/README.md')).toBe('# hi');
    const rows = await db.select().from(actionPaths).where(eq(actionPaths.actionId, action.id));
    expect(rows.map((r) => `${r.op} ${r.path}`)).toEqual([
      'added /proj',
      'added /proj/readme.md',
      'added /proj/logo.bin',
      'moved /proj/README.md',
      'added /copy',
      'copied /copy/README.md',
      'deleted /old',
    ]);
    const [row] = await db.select().from(actions).where(eq(actions.id, action.id));
    expect(row.actorKind).toBe('agent');
    const t = await buildTimeline(ws, { limit: 10 });
    expect(t.entries.filter((e) => e.actionId === action.id)).toHaveLength(1);
    expect(t.entries[0].agent?.name).toBe('Batch agent');

    // Undo puts the prior tree back.
    await undoAction({ ...ctx(), email: 'batch@test.local', ip: null }, action.id);
    expect(await tree()).toEqual(['d /old', 'f /keep.txt', 'f /old/gone.txt']);
  });

  test('a 2.5 MiB write round-trips byte-exact and proves its blocks for later uploads', async () => {
    const big = new Uint8Array(randomBytes(2.5 * 1024 * 1024));
    await run([{ op: 'write', path: '/big.bin', bytes: big }]);
    const r = await getStore().read(ws.volumeId, '/big.bin');
    expect(Buffer.from(await readStream(r.body)).equals(Buffer.from(big))).toBe(true);
    const blocks = blocksOf(big);
    expect(blocks).toHaveLength(3);
    const plan = await u.client.post(`/api/w/${u.ws}/uploads`, {
      files: [{ path: '/again.bin', size: big.length, blocks: blocks.map((b) => b.sha) }],
      dirs: [],
      conflict: 'replace',
    });
    expect(plan.status).toBe(200);
    expect(plan.body.missing).toEqual([]);
  });

  test('refusals carry the op index and write nothing', async () => {
    await upload(u, { '/f.txt': 'f' });
    const before = await tree();
    const e1 = await thrown(run([{ op: 'mkdir', path: '/n' }, { op: 'write', path: '/f.txt/x', bytes: enc('x') }]));
    expect(e1.code).toBe('not_a_directory');
    expect(e1.details?.index).toBe(1);
    const e2 = await thrown(run([{ op: 'copy', from: '/f.txt', to: '/g.txt' }, { op: 'copy', from: '/f.txt', to: '/g.txt' }]));
    expect(e2.code).toBe('path_exists');
    expect(e2.details?.index).toBe(1);
    const e3 = await thrown(run([{ op: 'delete', path: '/f.txt' }, { op: 'move', from: '/f.txt', to: '/h.txt' }]));
    expect(e3.code).toBe('path_not_found');
    expect(e3.details?.index).toBe(1);
    const e4 = await thrown(run([{ op: 'mkdir', path: '/d' }, { op: 'move', from: '/d', to: '/d/inside' }]));
    expect(e4.code).toBe('bad_request');
    expect(await tree()).toEqual(before);
  });

  test('quota refusal is a 413 with quota details and writes nothing', async () => {
    await db.insert(userSettings).values({ userId: u.userId, quotaBytes: 64 * 1024 }).onConflictDoUpdate({ target: userSettings.userId, set: { quotaBytes: 64 * 1024 } });
    const e = await thrown(run([{ op: 'write', path: '/huge.bin', bytes: new Uint8Array(200 * 1024).fill(7) }]));
    expect(e.status).toBe(413);
    expect(e.code).toBe('quota_exceeded');
    expect(e.details).toMatchObject({ quotaBytes: 64 * 1024 });
    expect(await tree()).toEqual([]);
  });

  test('a folder the batch already changed is charged in full when copied', async () => {
    await upload(u, { '/d/a.bin': new Uint8Array(1024 * 1024).fill(1), '/d/b.bin': new Uint8Array(1024 * 1024).fill(2), '/d/c.bin': new Uint8Array(1024 * 1024).fill(3), '/x.bin': new Uint8Array(512 * 1024).fill(4) });
    const used = (await getUsage(u.userId)).usedBytes;
    const quota = used + 1024 * 1024;
    await db.insert(userSettings).values({ userId: u.userId, quotaBytes: quota }).onConflictDoUpdate({ target: userSettings.userId, set: { quotaBytes: quota } });
    const before = await tree();
    const refused = async (ops: BatchOp[]) => {
      const e = await thrown(run(ops));
      expect(e.code).toBe('quota_exceeded');
    };
    await refused([{ op: 'copy', from: '/d', to: '/plain' }]);
    await refused([{ op: 'mkdir', path: '/d/t' }, { op: 'copy', from: '/d', to: '/b' }]);
    await refused([{ op: 'write', path: '/d/n.txt', bytes: enc('n') }, { op: 'copy', from: '/d', to: '/b' }]);
    await refused([{ op: 'copy', from: '/x.bin', to: '/y.bin' }, { op: 'move', from: '/y.bin', to: '/d/y.bin' }, { op: 'copy', from: '/d', to: '/b' }]);
    await refused([{ op: 'move', from: '/x.bin', to: '/d/x.bin' }, { op: 'copy', from: '/d', to: '/b' }]);
    // A folder copied, then written into, then copied again carries both.
    await refused([{ op: 'copy', from: '/x.bin', to: '/e/x.bin' }, { op: 'write', path: '/e/n.txt', bytes: enc('n') }, { op: 'copy', from: '/e', to: '/f' }]);
    expect(await tree()).toEqual(before);
    expect((await getUsage(u.userId)).usedBytes).toBe(used);
    // A small folder the batch changed still copies within the quota.
    const small = await run([{ op: 'write', path: '/s/n.txt', bytes: enc('n') }, { op: 'copy', from: '/s', to: '/s2' }]);
    expect(small.action.status).toBe('committed');
  });

  test('copies that double a folder within one batch are charged for every round', async () => {
    await upload(u, { '/d/a.bin': new Uint8Array(3 * 1024 * 1024).fill(9) });
    const used = (await getUsage(u.userId)).usedBytes;
    const quota = used + 1024 * 1024;
    await db.insert(userSettings).values({ userId: u.userId, quotaBytes: quota }).onConflictDoUpdate({ target: userSettings.userId, set: { quotaBytes: quota } });
    const ops: BatchOp[] = [];
    for (let i = 0; i < 4; i++) {
      ops.push({ op: 'mkdir', path: `/d/t${i}` }, { op: 'copy', from: '/d', to: `/b${i}` }, { op: 'move', from: `/b${i}`, to: `/d/b${i}` });
    }
    const e = await thrown(run(ops));
    expect(e.code).toBe('quota_exceeded');
    expect(Number(e.details?.requestedBytes)).toBeGreaterThanOrEqual(15 * 3 * 1024 * 1024);
    expect((await getUsage(u.userId)).usedBytes).toBe(used);
    // The same batch through a proposal is refused when staged.
    await db.update(userSettings).set({ quotaBytes: 10 * 1024 ** 3 }).where(eq(userSettings.userId, u.userId));
    const { simulate } = await import('./agent-batch');
    const sim = await simulate(ws, await headOf(ws), ops);
    expect(sim.growth).toBeGreaterThanOrEqual(15 * 3 * 1024 * 1024);
  });

  test('identical writes end as a noop with result unchanged', async () => {
    await upload(u, { '/same.txt': 'same' });
    const { action, results } = await run([{ op: 'write', path: '/same.txt', bytes: enc('same') }]);
    expect(action.status).toBe('noop');
    expect(results[0].result).toBe('unchanged');
  });

  test('live links follow a move', async () => {
    await upload(u, { '/docs/a.txt': 'a' });
    const link = await u.client.post(`/api/w/${u.ws}/links`, { path: '/docs', mode: 'live' });
    expect(link.status).toBe(201);
    await run([{ op: 'move', from: '/docs', to: '/archive/docs' }]);
    const list = await u.client.get(`/api/w/${u.ws}/links`);
    expect(list.body.links[0].path).toBe('/archive/docs');
  });
});

describe('guard', () => {
  test('only touched paths conflict; force skips only the guard', async () => {
    await upload(u, { '/a.txt': 'a', '/b.txt': 'b', '/dir/x.txt': 'x', '/m/y.txt': 'y' });
    const base = await headOf(ws);
    await upload(u, { '/b.txt': 'b2', '/dir/new.txt': 'n', '/m/y.txt': 'y2' });
    const head = await headOf(ws);
    expect(await guardConflicts(ws, base, head, [{ op: 'write', path: '/a.txt' }])).toEqual([]);
    const c = await guardConflicts(ws, base, head, [
      { op: 'write', path: '/b.txt' },
      { op: 'delete', path: '/dir' },
      { op: 'move', path: '/n', from: '/m' },
    ]);
    expect(c.map((x) => `${x.reason} ${x.path}`)).toEqual(['changed /b.txt', 'created /dir/new.txt', 'changed /m/y.txt']);

    const ok = await run([{ op: 'write', path: '/a.txt', bytes: enc('a2') }], base);
    expect(ok.action.status).toBe('committed');
    const e = await thrown(run([{ op: 'delete', path: '/dir' }], base));
    expect(e.code).toBe('stale_base');
    expect(e.details?.current_commit_id).toBe(await headOf(ws));
    expect((e.details?.conflicts as { reason: string }[])[0].reason).toBe('created');
    const forced = await run([{ op: 'delete', path: '/dir' }], base, { force: true });
    expect(forced.action.status).toBe('committed');
    // force never skips validation
    const e2 = await thrown(run([{ op: 'delete', path: '/dir' }], base, { force: true }));
    expect(e2.code).toBe('path_not_found');
  });

  test('a base named by reference ("head", a tag) is refused', async () => {
    await upload(u, { '/r.txt': 'r' });
    const e = await thrown(run([{ op: 'write', path: '/r.txt', bytes: enc('x') }], 'head'));
    expect(e.code).toBe('bad_request');
    expect(await readText('/r.txt')).toBe('r');
  });

  test('a partial failure names the action that landed', async () => {
    await upload(u, { '/p.txt': 'p' });
    const store = getStore();
    const orig = store.remove.bind(store);
    (store as { remove: typeof store.remove }).remove = async () => {
      throw new Error('connection reset');
    };
    try {
      const err = await run([{ op: 'write', path: '/q.txt', bytes: enc('q') }, { op: 'delete', path: '/p.txt' }]).catch((e) => e);
      expect(partialActionOf(err)).toMatch(/^[0-9a-z]{26}$/);
    } finally {
      (store as { remove: typeof store.remove }).remove = orig;
    }
  });
});

describe('agentBatchSummary', () => {
  test('the message wins, else a generated line', () => {
    expect(agentBatchSummary([{ op: 'mkdir', path: '/a' }], '  Tidy notes  ')).toBe('Tidy notes');
    expect(agentBatchSummary([{ op: 'mkdir', path: '/a' }], 'x'.repeat(200))).toHaveLength(120);
    expect(agentBatchSummary([{ op: 'write', path: '/plan.md', bytes: enc('') }], '')).toBe('Wrote plan.md');
    const three = ['a', 'b', 'c'].map((n) => ({ op: 'write' as const, path: `/notes/${n}.md`, bytes: enc('') }));
    expect(agentBatchSummary(three, '')).toBe('Wrote 3 files to /notes');
    expect(agentBatchSummary([three[0], { op: 'move', from: '/x', to: '/y' }, { op: 'move', from: '/z', to: '/w' }], '')).toBe(
      'Wrote a.md and moved 2 items',
    );
    expect(agentBatchSummary([three[0], { op: 'mkdir', path: '/q' }, { op: 'delete', path: '/r' }], '')).toBe('Changed 3 items');
  });
});

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { MiB, PROPOSAL_OPEN_MAX, PROPOSAL_STAGED_MAX } from '@volumes/shared';
import type { AgentPrincipal } from '../agents/principal';
import { db } from '../db/client';
import { actions, checkpoints, proposalBlocks, proposalFiles, proposals } from '../db/schema';
import { ApiError } from '../lib/http';
import { newId } from '../lib/ids';
import { getStore } from '../storage';
import type { WorkspaceCtx } from '../types';
import { enc } from '../../test/helpers';
import { endWorld, freshWorld, upload, user, type User } from '../../test/e2e/kit';
import type { BatchOp } from './agent-batch';
import { headOf } from './files-ops';
import {
  acceptProposal,
  createProposal,
  discardProposal,
  gcProposalBlocks,
  getProposalDetail,
  listProposals,
  proposalCount,
} from './proposals';
import { listTree } from './tree';
import { readStream } from './versioning-util';
import { getWorkspaceForUser } from './workspaces';

let u: User;
let ws: WorkspaceCtx;
let p: AgentPrincipal;
const ctx = () => ({ ws, userId: u.userId, email: 'prop@test.local', ip: null });

async function propose(ops: BatchOp[], opts: { base?: string; message?: string; checkpointName?: string | null } = {}) {
  return createProposal(ctx(), p, {
    ops,
    baseCommitId: opts.base ?? (await headOf(ws)),
    message: opts.message ?? '',
    checkpointName: opts.checkpointName ?? null,
  });
}

async function tree(): Promise<string[]> {
  return (await listTree(ws, '/', await headOf(ws))).entries.map((e) => e.path).sort();
}

async function thrown(x: Promise<unknown>): Promise<ApiError> {
  try {
    await x;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('expected a rejection');
}

beforeEach(async () => {
  await freshWorld();
  u = await user('prop@test.local');
  ws = (await getWorkspaceForUser(u.userId, u.ws))!;
  p = {
    kind: 'token',
    credential: 'pat:prop-token',
    grantId: 'prop-token',
    name: 'Prop agent',
    user: { id: u.userId, email: 'prop@test.local', name: null, image: null },
    scope: 'drive:propose',
    mode: 'review',
    workspaceId: null,
  };
});
afterAll(() => endWorld());

describe('create', () => {
  test('stages blocks and changes nothing in storage', async () => {
    await upload(u, { '/a.txt': 'a' });
    const before = await tree();
    const head = await headOf(ws);
    const row = await propose([
      { op: 'write', path: '/a.txt', bytes: enc('a2') },
      { op: 'write', path: '/new.txt', bytes: enc('new') },
      { op: 'mkdir', path: '/folder' },
    ]);
    expect(row.status).toBe('open');
    expect(row.opCount).toBe(3);
    expect(await tree()).toEqual(before);
    expect(await headOf(ws)).toBe(head);
    const blocks = await db.select().from(proposalBlocks).where(eq(proposalBlocks.userId, u.userId));
    expect(blocks).toHaveLength(2);
    const d = await getProposalDetail(ws, u.userId, row.id);
    expect(d.files.map((f) => f.change)).toEqual(['modified', 'added', 'folder']);
    expect(d.proposal.counts).toMatchObject({ added: 1, modified: 1, folders: 1 });
    expect(d.files[0].compare?.a?.size).toBe(1);
    expect(d.files[0].compare?.b?.commitId).toBe('proposed');
    expect(d.conflicts).toBe(0);
    expect(await proposalCount(ws, u.userId)).toBe(1);
  });

  test('refuses what could not be applied, and past the caps', async () => {
    const e1 = await thrown(propose([{ op: 'delete', path: '/nope' }]));
    expect(e1.code).toBe('path_not_found');
    await db.insert(proposals).values(
      Array.from({ length: PROPOSAL_OPEN_MAX }, () => ({
        id: newId(),
        workspaceId: ws.id,
        userId: u.userId,
        agentName: 'x',
        agentCredential: 'pat:x',
        baseCommitId: 'vc_x',
        opCount: 1,
        expiresAt: new Date(Date.now() + 86_400_000),
      })),
    );
    const e2 = await thrown(propose([{ op: 'mkdir', path: '/a' }]));
    expect(e2.code).toBe('conflict');
    await db.delete(proposals);
    await db.insert(proposals).values({
      id: newId(),
      workspaceId: ws.id,
      userId: u.userId,
      agentName: 'x',
      agentCredential: 'pat:x',
      baseCommitId: 'vc_x',
      opCount: 1,
      bytesTotal: PROPOSAL_STAGED_MAX,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const e3 = await thrown(propose([{ op: 'write', path: '/b.txt', bytes: enc('b') }]));
    expect(e3.code).toBe('payload_too_large');
  });
});

describe('accept and discard', () => {
  test('accept all lands ONE proposal.accept action, closes it and makes the checkpoint', async () => {
    const row = await propose([{ op: 'write', path: '/doc.md', bytes: enc('hello') }, { op: 'mkdir', path: '/d' }], {
      message: 'Add doc',
      checkpointName: 'Doc added',
    });
    const r = await acceptProposal(ctx(), row.id, {});
    expect(r.proposal.status).toBe('accepted');
    expect(r.action?.kind).toBe('proposal.accept');
    expect(r.action?.summary).toBe('Accepted from Prop agent: Add doc');
    expect(r.action?.proposalId).toBe(row.id);
    expect(r.action?.agent?.name).toBe('Prop agent');
    expect(await tree()).toEqual(['/d', '/doc.md']);
    const cps = await db.select().from(checkpoints).where(eq(checkpoints.workspaceId, ws.id));
    expect(cps.map((c) => c.name)).toEqual(['Doc added']);
    expect((await db.select().from(proposalBlocks)).length).toBe(0);
    const again = await thrown(acceptProposal(ctx(), row.id, {}));
    expect(again.code).toBe('proposal_closed');
    const again2 = await thrown(discardProposal(ctx(), row.id, {}));
    expect(again2.code).toBe('proposal_closed');
  });

  test('per-file accept keeps it open; discarding the rest makes it partial', async () => {
    const row = await propose([
      { op: 'write', path: '/one.txt', bytes: enc('1') },
      { op: 'write', path: '/two.txt', bytes: enc('2') },
    ]);
    const a = await acceptProposal(ctx(), row.id, { seqs: [1] });
    expect(a.proposal.status).toBe('open');
    expect(a.proposal.pending).toBe(1);
    expect(await tree()).toEqual(['/two.txt']);
    const bad = await thrown(acceptProposal(ctx(), row.id, { seqs: [1] }));
    expect(bad.code).toBe('bad_request');
    const d = await discardProposal(ctx(), row.id, {});
    expect(d.proposal.status).toBe('partial');
    const [pr] = await db.select().from(proposals).where(eq(proposals.id, row.id));
    expect(pr.acceptedActionIds).toEqual([a.action!.id]);
  });

  test('a conflicting change blocks accept until forced', async () => {
    await upload(u, { '/c.txt': 'c' });
    const row = await propose([{ op: 'write', path: '/c.txt', bytes: enc('agent') }]);
    await upload(u, { '/c.txt': 'user edit' });
    const d = await getProposalDetail(ws, u.userId, row.id);
    expect(d.conflicts).toBe(1);
    expect(d.files[0].conflict).toEqual({ reason: 'changed', currentSize: 9 });
    const e = await thrown(acceptProposal(ctx(), row.id, {}));
    expect(e.code).toBe('stale_base');
    expect(e.details?.current_commit_id).toBe(await headOf(ws));
    const r = await acceptProposal(ctx(), row.id, { force: true });
    expect(r.proposal.status).toBe('accepted');
    const bytes = await readStream((await getStore().read(ws.volumeId, '/c.txt')).body);
    expect(new TextDecoder().decode(bytes)).toBe('agent');
  });

  test('a tampered staged block is refused and nothing is written', async () => {
    const row = await propose([{ op: 'write', path: '/t.txt', bytes: enc('trusted') }]);
    await db.update(proposalBlocks).set({ bytes: enc('evil!!!') }).where(eq(proposalBlocks.userId, u.userId));
    const e = await thrown(acceptProposal(ctx(), row.id, {}));
    expect(e.status).toBe(500);
    expect(await tree()).toEqual([]);
    const n = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(actions)
      .where(and(eq(actions.workspaceId, ws.id), eq(actions.kind, 'proposal.accept')));
    expect(n[0].n).toBe(0);
  });
});

describe('housekeeping', () => {
  test('expiry closes old proposals; GC keeps blocks another open proposal needs', async () => {
    const shared = new Uint8Array(randomBytes(MiB + 10));
    const a = await propose([{ op: 'write', path: '/x.bin', bytes: shared }]);
    const b = await propose([{ op: 'write', path: '/y.bin', bytes: shared }]);
    expect((await db.select().from(proposalBlocks)).length).toBe(2);
    await discardProposal(ctx(), a.id, {});
    expect((await db.select().from(proposalBlocks)).length).toBe(2);
    await db.update(proposals).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(proposals.id, b.id));
    const list = await listProposals(ws, u.userId, { status: 'all', limit: 10 });
    expect(list.proposals.map((x) => x.status).sort()).toEqual(['discarded', 'expired']);
    expect(list.openCount).toBe(0);
    await gcProposalBlocks(u.userId);
    expect((await db.select().from(proposalBlocks)).length).toBe(0);
    const closed = await listProposals(ws, u.userId, { status: 'open', limit: 10 });
    expect(closed.proposals).toHaveLength(0);
  });

  test('block GC waits for a proposal being created, so a shared block is never lost', async () => {
    const shared = new Uint8Array(randomBytes(64 * 1024));
    const a = await propose([{ op: 'write', path: '/a.bin', bytes: shared }]);
    await db.update(proposals).set({ status: 'discarded' }).where(eq(proposals.id, a.id));
    const [block] = await db.select().from(proposalBlocks);
    let collected = false;
    await db.transaction(async (tx) => {
      // What createProposal holds while its rows are not visible yet.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${0x50524f50}, hashtext(${u.userId}))`);
      const gc = gcProposalBlocks(u.userId).then(() => {
        collected = true;
      });
      await Bun.sleep(200);
      expect(collected).toBe(false);
      const id = newId();
      await tx.insert(proposals).values({
        id,
        workspaceId: ws.id,
        userId: u.userId,
        agentName: 'Prop agent',
        agentCredential: 'pat:prop-token',
        message: '',
        status: 'open',
        baseCommitId: await headOf(ws),
        opCount: 1,
        bytesTotal: shared.length,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await tx.insert(proposalFiles).values({ proposalId: id, seq: 0, op: 'write', path: '/b.bin', entryType: 'file', size: shared.length, blockHashes: [block.sha256] });
      void gc;
    });
    for (let i = 0; i < 50 && !collected; i++) await Bun.sleep(20);
    expect(collected).toBe(true);
    expect((await db.select().from(proposalBlocks)).map((b) => b.sha256)).toEqual([block.sha256]);
  });

  test('listing pages by id cursor and filters by credential', async () => {
    for (const n of ['a', 'b', 'c']) await propose([{ op: 'mkdir', path: `/${n}` }]);
    const first = await listProposals(ws, u.userId, { status: 'open', limit: 2 });
    expect(first.proposals).toHaveLength(2);
    expect(first.nextCursor).toBe(first.proposals[1].id);
    const second = await listProposals(ws, u.userId, { status: 'open', limit: 2, before: first.nextCursor! });
    expect(second.proposals).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const other = await listProposals(ws, u.userId, { status: 'all', limit: 10, credential: 'pat:someone-else' });
    expect(other.proposals).toHaveLength(0);
    const mine = await db.select().from(proposals).where(and(eq(proposals.userId, u.userId), eq(proposals.agentCredential, p.credential)));
    expect(mine).toHaveLength(3);
  });
});

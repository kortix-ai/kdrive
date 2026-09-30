// Proposals: agent batches staged for the user's review (review mode).
// Nothing touches storage until Accept, which runs the batch engine as one
// undoable action attributed to the agent. Staged bytes live in Postgres as
// content-addressed 1 MiB blocks per user, deleted once no open proposal needs them.
import { and, asc, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import {
  basename,
  mimeFor,
  PROPOSAL_OPEN_MAX,
  PROPOSAL_STAGED_MAX,
  PROPOSAL_TTL_DAYS,
  TEXT_DIFF_MAX_BYTES,
  type AcceptProposalResponse,
  type ActionSummary,
  type DiscardProposalResponse,
  type ProposalChange,
  type ProposalCounts,
  type ProposalDetailResponse,
  type ProposalListResponse,
  type ProposalStatus,
  type ProposalSummary,
} from '@volumes/shared';
import type { AgentPrincipal } from '../agents/principal';
import { proposalUrl } from '../agents/urls';
import { db } from '../db/client';
import { proposalBlocks, proposalFiles, proposals, type ProposalFileRow, type ProposalRow } from '../db/schema';
import { audit } from '../lib/audit';
import { ApiError } from '../lib/http';
import { newId } from '../lib/ids';
import { withKeyLock } from '../lib/lock';
import { getStore } from '../storage';
import type { WorkspaceCtx } from '../types';
import {
  agentBatchSummary,
  applyAgentBatch,
  assertBase,
  guardConflicts,
  hashWrites,
  opFrom,
  opPath,
  simulate,
  staleBase,
  toGuardOp,
  type BatchOp,
} from './agent-batch';
import { createCheckpoint } from './checkpoints';
import type { ActionCtx } from './ledger';
import { sha256Hex } from './proven-blocks';
import { assertQuota } from './quota';
import { mapLimit } from './versioning-util';
import { compareKind, fileSideAt } from './versions';

export interface CreateProposalInput {
  ops: BatchOp[];
  baseCommitId: string;
  message: string;
  checkpointName: string | null;
}

/** An action context that may also say who to write in the audit log. */
type Ctx = ActionCtx & { email?: string | null; ip?: string | null };

const DAY_MS = 86_400_000;
const LOCK_PROPOSALS = 0x50524f50; // advisory lock namespace: a user's proposal allowance
const BLOCK_INSERT_ROWS = 16;

// ── shapes ──────────────────────────────────────────────────────────────────

/** How a staged op reads to the user. */
export function changeOf(f: Pick<ProposalFileRow, 'op' | 'baseSize' | 'baseVersion'>): ProposalChange {
  switch (f.op) {
    case 'write':
      return f.baseSize === null && f.baseVersion === null ? 'added' : 'modified';
    case 'mkdir':
      return 'folder';
    case 'move':
      return 'moved';
    case 'copy':
      return 'copied';
    default:
      return 'removed';
  }
}

type Tally = ProposalCounts & { pending: number };
const emptyTally = (): Tally => ({ added: 0, modified: 0, removed: 0, moved: 0, copied: 0, folders: 0, pending: 0 });

function tallyOf(files: Pick<ProposalFileRow, 'op' | 'baseSize' | 'baseVersion' | 'status'>[]): Tally {
  const t = emptyTally();
  for (const f of files) {
    const c = changeOf(f);
    if (c === 'folder') t.folders++;
    else t[c]++;
    if (f.status === 'pending') t.pending++;
  }
  return t;
}

/** Counts per proposal from its files (one grouped query). */
export async function talliesOf(ids: string[]): Promise<Map<string, Tally>> {
  const out = new Map<string, Tally>();
  if (!ids.length) return out;
  const rows = await db
    .select({
      id: proposalFiles.proposalId,
      op: proposalFiles.op,
      baseSize: proposalFiles.baseSize,
      baseVersion: proposalFiles.baseVersion,
      status: proposalFiles.status,
    })
    .from(proposalFiles)
    .where(inArray(proposalFiles.proposalId, ids));
  const by = new Map<string, typeof rows>();
  for (const r of rows) {
    const l = by.get(r.id) ?? [];
    l.push(r);
    by.set(r.id, l);
  }
  for (const id of ids) out.set(id, tallyOf(by.get(id) ?? []));
  return out;
}

export function toProposalSummary(row: ProposalRow, t: Tally): ProposalSummary {
  const { pending, ...counts } = t;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    agent: { kind: row.agentCredential.startsWith('pat:') ? 'token' : 'oauth', name: row.agentName, credential: row.agentCredential },
    message: row.message,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    baseCommitId: row.baseCommitId,
    opCount: row.opCount,
    bytesTotal: row.bytesTotal,
    counts,
    pending,
    url: proposalUrl(row.workspaceId, row.id),
  };
}

/** A decided proposal's status from its files (null while any is pending). */
export function statusOf(files: Pick<ProposalFileRow, 'status'>[]): ProposalStatus {
  if (files.some((f) => f.status === 'pending')) return 'open';
  const accepted = files.some((f) => f.status === 'accepted');
  const discarded = files.some((f) => f.status === 'discarded');
  if (accepted && discarded) return 'partial';
  return accepted ? 'accepted' : 'discarded';
}

// ── housekeeping ────────────────────────────────────────────────────────────

/**
 * Deletes staged blocks no open proposal of the user still needs. It takes the
 * lock createProposal holds while it inserts a proposal and its blocks, so a
 * proposal being created (whose rows are not visible yet) never loses a block
 * it shares with one that just closed.
 */
export async function gcProposalBlocks(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_PROPOSALS}, hashtext(${userId}))`);
    await tx.execute(sql`
      DELETE FROM proposal_blocks b WHERE b.user_id = ${userId} AND NOT EXISTS (
        SELECT 1 FROM proposal_files f JOIN proposals p ON p.id = f.proposal_id
        WHERE p.user_id = ${userId} AND p.status = 'open' AND f.status = 'pending' AND b.sha256 = ANY (f.block_hashes))`);
  });
}

/** Open proposals past their expiry become `expired` (and their blocks are collected). */
export async function expireDue(userId: string): Promise<void> {
  const rows = await db
    .update(proposals)
    .set({ status: 'expired', updatedAt: new Date(), decidedAt: new Date() })
    .where(and(eq(proposals.userId, userId), eq(proposals.status, 'open'), lt(proposals.expiresAt, new Date())))
    .returning({ id: proposals.id });
  if (rows.length) await gcProposalBlocks(userId);
}

// ── create ──────────────────────────────────────────────────────────────────

/** stat at a commit, or null when absent (a path under a file is absent too). */
async function statAt(ws: WorkspaceCtx, path: string, at: string) {
  try {
    return await getStore().stat(ws.volumeId, path, { at });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'path_not_found' || code === 'not_a_directory') return null;
    throw e;
  }
}

/**
 * Stages a batch as a proposal. It must be applicable when made: the guard
 * and every op are checked against the head, and the quota is checked (not
 * reserved) for the growth. Nothing touches storage.
 */
export async function createProposal(ctx: Ctx, p: AgentPrincipal, input: CreateProposalInput): Promise<ProposalRow> {
  const { ws, userId } = ctx;
  if (!input.ops.length) throw new ApiError(400, 'bad_request', 'Nothing to change.');
  const head = (await getStore().getVolume(ws.volumeId)).headCommitId;
  const base = await assertBase(ws, input.baseCommitId, head);
  const conflicts = await guardConflicts(ws, base, head, input.ops.map(toGuardOp));
  if (conflicts.length) throw staleBase(head, conflicts);
  const { hashed, blockBytes } = hashWrites(input.ops);
  const sim = await simulate(ws, head, input.ops, hashed);
  await assertQuota(userId, sim.growth);
  await expireDue(userId);

  const bytesTotal = input.ops.reduce((s, o) => s + (o.op === 'write' ? o.bytes.length : 0), 0);
  const baseStats = await mapLimit(input.ops, 8, (o) => statAt(ws, opPath(o), base));
  const id = newId();
  const now = new Date();
  const files = input.ops.map((o, seq) => {
    const step = sim.steps[seq];
    const st = baseStats[seq];
    const h = hashed.get(seq);
    return {
      proposalId: id,
      seq,
      op: o.op,
      path: opPath(o),
      fromPath: opFrom(o),
      entryType: step.entryType,
      size: o.op === 'write' ? o.bytes.length : step.size,
      blockHashes: h?.blocks ?? null,
      contentHash: h?.contentHash ?? null,
      mime: step.entryType === 'file' ? mimeFor(basename(opPath(o))) : null,
      baseVersion: st ? st.version : null,
      baseSize: st && st.type === 'file' ? st.size : null,
    };
  });

  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_PROPOSALS}, hashtext(${userId}))`);
    const [open] = await tx
      .select({ n: sql<number>`count(*)::int`, bytes: sql<string>`COALESCE(SUM(${proposals.bytesTotal}), 0)` })
      .from(proposals)
      .where(and(eq(proposals.userId, userId), eq(proposals.status, 'open')));
    if ((open?.n ?? 0) >= PROPOSAL_OPEN_MAX) {
      throw new ApiError(409, 'conflict', `You have ${PROPOSAL_OPEN_MAX} proposals waiting. Ask the user to review them first.`, { max: PROPOSAL_OPEN_MAX });
    }
    if (Number(open?.bytes ?? 0) + bytesTotal > PROPOSAL_STAGED_MAX) {
      throw new ApiError(413, 'payload_too_large', 'Proposals waiting for review already hold too much content. Ask the user to review them first.', {
        max: PROPOSAL_STAGED_MAX,
      });
    }
    const [inserted] = await tx
      .insert(proposals)
      .values({
        id,
        workspaceId: ws.id,
        userId,
        agentName: p.name,
        agentCredential: p.credential,
        message: input.message.slice(0, 500),
        status: 'open',
        baseCommitId: base,
        checkpointName: input.checkpointName,
        opCount: input.ops.length,
        bytesTotal,
        expiresAt: new Date(now.getTime() + PROPOSAL_TTL_DAYS * DAY_MS),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    for (let i = 0; i < files.length; i += 500) await tx.insert(proposalFiles).values(files.slice(i, i + 500));
    const blocks = [...blockBytes].map(([sha256, bytes]) => ({ userId, sha256, size: bytes.length, bytes }));
    for (let i = 0; i < blocks.length; i += BLOCK_INSERT_ROWS) {
      await tx.insert(proposalBlocks).values(blocks.slice(i, i + BLOCK_INSERT_ROWS)).onConflictDoNothing();
    }
    return inserted;
  });

  await audit(null, {
    kind: 'proposal.create',
    userId,
    actorEmail: ctx.email ?? p.user.email,
    ip: ctx.ip ?? null,
    workspaceId: ws.id,
    target: id,
    meta: { proposalId: id, credential: p.credential, agent: p.name, ops: input.ops.length },
  });
  return row;
}

// ── read ────────────────────────────────────────────────────────────────────

/** A proposal of this workspace and user, or 404. */
export async function loadProposal(ws: WorkspaceCtx, userId: string, id: string): Promise<ProposalRow> {
  const [row] = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.workspaceId, ws.id), eq(proposals.userId, userId)))
    .limit(1);
  if (!row) throw new ApiError(404, 'not_found', 'No such proposal.');
  return row;
}

export async function proposalFilesOf(id: string): Promise<ProposalFileRow[]> {
  return db.select().from(proposalFiles).where(eq(proposalFiles.proposalId, id)).orderBy(asc(proposalFiles.seq));
}

async function openCountOf(wsId: string, userId: string, credential?: string): Promise<number> {
  const conds = [eq(proposals.workspaceId, wsId), eq(proposals.userId, userId), eq(proposals.status, 'open')];
  if (credential) conds.push(eq(proposals.agentCredential, credential));
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(proposals)
    .where(and(...conds));
  return r?.n ?? 0;
}

export async function listProposals(
  ws: WorkspaceCtx,
  userId: string,
  q: { status: 'open' | 'closed' | 'all'; limit: number; before?: string; credential?: string },
): Promise<ProposalListResponse> {
  await expireDue(userId);
  const conds = [eq(proposals.workspaceId, ws.id), eq(proposals.userId, userId)];
  if (q.status === 'open') conds.push(eq(proposals.status, 'open'));
  else if (q.status === 'closed') conds.push(ne(proposals.status, 'open'));
  if (q.credential) conds.push(eq(proposals.agentCredential, q.credential));
  if (q.before) conds.push(lt(proposals.id, q.before));
  const limit = Math.min(Math.max(Math.trunc(q.limit) || 50, 1), 200);
  const rows = await db
    .select()
    .from(proposals)
    .where(and(...conds))
    .orderBy(desc(proposals.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const tallies = await talliesOf(page.map((r) => r.id));
  return {
    proposals: page.map((r) => toProposalSummary(r, tallies.get(r.id) ?? emptyTally())),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    openCount: await openCountOf(ws.id, userId, q.credential),
  };
}

/** Open proposals in a workspace (one indexed count). */
export async function proposalCount(ws: WorkspaceCtx, userId: string): Promise<number> {
  await expireDue(userId);
  return openCountOf(ws.id, userId);
}

/** The op a proposal file row stands for, without bytes (guard and display). */
function guardOpOf(f: ProposalFileRow) {
  return f.op === 'move' || f.op === 'copy' ? { op: f.op, path: f.path, from: f.fromPath ?? undefined } : { op: f.op, path: f.path };
}

export function proposedContentUrl(wsId: string, id: string, seq: number, download = false): string {
  return `/api/w/${encodeURIComponent(wsId)}/proposals/${encodeURIComponent(id)}/files/${seq}/content${download ? '?download=1' : ''}`;
}

export async function getProposalDetail(ws: WorkspaceCtx, userId: string, id: string): Promise<ProposalDetailResponse> {
  await expireDue(userId);
  const row = await loadProposal(ws, userId, id);
  const files = await proposalFilesOf(id);
  const head = (await getStore().getVolume(ws.volumeId)).headCommitId;
  let base = row.baseCommitId;
  let baseOk = true;
  try {
    base = await assertBase(ws, row.baseCommitId, head);
  } catch {
    baseOk = false; // the version the agent read is gone: every pending row counts as changed
  }
  const out = await mapLimit(files, 8, async (f) => {
    let conflict: ProposalDetailResponse['files'][number]['conflict'] = null;
    if (f.status === 'pending' && row.status === 'open') {
      if (!baseOk) conflict = { reason: 'changed', currentSize: null };
      else {
        const c = (await guardConflicts(ws, base, head, [guardOpOf(f)]))[0];
        if (c) conflict = { reason: c.reason, currentSize: c.current?.size ?? null };
      }
    }
    let compare: ProposalDetailResponse['files'][number]['compare'] = null;
    // Staged bytes are dropped once a proposal closes, so only an open one can
    // offer a "proposed" side to compare against.
    if (row.status === 'open' && (f.op === 'write' || f.op === 'delete') && f.entryType === 'file') {
      const kind = compareKind(f.path);
      const a = await fileSideAt(ws, f.path, head).catch(() => null);
      const b =
        f.op === 'write'
          ? {
              commitId: 'proposed',
              createdAt: row.createdAt.toISOString(),
              size: f.size ?? 0,
              mtime: row.createdAt.getTime(),
              mime: f.mime ?? mimeFor(basename(f.path)),
              version: null,
              contentUrl: proposedContentUrl(ws.id, id, f.seq),
              downloadUrl: proposedContentUrl(ws.id, id, f.seq, true),
            }
          : null;
      const tooLargeForDiff = (kind === 'text' || kind === 'csv') && [a, b].some((s) => !!s && s.size > TEXT_DIFF_MAX_BYTES);
      compare = { kind, a, b, tooLargeForDiff };
    }
    return {
      seq: f.seq,
      op: f.op,
      change: changeOf(f),
      path: f.path,
      fromPath: f.fromPath,
      entryType: f.entryType,
      size: f.size,
      baseSize: f.baseSize,
      mime: f.mime,
      status: f.status,
      conflict,
      compare,
    };
  });
  return {
    proposal: toProposalSummary(row, tallyOf(files)),
    files: out,
    headCommitId: head,
    conflicts: out.filter((f) => f.conflict).length,
  };
}

/** The staged bytes of a write op (re-hashed: a tampered block is never served as the proposal). */
export async function proposedBytes(userId: string, f: Pick<ProposalFileRow, 'blockHashes' | 'size'>): Promise<Uint8Array> {
  const shas = f.blockHashes ?? [];
  const want = [...new Set(shas)];
  const rows = want.length
    ? await db
        .select({ sha: proposalBlocks.sha256, bytes: proposalBlocks.bytes })
        .from(proposalBlocks)
        .where(and(eq(proposalBlocks.userId, userId), inArray(proposalBlocks.sha256, want)))
    : [];
  const by = new Map(rows.map((r) => [r.sha, r.bytes]));
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const sha of shas) {
    const b = by.get(sha);
    if (!b) throw new ApiError(404, 'not_found', 'The proposed content is no longer kept.');
    if (sha256Hex(b) !== sha) throw new ApiError(500, 'internal', 'A staged block did not match its hash.');
    parts.push(b);
    total += b.length;
  }
  if (total !== (f.size ?? 0)) throw new ApiError(500, 'internal', 'Staged content has the wrong size.');
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ── decide ──────────────────────────────────────────────────────────────────

/** Loads a proposal that can still be decided (404 / 409 `proposal_closed` otherwise). */
async function loadOpen(ws: WorkspaceCtx, userId: string, id: string): Promise<ProposalRow> {
  await expireDue(userId);
  const row = await loadProposal(ws, userId, id);
  if (row.status !== 'open') throw new ApiError(409, 'proposal_closed', 'This proposal was already decided.', { status: row.status });
  return row;
}

/** The chosen seqs: `seqs` (each must be pending), else every pending one. */
function choose(files: ProposalFileRow[], seqs: number[] | undefined): ProposalFileRow[] {
  const pending = files.filter((f) => f.status === 'pending');
  if (!seqs) {
    if (!pending.length) throw new ApiError(400, 'bad_request', 'Nothing is waiting in this proposal.');
    return pending;
  }
  const want = new Set(seqs);
  const bySeq = new Map(files.map((f) => [f.seq, f]));
  for (const s of want) {
    const f = bySeq.get(s);
    if (!f) throw new ApiError(400, 'bad_request', `This proposal has no change ${s}.`, { seq: s });
    if (f.status !== 'pending') throw new ApiError(400, 'bad_request', `Change ${s} was already decided.`, { seq: s });
  }
  if (!want.size) throw new ApiError(400, 'bad_request', 'Choose at least one change.');
  return files.filter((f) => want.has(f.seq));
}

/** Marks rows decided, recomputes the proposal's status and collects blocks once it closed. */
async function settle(row: ProposalRow, chosen: ProposalFileRow[], to: 'accepted' | 'discarded', action: ActionSummary | null): Promise<ProposalRow> {
  const seqs = chosen.map((f) => f.seq);
  const now = new Date();
  await db
    .update(proposalFiles)
    .set({ status: to, actionId: action?.id ?? null })
    .where(and(eq(proposalFiles.proposalId, row.id), inArray(proposalFiles.seq, seqs)));
  const files = await proposalFilesOf(row.id);
  const status = statusOf(files);
  const append = action && action.status === 'committed' ? action.id : null;
  const [updated] = await db
    .update(proposals)
    .set({
      status,
      updatedAt: now,
      decidedAt: status === 'open' ? null : now,
      ...(append ? { acceptedActionIds: sql`array_append(${proposals.acceptedActionIds}, ${append}::text)` } : {}),
    })
    .where(eq(proposals.id, row.id))
    .returning();
  if (status !== 'open') await gcProposalBlocks(row.userId);
  return updated;
}

export async function acceptProposal(ctx: Ctx, id: string, opts: { seqs?: number[]; force?: boolean }): Promise<AcceptProposalResponse> {
  const { ws, userId } = ctx;
  return withKeyLock(`proposal:${id}`, async () => {
    const row = await loadOpen(ws, userId, id);
    const files = await proposalFilesOf(id);
    const chosen = choose(files, opts.seqs);
    const ops: BatchOp[] = [];
    for (const f of chosen) {
      if (f.op === 'write') ops.push({ op: 'write', path: f.path, bytes: await proposedBytes(userId, f) });
      else if (f.op === 'move' || f.op === 'copy') ops.push({ op: f.op, from: f.fromPath!, to: f.path });
      else ops.push({ op: f.op, path: f.path });
    }
    const seqs = chosen.map((f) => f.seq);
    const { action } = await applyAgentBatch(
      { ws, userId, actor: { kind: 'agent', name: row.agentName, credential: row.agentCredential, proposalId: id } },
      {
        ops,
        baseCommitId: row.baseCommitId,
        force: !!opts.force,
        kind: 'proposal.accept',
        summary: `Accepted from ${row.agentName}: ${agentBatchSummary(ops, row.message)}`,
        meta: { proposalId: id, seqs, message: row.message },
      },
    );
    const updated = await settle(row, chosen, 'accepted', action);
    if (updated.status === 'accepted' && updated.checkpointName) {
      try {
        await createCheckpoint({ ws, userId }, { name: updated.checkpointName, note: updated.message });
      } catch (e) {
        console.warn('[proposals] checkpoint after accept failed', e instanceof Error ? e.message : e);
      }
    }
    await audit(null, {
      kind: 'proposal.accept',
      userId,
      actorEmail: ctx.email ?? null,
      ip: ctx.ip ?? null,
      workspaceId: ws.id,
      target: id,
      meta: { proposalId: id, actionId: action.id, seqs, forced: !!opts.force, agent: row.agentName },
    });
    return { proposal: toProposalSummary(updated, tallyOf(await proposalFilesOf(id))), action };
  });
}

export async function discardProposal(ctx: Ctx, id: string, opts: { seqs?: number[] }): Promise<DiscardProposalResponse> {
  const { ws, userId } = ctx;
  return withKeyLock(`proposal:${id}`, async () => {
    const row = await loadOpen(ws, userId, id);
    const files = await proposalFilesOf(id);
    const chosen = choose(files, opts.seqs);
    const updated = await settle(row, chosen, 'discarded', null);
    await audit(null, {
      kind: 'proposal.discard',
      userId,
      actorEmail: ctx.email ?? null,
      ip: ctx.ip ?? null,
      workspaceId: ws.id,
      target: id,
      meta: { proposalId: id, seqs: chosen.map((f) => f.seq), agent: row.agentName },
    });
    return { proposal: toProposalSummary(updated, tallyOf(await proposalFilesOf(id))) };
  });
}

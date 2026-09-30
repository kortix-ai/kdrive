// Proposals: agent batches staged for the user's review (review mode).
// (Builder B fills the bodies.)
import type {
  AcceptProposalResponse,
  DiscardProposalResponse,
  ProposalDetailResponse,
  ProposalListResponse,
} from '@volumes/shared';
import type { AgentPrincipal } from '../agents/principal';
import type { ProposalRow } from '../db/schema';
import { notImplemented } from '../lib/http';
import type { WorkspaceCtx } from '../types';
import type { BatchOp } from './agent-batch';
import type { ActionCtx } from './ledger';

export interface CreateProposalInput {
  ops: BatchOp[];
  baseCommitId: string;
  message: string;
  checkpointName: string | null;
}

export async function createProposal(_ctx: ActionCtx, _p: AgentPrincipal, _input: CreateProposalInput): Promise<ProposalRow> {
  throw notImplemented();
}

export async function listProposals(
  _ws: WorkspaceCtx,
  _userId: string,
  _q: { status: 'open' | 'closed' | 'all'; limit: number; before?: string; credential?: string },
): Promise<ProposalListResponse> {
  throw notImplemented();
}

export async function getProposalDetail(_ws: WorkspaceCtx, _userId: string, _id: string): Promise<ProposalDetailResponse> {
  throw notImplemented();
}

/** Open proposals in a workspace (one indexed count). */
export async function proposalCount(_ws: WorkspaceCtx, _userId: string): Promise<number> {
  throw notImplemented();
}

export async function acceptProposal(
  _ctx: ActionCtx,
  _id: string,
  _opts: { seqs?: number[]; force?: boolean },
): Promise<AcceptProposalResponse> {
  throw notImplemented();
}

export async function discardProposal(_ctx: ActionCtx, _id: string, _opts: { seqs?: number[] }): Promise<DiscardProposalResponse> {
  throw notImplemented();
}

/** Deletes staged blocks no open proposal of the user still needs. */
export async function gcProposalBlocks(_userId: string): Promise<void> {
  throw notImplemented();
}

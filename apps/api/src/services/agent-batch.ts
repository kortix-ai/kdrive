// The batch engine behind write_changes (direct mode) and proposal Accept:
// one ordered batch of ops = ONE ledger action, under the workspace lock, with
// quota reservation, guard against stale reads and link bookkeeping.
// (Builder B fills the bodies.)
import type { ActionSummary } from '@volumes/shared';
import { notImplemented } from '../lib/http';
import type { WorkspaceCtx } from '../types';
import type { ActionCtx } from './ledger';

export type BatchOp =
  | { op: 'write'; path: string; bytes: Uint8Array }
  | { op: 'mkdir'; path: string }
  | { op: 'move'; from: string; to: string }
  | { op: 'copy'; from: string; to: string }
  | { op: 'delete'; path: string };

export interface BatchInput {
  /** Normalised paths, validated shapes. */
  ops: BatchOp[];
  /** The guard base (last_seen_commit_id, or the proposal's base). */
  baseCommitId: string;
  /** Accept "anyway": skip the guard (still validates against head). */
  force?: boolean;
  kind: 'agent.batch' | 'proposal.accept';
  /** Timeline text. */
  summary: string;
  meta: Record<string, unknown>;
}

export interface OpResult {
  index: number;
  op: BatchOp['op'];
  path: string;
  fromPath: string | null;
  result: 'created' | 'replaced' | 'unchanged' | 'moved' | 'copied' | 'deleted' | 'folder';
  size: number | null;
}

export type GuardOp = { op: BatchOp['op']; path: string; from?: string };

export type Conflict = {
  path: string;
  reason: 'changed' | 'created' | 'deleted' | 'type';
  current: { type: 'file' | 'dir'; size: number; version: string | null } | null;
};

export async function applyAgentBatch(_ctx: ActionCtx, _input: BatchInput): Promise<{ action: ActionSummary; results: OpResult[] }> {
  throw notImplemented();
}

/** Paths the batch touches that changed between `base` and `head`. */
export async function guardConflicts(_ws: WorkspaceCtx, _base: string, _head: string, _ops: GuardOp[]): Promise<Conflict[]> {
  throw notImplemented();
}

/** The read-only checks of a batch against `head` (no lock, no quota reservation); returns the growth in bytes. */
export async function validateBatch(_ws: WorkspaceCtx, _head: string, _ops: BatchOp[]): Promise<{ growth: number }> {
  throw notImplemented();
}

/** Timeline text for a batch: the agent's message, else a generated summary. */
export function agentBatchSummary(_ops: BatchOp[], _message: string): string {
  throw notImplemented();
}

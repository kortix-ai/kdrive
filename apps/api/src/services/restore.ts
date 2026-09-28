// STUB (FOUNDATION). Owner: API-versioning. Replace the bodies; keep the exported names and signatures.
import type { ActionKind, ActionSummary, RestoreResponse } from '@volumes/shared';
import { notImplemented } from '../lib/http';
import type { Ref } from '../storage/types';
import type { ActionCtx } from './ledger';

/** Restores files / folders to `at` as one action (re-uploads old block lists; removes later additions). */
export async function restorePaths(
  ctx: ActionCtx,
  opts: { paths: string[]; at: Ref; kind: ActionKind; summary: string; undoOfActionId?: string },
): Promise<ActionSummary> {
  throw notImplemented();
}

/** Restores the whole drive (volume restore), auto-checkpointing the current head first. */
export async function restoreDrive(
  ctx: ActionCtx,
  at: Ref,
  opts?: { undoOfActionId?: string; autoCheckpoint?: boolean },
): Promise<RestoreResponse> {
  throw notImplemented();
}

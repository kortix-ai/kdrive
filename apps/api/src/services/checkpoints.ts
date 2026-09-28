// STUB (FOUNDATION). Owner: API-versioning. Replace the bodies; keep the exported names and signatures.
import type { Checkpoint } from '@volumes/shared';
import { notImplemented } from '../lib/http';
import type { Ref } from '../storage/types';
import type { ActionCtx } from './ledger';

/** Tags `at` (default head) as `cp-<id>` and records the checkpoint row. */
export async function createCheckpoint(
  ctx: ActionCtx,
  input: { name: string; note?: string; at?: Ref; auto?: boolean },
): Promise<Checkpoint> {
  throw notImplemented();
}

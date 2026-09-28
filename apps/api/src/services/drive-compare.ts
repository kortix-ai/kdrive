// STUB (FOUNDATION). Owner: API-versioning. Replace the bodies; keep the exported names and signatures.
import type { CompareDriveResponse } from '@volumes/shared';
import { notImplemented } from '../lib/http';
import type { Ref } from '../storage/types';
import type { WorkspaceCtx } from '../types';

/** Added / removed / changed / moved paths between two versions (ledger, else tree diff). */
export async function compareDrive(ws: WorkspaceCtx, a: Ref, b: Ref): Promise<CompareDriveResponse> {
  throw notImplemented();
}

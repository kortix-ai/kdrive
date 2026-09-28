// STUB (FOUNDATION). Owner: API-versioning. Replace the bodies; keep the exported names and signatures.
import type { VersionsResponse } from '@volumes/shared';
import { notImplemented } from '../lib/http';
import type { WorkspaceCtx } from '../types';

/** Every version of `path` still in history (ledger first, commit-chain fallback). */
export async function fileVersions(ws: WorkspaceCtx, path: string): Promise<VersionsResponse> {
  throw notImplemented();
}

// STUB (FOUNDATION). Owner: API-versioning. Replace the bodies; keep the exported names and signatures.
import type { TimelineResponse } from '@volumes/shared';
import { notImplemented } from '../lib/http';
import type { WorkspaceCtx } from '../types';

/** Timeline entries (one per action, newest first). See architecture §9.2. */
export async function buildTimeline(ws: WorkspaceCtx, opts: { limit: number; before?: string }): Promise<TimelineResponse> {
  throw notImplemented();
}

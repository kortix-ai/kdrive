// STUB (FOUNDATION). Owner: API-files. Replace the bodies; keep the exported names and signatures.
import type { SearchResponse } from '@volumes/shared';
import { notImplemented } from '../lib/http';
import type { WorkspaceCtx } from '../types';

/** Case-insensitive basename search over listTree(ws, '/', at), prefix matches first. */
export async function searchFiles(ws: WorkspaceCtx, q: string, at: string | undefined, limit: number): Promise<SearchResponse> {
  throw notImplemented();
}

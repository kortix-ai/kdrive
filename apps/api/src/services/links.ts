// STUB (FOUNDATION). Owner: API-sharing-workspaces-admin. Replace the bodies; keep the exported names and signatures.
import type { ShareLinkRow } from '../db/schema';
import { notImplemented } from '../lib/http';
import type { WorkspaceCtx } from '../types';

/** Resolves a public token: 404 unknown, 410 link_revoked / link_expired; `at` = pinned commit or undefined (live). */
export async function resolvePublicLink(token: string): Promise<{ link: ShareLinkRow; ws: WorkspaceCtx; at: string | undefined }> {
  throw notImplemented();
}

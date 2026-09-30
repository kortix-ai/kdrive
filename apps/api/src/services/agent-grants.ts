// Connected apps: our side of OAuth grants (agent_grants). (Builder A fills the bodies.)
import type { AgentMode, AgentScope, ConnectedApp } from '@volumes/shared';
import type { AgentGrantRow } from '../db/schema';
import { notImplemented } from '../lib/http';

/** A client-supplied name made safe to show: control chars stripped, at most 80 chars, a fallback when empty. */
export function sanitizeClientName(_name: string | null | undefined): string {
  throw notImplemented();
}

/** The user's live grants as connected apps. */
export async function listConnectedApps(_userId: string): Promise<ConnectedApp[]> {
  throw notImplemented();
}

/** Creates or replaces the user's grant for a client (clears revoked_at). */
export async function upsertGrant(
  _userId: string,
  _input: { clientId: string; clientName: string; scope: AgentScope; mode: AgentMode; workspaceId: string | null },
): Promise<{ grant: AgentGrantRow; created: boolean }> {
  throw notImplemented();
}

/** Revokes a grant: its refresh tokens, stored access tokens and consents go too. */
export async function revokeGrant(_userId: string, _grantId: string): Promise<void> {
  throw notImplemented();
}

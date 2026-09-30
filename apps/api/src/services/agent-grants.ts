// Connected apps: our side of OAuth grants (agent_grants). The OAuth provider
// owns clients, consents and tokens; a grant records what the user chose on
// the consent page (access level, mode, workspace) and is checked live on every
// /mcp request, so revoking it stops the app at once.
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { AgentMode, AgentScope, ConnectedApp } from '@volumes/shared';
import { db } from '../db/client';
import {
  agentGrants,
  bauthOAuthAccessToken,
  bauthOAuthClient,
  bauthOAuthConsent,
  bauthOAuthRefreshToken,
  workspaces,
  type AgentGrantRow,
} from '../db/schema';
import { ApiError } from '../lib/http';
import { newId } from '../lib/ids';

export const CLIENT_NAME_MAX = 80;
export const UNNAMED_APP = 'Unnamed app';

// C0/C1 controls, zero-width and bidi overrides: nothing that can hide or reorder text.
function hex4(n: number): string {
  return n.toString(16).padStart(4, '0');
}
const UNSAFE_CHARS = new RegExp(
  '[' + [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]].map(([a, b]) => `\\u${hex4(a)}-\\u${hex4(b)}`).join('') + ']',
  'g',
);

/** A client-supplied name made safe to show: control chars stripped, at most 80 chars, a fallback when empty. */
export function sanitizeClientName(name: string | null | undefined): string {
  if (typeof name !== 'string') return UNNAMED_APP;
  const clean = name.replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim();
  if (!clean) return UNNAMED_APP;
  const chars = Array.from(clean);
  return chars.length > CLIENT_NAME_MAX ? chars.slice(0, CLIENT_NAME_MAX).join('').trimEnd() : clean;
}

/** The host a redirect URI points at ("localhost:8765"), or its scheme for app links ("myapp"); null when unparseable. */
export function redirectHostOf(uri: string | null | undefined): string | null {
  if (!uri) return null;
  try {
    const u = new URL(uri);
    return u.host || u.protocol.replace(/:$/, '') || null;
  } catch {
    return null;
  }
}

type GrantJoin = { g: AgentGrantRow; redirectUris: string[] | null; workspaceName: string | null };

function toConnectedApp({ g, redirectUris, workspaceName }: GrantJoin): ConnectedApp {
  return {
    id: g.id,
    clientId: g.clientId,
    name: g.clientName,
    redirectHost: redirectHostOf(redirectUris?.[0]),
    scope: g.scope,
    mode: g.scope === 'drive:write' ? g.mode : 'review',
    workspaceId: g.workspaceId,
    workspaceName: g.workspaceId ? workspaceName : null,
    createdAt: g.createdAt.toISOString(),
    lastUsedAt: g.lastUsedAt ? g.lastUsedAt.toISOString() : null,
  };
}

function grantQuery() {
  return db
    .select({ g: agentGrants, redirectUris: bauthOAuthClient.redirectUris, workspaceName: workspaces.name })
    .from(agentGrants)
    .leftJoin(bauthOAuthClient, eq(bauthOAuthClient.clientId, agentGrants.clientId))
    .leftJoin(workspaces, eq(workspaces.id, agentGrants.workspaceId))
    .$dynamic();
}

/** The user's live grants as connected apps, newest first. */
export async function listConnectedApps(userId: string): Promise<ConnectedApp[]> {
  const rows = await grantQuery()
    .where(and(eq(agentGrants.userId, userId), isNull(agentGrants.revokedAt)))
    .orderBy(desc(agentGrants.createdAt));
  return rows.map(toConnectedApp);
}

/** One live grant of the user as a connected app (by grant id or client id), or null. */
export async function getConnectedApp(userId: string, by: { id: string } | { clientId: string }): Promise<ConnectedApp | null> {
  const match = 'id' in by ? eq(agentGrants.id, by.id) : eq(agentGrants.clientId, by.clientId);
  const [row] = await grantQuery()
    .where(and(eq(agentGrants.userId, userId), match, isNull(agentGrants.revokedAt)))
    .limit(1);
  return row ? toConnectedApp(row) : null;
}

/** The user's live grant row `grantId`, or a 404. */
export async function liveGrant(userId: string, grantId: string): Promise<AgentGrantRow> {
  const [row] = await db
    .select()
    .from(agentGrants)
    .where(and(eq(agentGrants.id, grantId), eq(agentGrants.userId, userId), isNull(agentGrants.revokedAt)))
    .limit(1);
  if (!row) throw new ApiError(404, 'not_found', 'No such app.');
  return row;
}

/**
 * Creates or replaces the user's grant for a client (clears revoked_at).
 * `created` is true when there was no live grant before (new, or reconnecting
 * after a disconnect, which also restarts its "connected" date).
 */
export async function upsertGrant(
  userId: string,
  input: { clientId: string; clientName: string; scope: AgentScope; mode: AgentMode; workspaceId: string | null },
): Promise<{ grant: AgentGrantRow; created: boolean }> {
  const mode: AgentMode = input.scope === 'drive:write' ? input.mode : 'review';
  const clientName = sanitizeClientName(input.clientName);
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ id: agentGrants.id, revokedAt: agentGrants.revokedAt })
      .from(agentGrants)
      .where(and(eq(agentGrants.userId, userId), eq(agentGrants.clientId, input.clientId)))
      .for('update')
      .limit(1);
    const created = !before || before.revokedAt !== null;
    const now = new Date();
    const values = { clientName, scope: input.scope, mode, workspaceId: input.workspaceId, revokedAt: null, updatedAt: now };
    const [grant] = before
      ? await tx
          .update(agentGrants)
          .set({ ...values, ...(created ? { createdAt: now, lastUsedAt: null } : {}) })
          .where(eq(agentGrants.id, before.id))
          .returning()
      : await tx
          .insert(agentGrants)
          .values({ id: newId(), userId, clientId: input.clientId, ...values, createdAt: now })
          .returning();
    return { grant, created };
  });
}

/** Changes a live grant's access (the caller has validated the new values). */
export async function updateGrant(
  userId: string,
  grantId: string,
  patch: { scope: AgentScope; mode: AgentMode; workspaceId: string | null },
): Promise<AgentGrantRow> {
  const [row] = await db
    .update(agentGrants)
    .set({ ...patch, mode: patch.scope === 'drive:write' ? patch.mode : 'review', updatedAt: new Date() })
    .where(and(eq(agentGrants.id, grantId), eq(agentGrants.userId, userId), isNull(agentGrants.revokedAt)))
    .returning();
  if (!row) throw new ApiError(404, 'not_found', 'No such app.');
  return row;
}

/**
 * Forgets the provider's stored consent for (user, client), so the next
 * authorization shows our consent page again instead of issuing a code silently.
 */
export async function forgetProviderConsent(userId: string, clientId: string): Promise<void> {
  await db.delete(bauthOAuthConsent).where(and(eq(bauthOAuthConsent.userId, userId), eq(bauthOAuthConsent.clientId, clientId)));
}

/**
 * Revokes a grant: its refresh tokens, stored access tokens and consents go too,
 * so the app must ask again (consent) to reconnect. Returns the row and whether
 * this call revoked it (false when it already was: idempotent). 404 for another user's id.
 */
export async function revokeGrant(userId: string, grantId: string): Promise<{ grant: AgentGrantRow; revoked: boolean }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(agentGrants)
      .where(and(eq(agentGrants.id, grantId), eq(agentGrants.userId, userId)))
      .for('update')
      .limit(1);
    if (!row) throw new ApiError(404, 'not_found', 'No such app.');
    const now = new Date();
    const [grant] = row.revokedAt
      ? [row]
      : await tx.update(agentGrants).set({ revokedAt: now, updatedAt: now }).where(eq(agentGrants.id, row.id)).returning();
    const own = (t: typeof bauthOAuthConsent | typeof bauthOAuthAccessToken | typeof bauthOAuthRefreshToken) =>
      and(eq(t.userId, userId), eq(t.clientId, row.clientId));
    await tx.delete(bauthOAuthConsent).where(own(bauthOAuthConsent));
    await tx.delete(bauthOAuthAccessToken).where(own(bauthOAuthAccessToken));
    await tx
      .update(bauthOAuthRefreshToken)
      .set({ revoked: now })
      .where(and(own(bauthOAuthRefreshToken), isNull(bauthOAuthRefreshToken.revoked)));
    return { grant, revoked: !row.revokedAt };
  });
}

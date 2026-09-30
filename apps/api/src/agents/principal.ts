// Who is calling /mcp: an agent token (vx_pat_…) or an OAuth access token (a
// JWT issued by our provider for the MCP resource). Everything is checked live
// on every request, so a revoked token or grant, a disabled client or a deleted
// user stops working on the very next call.
import { and, eq, gt, isNull } from 'drizzle-orm';
import { createLocalJWKSet, errors as joseErrors, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose';
import type { AgentMode, AgentRef, AgentScope } from '@volumes/shared';
import { auth } from '../auth';
import { db } from '../db/client';
import { agentGrants, agentTokens, bauthOAuthClient, bauthUser, type WorkspaceRow } from '../db/schema';
import { ApiError } from '../lib/http';
import { ensureUserBootstrap, getWorkspaceForUser, listWorkspaces, toCtx } from '../services/workspaces';
import type { SessionUser, WorkspaceCtx } from '../types';
import { effectiveMode, highestScope, scopeLevel } from './scopes';
import { hashAgentToken, looksLikeAgentToken } from './tokens';
import { MCP_RESOURCE, OAUTH_ISSUER } from './urls';

export interface AgentPrincipal {
  kind: 'token' | 'oauth';
  /** 'pat:<tokenId>' | 'oauth:<clientId>' */
  credential: string;
  /** agent_tokens.id | agent_grants.id */
  grantId: string;
  /** Token name | the grant's client name. */
  name: string;
  user: SessionUser;
  /** Effective scope. */
  scope: AgentScope;
  /** effectiveMode(scope, stored mode). */
  mode: AgentMode;
  /** Workspace restriction (null = every workspace of the user). */
  workspaceId: string | null;
}

export type PrincipalFailure = { status: 401 | 403; code: 'unauthorized' | 'insufficient_scope'; message: string };

const MAX_CREDENTIAL = 4096;
const TOUCH_EVERY_MS = 60_000;
const JWKS_TTL_MS = 5 * 60_000;
const WS_ID = /^[0-9a-z]{26}$/;

const unauthorized = (message = 'Missing or invalid access token.'): PrincipalFailure => ({ status: 401, code: 'unauthorized', message });
const WRONG_TOKEN = `Use an access token issued for this server (request it with resource=${MCP_RESOURCE}).`;

export function isPrincipalFailure(r: AgentPrincipal | PrincipalFailure): r is PrincipalFailure {
  return 'status' in r;
}

// ── last-used bookkeeping (at most once a minute per credential) ─────────────

const touched = new Map<string, number>();

function shouldTouch(key: string): boolean {
  const now = Date.now();
  const last = touched.get(key);
  if (last !== undefined && now - last < TOUCH_EVERY_MS) return false;
  touched.set(key, now);
  if (touched.size > 10_000) {
    for (const [k, t] of touched) if (now - t >= TOUCH_EVERY_MS) touched.delete(k);
  }
  return true;
}

const logTouch = (e: unknown) => console.warn('[agents] last-used update failed', e instanceof Error ? e.message : e);

// ── JWKS (our own keys, read in-process; never an HTTP self-call) ───────────

let jwksCache: { set: ReturnType<typeof createLocalJWKSet>; at: number } | null = null;

async function localJwks(refresh = false): Promise<ReturnType<typeof createLocalJWKSet>> {
  if (!refresh && jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.set;
  const keys = (await auth.api.getJwks()) as unknown as JSONWebKeySet;
  jwksCache = { set: createLocalJWKSet(keys), at: Date.now() };
  return jwksCache.set;
}

/** Forgets the cached key set (tests that rotate keys). */
export function clearJwksCache(): void {
  jwksCache = null;
}

async function verifyAccessToken(token: string): Promise<JWTPayload | null> {
  const opts = { issuer: OAUTH_ISSUER, audience: MCP_RESOURCE, algorithms: ['ES256'] };
  try {
    return (await jwtVerify(token, await localJwks(), opts)).payload;
  } catch (e) {
    if (!(e instanceof joseErrors.JWKSNoMatchingKey)) return null;
  }
  // A key minted since the cache was filled: refresh once.
  try {
    return (await jwtVerify(token, await localJwks(true), opts)).payload;
  } catch {
    return null;
  }
}

// ── resolution ──────────────────────────────────────────────────────────────

async function userRow(id: string): Promise<SessionUser | null> {
  const [u] = await db
    .select({ id: bauthUser.id, email: bauthUser.email, name: bauthUser.name, image: bauthUser.image })
    .from(bauthUser)
    .where(eq(bauthUser.id, id))
    .limit(1);
  return u ?? null;
}

async function fromAgentToken(secret: string, ip: string | null): Promise<AgentPrincipal | PrincipalFailure> {
  const [row] = await db
    .select({ t: agentTokens, u: { id: bauthUser.id, email: bauthUser.email, name: bauthUser.name, image: bauthUser.image } })
    .from(agentTokens)
    .innerJoin(bauthUser, eq(bauthUser.id, agentTokens.userId))
    .where(and(eq(agentTokens.tokenHash, hashAgentToken(secret)), isNull(agentTokens.revokedAt), gt(agentTokens.expiresAt, new Date())))
    .limit(1);
  if (!row) return unauthorized('This agent token is not valid (unknown, expired or revoked).');
  const t = row.t;
  if (shouldTouch(`pat:${t.id}`)) {
    void db
      .update(agentTokens)
      .set({ lastUsedAt: new Date(), lastUsedIp: ip })
      .where(eq(agentTokens.id, t.id))
      .catch(logTouch);
  }
  return {
    kind: 'token',
    credential: `pat:${t.id}`,
    grantId: t.id,
    name: t.name,
    user: row.u,
    scope: t.scope,
    mode: effectiveMode(t.scope, t.mode),
    workspaceId: t.workspaceId,
  };
}

async function fromAccessToken(jwt: string): Promise<AgentPrincipal | PrincipalFailure> {
  const payload = await verifyAccessToken(jwt);
  if (!payload) return unauthorized(WRONG_TOKEN);
  const { sub, azp, scope } = payload as JWTPayload & { azp?: unknown; scope?: unknown };
  if (typeof sub !== 'string' || typeof azp !== 'string' || typeof scope !== 'string' || !sub || !azp) return unauthorized(WRONG_TOKEN);
  const [clients, grants, user] = await Promise.all([
    db
      .select({ id: bauthOAuthClient.id })
      .from(bauthOAuthClient)
      .where(and(eq(bauthOAuthClient.clientId, azp), eq(bauthOAuthClient.disabled, false)))
      .limit(1),
    db
      .select()
      .from(agentGrants)
      .where(and(eq(agentGrants.userId, sub), eq(agentGrants.clientId, azp), isNull(agentGrants.revokedAt)))
      .limit(1),
    userRow(sub),
  ]);
  const grant = grants[0];
  if (!clients.length || !grant || !user) return unauthorized('This app is no longer connected. Connect it again.');
  const asked = highestScope(scope);
  if (!asked) return { status: 403, code: 'insufficient_scope', message: 'This token grants no drive access.' };
  const effective = scopeLevel(asked) <= scopeLevel(grant.scope) ? asked : grant.scope;
  if (shouldTouch(`oauth:${grant.id}`)) {
    void db.update(agentGrants).set({ lastUsedAt: new Date() }).where(eq(agentGrants.id, grant.id)).catch(logTouch);
  }
  return {
    kind: 'oauth',
    credential: `oauth:${azp}`,
    grantId: grant.id,
    name: grant.clientName,
    user,
    scope: effective,
    mode: effectiveMode(effective, grant.mode),
    workspaceId: grant.workspaceId,
  };
}

/**
 * Resolves the `Authorization` header of an /mcp request. Only bearer
 * credentials count (cookies are never looked at): an agent token, or a JWT
 * our provider issued for MCP_RESOURCE with a live client and grant.
 */
export async function resolvePrincipal(
  authorization: string | undefined | null,
  opts: { ip?: string | null } = {},
): Promise<AgentPrincipal | PrincipalFailure> {
  if (!authorization) return unauthorized();
  const m = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
  if (!m) return unauthorized();
  const x = m[1];
  if (x.length > MAX_CREDENTIAL) return unauthorized();
  if (looksLikeAgentToken(x)) return fromAgentToken(x, opts.ip ?? null);
  if (x.split('.').length === 3) return fromAccessToken(x);
  return unauthorized(WRONG_TOKEN);
}

/**
 * The rate-limit key of a principal: its token, or its user's grant for an
 * OAuth client. A client id is public and shared by every user of the app, so
 * one user's traffic must never drain another user's budget.
 */
export function rateKeyOf(p: Pick<AgentPrincipal, 'kind' | 'grantId'>): string {
  return p.kind === 'token' ? `pat:${p.grantId}` : `grant:${p.grantId}`;
}

export function agentRef(p: AgentPrincipal): AgentRef {
  return { kind: p.kind, name: p.name, credential: p.credential };
}

/** The user's live workspaces this principal may use (all, or the one it is restricted to). */
export async function principalWorkspaces(p: AgentPrincipal): Promise<WorkspaceRow[]> {
  const rows = await listWorkspaces(p.user.id);
  return p.workspaceId ? rows.filter((r) => r.id === p.workspaceId) : rows;
}

/**
 * The workspace a tool call acts on: `wsId`, else the restricted workspace,
 * else the user's default. Unknown, deleted, foreign or outside the restriction
 * all answer the same 404 (never revealing that a workspace exists). Opens the
 * volume like requireWorkspace.
 */
export async function principalWorkspace(p: AgentPrincipal, wsId: string | undefined): Promise<WorkspaceCtx> {
  const notFound = () => new ApiError(404, 'not_found', 'No such workspace.');
  const want = wsId ?? p.workspaceId;
  if (want) {
    if (p.workspaceId && want !== p.workspaceId) throw notFound();
    const ws = WS_ID.test(want) ? await getWorkspaceForUser(p.user.id, want) : null;
    if (!ws) throw notFound();
    return ws;
  }
  return toCtx(await ensureUserBootstrap({ id: p.user.id }));
}

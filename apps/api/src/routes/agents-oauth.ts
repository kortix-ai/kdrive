// Connected apps (OAuth grants) and the consent page's API, mounted at /api/agents.
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import {
  ConnectedAppListResponse,
  ConnectedAppResponse,
  OAuthConsentDecision,
  OAuthConsentInfo,
  OAuthConsentInfoQuery,
  OAuthConsentResult,
  UpdateConnectedAppRequest,
  type AgentMode,
  type AgentScope,
} from '@volumes/shared';
import { OAUTH_IDENTITY_SCOPES, highestScope, isAgentScope, scopeLevel } from '../agents/scopes';
import { auth } from '../auth';
import { db } from '../db/client';
import { bauthOAuthClient } from '../db/schema';
import { audit } from '../lib/audit';
import { ApiError, badRequest, noContent, ok, parseJson, parseQuery } from '../lib/http';
import {
  forgetProviderConsent,
  getConnectedApp,
  listConnectedApps,
  liveGrant,
  redirectHostOf,
  revokeGrant,
  sanitizeClientName,
  updateGrant,
  upsertGrant,
} from '../services/agent-grants';
import { ensureUserBootstrap, listWorkspaces } from '../services/workspaces';
import type { AppEnv } from '../types';
import { ownWorkspaceName } from './agent-tokens';

export const agentsOauthRoutes = new Hono<AppEnv>();

export const EXPIRED_REQUEST = 'This authorization request expired. Start again from your app.';

const IDENTITY = new Set<string>(OAUTH_IDENTITY_SCOPES);

/** The authorization request carried by the consent page's (signed) query. Display only: the provider verifies it. */
export function parseOAuthQuery(raw: string) {
  const q = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
  const scopes = (q.get('scope') ?? '').split(/\s+/).filter(Boolean);
  const exp = Number(q.get('exp'));
  return {
    clientId: q.get('client_id'),
    redirectUri: q.get('redirect_uri'),
    scopes,
    /** The highest drive scope requested (read when none is). */
    requested: highestScope(scopes.join(' ')) ?? ('drive:read' as AgentScope),
    identity: scopes.filter((s) => IDENTITY.has(s)),
    signed: q.has('sig'),
    expired: Number.isFinite(exp) && exp > 0 && exp * 1000 < Date.now(),
  };
}

/**
 * The scopes to accept for a chosen level: every requested identity scope and
 * every requested drive scope up to the level. When the app asked only for
 * higher drive scopes, its lowest one is kept (the grant caps it to the chosen
 * level on every request), because the provider accepts only requested scopes.
 */
export function acceptedScopes(requested: string[], level: AgentScope): string[] {
  const drive = requested.filter(isAgentScope);
  const keep = drive.filter((s) => scopeLevel(s) <= scopeLevel(level));
  if (!keep.length && drive.length) keep.push(drive.reduce((a, b) => (scopeLevel(a) <= scopeLevel(b) ? a : b)));
  return requested.filter((s) => IDENTITY.has(s) || keep.includes(s as AgentScope));
}

async function liveClient(clientId: string | null) {
  if (!clientId) throw new ApiError(404, 'not_found', 'This app is not registered. Start again from your app.');
  const [client] = await db
    .select({ clientId: bauthOAuthClient.clientId, name: bauthOAuthClient.name, uri: bauthOAuthClient.uri, redirectUris: bauthOAuthClient.redirectUris })
    .from(bauthOAuthClient)
    .where(and(eq(bauthOAuthClient.clientId, clientId), eq(bauthOAuthClient.disabled, false)))
    .limit(1);
  if (!client) throw new ApiError(404, 'not_found', 'This app is not registered. Start again from your app.');
  return client;
}

/** Where the code will go: the request's redirect URI when it is one the app registered, else the first registered one. */
function shownRedirectHost(registered: string[], requested: string | null): string | null {
  const host = redirectHostOf(requested);
  if (host && requested && registered.some((r) => r === requested || redirectHostOf(r)?.split(':')[0] === host.split(':')[0])) return host;
  return redirectHostOf(registered[0]);
}

/** A client-supplied URI shown as text only: http(s) and short, else nothing. */
function displayUri(uri: string | null): string | null {
  if (!uri || uri.length > 300) return null;
  try {
    const u = new URL(uri);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function hasCode(url: string): boolean {
  try {
    return new URL(url).searchParams.has('code');
  } catch {
    return false;
  }
}

// ── connected apps ──────────────────────────────────────────────────────────

/** GET /api/agents/apps → ConnectedAppListResponse */
agentsOauthRoutes.get('/apps', async (c) => ok(c, ConnectedAppListResponse, { apps: await listConnectedApps(c.get('user').id) }));

/** PATCH /api/agents/apps/:id UpdateConnectedAppRequest → ConnectedAppResponse (access may only go down). */
agentsOauthRoutes.patch('/apps/:id', async (c) => {
  const user = c.get('user');
  const req = await parseJson(c, UpdateConnectedAppRequest);
  const grant = await liveGrant(user.id, c.req.param('id'));
  const scope = req.scope ?? grant.scope;
  if (scopeLevel(scope) > scopeLevel(grant.scope)) throw badRequest('Access can only be lowered here. Connect the app again to give it more.');
  if (req.mode === 'direct' && scope !== 'drive:write') throw badRequest('Only apps that can make changes can apply them directly.');
  const mode: AgentMode = scope === 'drive:write' ? (req.mode ?? grant.mode) : 'review';
  const workspaceId = req.workspaceId === undefined ? grant.workspaceId : req.workspaceId;
  if (workspaceId && workspaceId !== grant.workspaceId) await ownWorkspaceName(user.id, workspaceId);
  const row = await updateGrant(user.id, grant.id, { scope, mode, workspaceId });
  await audit(c, {
    kind: 'agent.grant.update',
    userId: user.id,
    workspaceId: row.workspaceId,
    target: row.id,
    meta: { clientId: row.clientId, scope: row.scope, mode: row.mode, workspaceId: row.workspaceId },
  });
  const app = await getConnectedApp(user.id, { id: row.id });
  if (!app) throw new ApiError(404, 'not_found', 'No such app.');
  return ok(c, ConnectedAppResponse, { app });
});

/** DELETE /api/agents/apps/:id → 204: the grant, its consents and its tokens stop working now. */
agentsOauthRoutes.delete('/apps/:id', async (c) => {
  const user = c.get('user');
  const { grant, revoked } = await revokeGrant(user.id, c.req.param('id'));
  if (!revoked) return noContent(c);
  await audit(c, {
    kind: 'agent.grant.revoke',
    userId: user.id,
    workspaceId: grant.workspaceId,
    target: grant.id,
    meta: { clientId: grant.clientId, name: grant.clientName },
  });
  return noContent(c);
});

// ── consent ─────────────────────────────────────────────────────────────────

/** GET /api/agents/oauth/consent-info?oauth_query=… → OAuthConsentInfo */
agentsOauthRoutes.get('/oauth/consent-info', async (c) => {
  const user = c.get('user');
  const { oauth_query } = parseQuery(c, OAuthConsentInfoQuery);
  const q = parseOAuthQuery(oauth_query);
  if (!q.signed || q.expired) throw badRequest(EXPIRED_REQUEST);
  const client = await liveClient(q.clientId);
  // A brand-new account can reach consent before anything opened its drive (sign-up no longer provisions one).
  await ensureUserBootstrap(user);
  const [rows, existing] = await Promise.all([listWorkspaces(user.id), getConnectedApp(user.id, { clientId: client.clientId })]);
  return ok(c, OAuthConsentInfo, {
    client: {
      clientId: client.clientId,
      name: sanitizeClientName(client.name),
      uri: displayUri(client.uri),
      redirectHost: shownRedirectHost(client.redirectUris ?? [], q.redirectUri),
    },
    requested: { scope: q.requested, identity: q.identity },
    workspaces: rows.map((w) => ({ id: w.id, name: w.name, isDefault: w.isDefault })),
    existing,
  });
});

/** POST /api/agents/oauth/consent OAuthConsentDecision → OAuthConsentResult */
agentsOauthRoutes.post('/oauth/consent', async (c) => {
  const user = c.get('user');
  const req = await parseJson(c, OAuthConsentDecision);
  const q = parseOAuthQuery(req.oauth_query);
  const client = await liveClient(q.clientId);

  let chosen: AgentScope = q.requested;
  let mode: AgentMode = 'review';
  let workspaceId: string | null = null;
  if (req.accept) {
    chosen = req.scope ?? q.requested;
    if (scopeLevel(chosen) > scopeLevel(q.requested)) throw badRequest('That is more access than the app asked for.');
    mode = req.mode ?? 'review';
    if (mode === 'direct' && chosen !== 'drive:write') throw badRequest('Only apps that can make changes can apply them directly.');
    workspaceId = req.workspaceId ?? null;
    if (workspaceId) await ownWorkspaceName(user.id, workspaceId, 400);
  }

  const headers = new Headers(c.req.raw.headers);
  headers.set('accept', 'application/json');
  headers.delete('content-length');
  let url: string;
  try {
    const res = (await auth.api.oauth2Consent({
      headers,
      // The provider continues the authorization in-process and needs a request to do it.
      request: new Request(c.req.raw.url, { method: 'POST', headers }),
      asResponse: false,
      body: {
        accept: req.accept,
        oauth_query: req.oauth_query.startsWith('?') ? req.oauth_query.slice(1) : req.oauth_query,
        ...(req.accept && q.scopes.length ? { scope: acceptedScopes(q.scopes, chosen).join(' ') } : {}),
      },
    })) as { redirect?: boolean; url?: string; redirect_uri?: string } | null;
    const next = res?.url ?? res?.redirect_uri;
    if (typeof next !== 'string' || !next) throw new Error('no redirect');
    url = next;
  } catch {
    throw badRequest(EXPIRED_REQUEST);
  }

  // Record the grant only when the provider actually issued a code (not an error or a sign-in detour).
  if (req.accept && hasCode(url)) {
    const { grant, created } = await upsertGrant(user.id, { clientId: client.clientId, clientName: client.name ?? '', scope: chosen, mode, workspaceId });
    // Consent is asked every time: drop the provider's remembered consent so a
    // later authorization comes back to this page instead of passing silently.
    await forgetProviderConsent(user.id, client.clientId);
    await audit(c, {
      kind: created ? 'agent.grant.create' : 'agent.grant.update',
      userId: user.id,
      workspaceId: grant.workspaceId,
      target: grant.id,
      meta: { clientId: grant.clientId, scope: grant.scope, mode: grant.mode, workspaceId: grant.workspaceId },
    });
  }
  return ok(c, OAuthConsentResult, { redirectUri: url });
});

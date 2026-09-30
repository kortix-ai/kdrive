// OAuth for agents: dynamic registration rules, PKCE, the consent API
// (consent-info + decision), connected apps (list / downgrade / disconnect).
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { isPrincipalFailure, resolvePrincipal } from '../agents/principal';
import { MCP_RESOURCE } from '../agents/urls';
import { db } from '../db/client';
import { agentGrants, auditEvents, bauthOAuthConsent, bauthOAuthRefreshToken } from '../db/schema';
import { endWorld, freshWorld } from '../../test/e2e/kit';
import { makeApp, signInWithWorkspace, TestClient } from '../../test/helpers';
import { acceptedScopes, parseOAuthQuery } from './agents-oauth';

const API = 'http://localhost:4101';
const REDIRECT = 'http://127.0.0.1:8765/callback';
const ALL = 'offline_access drive:read drive:propose drive:write';

async function register(body: Record<string, unknown> = {}) {
  const res = await makeApp().fetch(
    new Request(`${API}/api/auth/oauth2/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Test agent',
        redirect_uris: [REDIRECT],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: ALL,
        ...body,
      }),
    }),
  );
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, any> | null };
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** GET /authorize as `c` (signed in); returns the redirect Location. */
async function authorize(c: TestClient, clientId: string, opts: { scope?: string; challenge?: string | null; state?: string } = {}) {
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, state: opts.state ?? 'st-1', resource: MCP_RESOURCE });
  if (opts.scope !== '') q.set('scope', opts.scope ?? ALL);
  if (opts.challenge !== null) {
    q.set('code_challenge', opts.challenge ?? pkce().challenge);
    q.set('code_challenge_method', 'S256');
  }
  const res = await c.raw('GET', `/api/auth/oauth2/authorize?${q}`);
  expect(res.status).toBe(302);
  return new URL(res.headers.get('location')!, 'http://localhost:4100');
}

/** Registers a client and walks the signed-in user to the consent page; returns the page's query. */
async function toConsent(c: TestClient, scope = ALL) {
  const reg = await register({ scope });
  const clientId = reg.body!.client_id as string;
  const p = pkce();
  const at = await authorize(c, clientId, { scope, challenge: p.challenge });
  expect(at.pathname).toBe('/oauth/consent');
  return { clientId, oauthQuery: at.search.slice(1), verifier: p.verifier };
}

async function exchange(body: Record<string, string>) {
  const res = await makeApp().fetch(
    new Request(`${API}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    }),
  );
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, any> | null };
}

afterAll(() => endWorld());

let client: TestClient;
let ws: string;
let userId: string;

beforeEach(async () => {
  // A fresh database and storage emulator per test (the emulator caps live volumes).
  await freshWorld();
  const r = await signInWithWorkspace('oauth-owner@test.local');
  client = r.client;
  ws = r.ws;
  userId = r.me.user.id;
});

describe('helpers', () => {
  test('parseOAuthQuery reads the request and its expiry', () => {
    const q = parseOAuthQuery('?client_id=c1&scope=openid%20drive:propose%20offline_access&sig=x&exp=1');
    expect(q).toMatchObject({ clientId: 'c1', requested: 'drive:propose', identity: ['openid', 'offline_access'], signed: true, expired: true });
    expect(parseOAuthQuery('client_id=c1').requested).toBe('drive:read');
  });

  test('acceptedScopes keeps identity scopes and drive scopes up to the level', () => {
    expect(acceptedScopes(['offline_access', 'drive:read', 'drive:propose', 'drive:write'], 'drive:propose')).toEqual([
      'offline_access',
      'drive:read',
      'drive:propose',
    ]);
    expect(acceptedScopes(['openid', 'drive:write'], 'drive:read')).toEqual(['openid', 'drive:write']);
  });
});

describe('registration and authorization rules', () => {
  test('skip_consent is refused', async () => {
    const res = await register({ skip_consent: true });
    expect(res.status).toBe(400);
  });

  test('a confidential registration never gets a secret (it is registered as a public client)', async () => {
    const res = await register({ token_endpoint_auth_method: 'client_secret_basic' });
    if (res.status === 200 || res.status === 201) {
      expect(res.body!.client_secret).toBeUndefined();
      expect(res.body!.token_endpoint_auth_method).toBe('none');
    } else {
      expect(res.status).toBe(400);
    }
  });

  test('authorize without PKCE is an invalid_request error redirect', async () => {
    const reg = await register();
    const at = await authorize(client, reg.body!.client_id, { challenge: null });
    expect(at.origin + at.pathname).toBe(REDIRECT);
    expect(at.searchParams.get('error')).toBe('invalid_request');
  });

  test('a signed-out user is sent to the OAuth sign-in page', async () => {
    const reg = await register();
    const q = new URLSearchParams({ response_type: 'code', client_id: reg.body!.client_id, redirect_uri: REDIRECT, scope: ALL, code_challenge: pkce().challenge, code_challenge_method: 'S256' });
    const res = await makeApp().fetch(new Request(`${API}/api/auth/oauth2/authorize?${q}`));
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/oauth/sign-in');
    expect(loc.searchParams.get('sig')).toBeTruthy();
  });

  test('signing in on the OAuth sign-in page (dev account) continues to the consent page', async () => {
    const reg = await register();
    const q = new URLSearchParams({ response_type: 'code', client_id: reg.body!.client_id, redirect_uri: REDIRECT, scope: ALL, code_challenge: pkce().challenge, code_challenge_method: 'S256', state: 's9' });
    const res = await makeApp().fetch(new Request(`${API}/api/auth/oauth2/authorize?${q}`));
    const signInPage = new URL(res.headers.get('location')!);
    const fresh = new TestClient('oauth-newcomer@test.local');
    const dev = await fresh.post('/api/auth/dev/sign-in', { email: 'oauth-newcomer@test.local', oauth_query: signInPage.search.slice(1) });
    expect(dev.status).toBe(200);
    expect(dev.body.redirect).toBe(true);
    const next = new URL(dev.body.url);
    expect(next.pathname).toBe('/oauth/consent');
    expect(next.searchParams.get('client_id')).toBe(reg.body!.client_id);
    const info = await fresh.get(`/api/agents/oauth/consent-info?oauth_query=${encodeURIComponent(next.search.slice(1))}`);
    expect(info.status).toBe(200);
    expect(info.body.client.name).toBe('Test agent');
  });
});

describe('consent-info', () => {
  test('describes the client, the requested access, the workspaces and no existing grant', async () => {
    const { clientId, oauthQuery } = await toConsent(client, 'openid offline_access drive:read drive:propose');
    const res = await client.get(`/api/agents/oauth/consent-info?oauth_query=${encodeURIComponent(oauthQuery)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      client: { clientId, name: 'Test agent', uri: null, redirectHost: '127.0.0.1:8765' },
      requested: { scope: 'drive:propose', identity: ['openid', 'offline_access'] },
      workspaces: [{ id: ws, name: 'My Drive', isDefault: true }],
      existing: null,
    });
  });

  test('an unknown client is a 404; an unsigned or expired query is a 400; it needs a session', async () => {
    const unknown = await client.get(`/api/agents/oauth/consent-info?oauth_query=${encodeURIComponent('client_id=nope&scope=drive:read&sig=x')}`);
    expect(unknown.status).toBe(404);
    const unsigned = await client.get(`/api/agents/oauth/consent-info?oauth_query=${encodeURIComponent('client_id=nope')}`);
    expect(unsigned.status).toBe(400);
    const old = await client.get(`/api/agents/oauth/consent-info?oauth_query=${encodeURIComponent('client_id=nope&sig=x&exp=1000')}`);
    expect(old.status).toBe(400);
    const anon = await makeApp().fetch(new Request(`${API}/api/agents/oauth/consent-info?oauth_query=a`));
    expect(anon.status).toBe(401);
  });

  test('client names are sanitised and capped', async () => {
    const reg = await register({ client_name: `  Evil‮\u0007 ${'x'.repeat(200)}` });
    const at = await authorize(client, reg.body!.client_id);
    const res = await client.get(`/api/agents/oauth/consent-info?oauth_query=${encodeURIComponent(at.search.slice(1))}`);
    expect(res.status).toBe(200);
    expect(Array.from(res.body.client.name as string).length).toBeLessThanOrEqual(80);
    expect(res.body.client.name.startsWith('Evil x')).toBe(true);
  });
});

describe('consent decision', () => {
  test('more access than requested, direct without write, or a foreign workspace are 400s', async () => {
    const { oauthQuery } = await toConsent(client, 'offline_access drive:read drive:propose');
    const other = await signInWithWorkspace('oauth-other@test.local');
    const post = (b: Record<string, unknown>) => client.post('/api/agents/oauth/consent', { oauth_query: oauthQuery, accept: true, ...b });
    expect((await post({ scope: 'drive:write' })).status).toBe(400);
    expect((await post({ scope: 'drive:propose', mode: 'direct' })).status).toBe(400);
    expect((await post({ scope: 'drive:read', workspaceId: other.ws })).status).toBe(400);
    expect(await db.select().from(agentGrants)).toHaveLength(0);
  });

  test('a tampered query is refused as expired', async () => {
    const { oauthQuery } = await toConsent(client);
    const tampered = oauthQuery.replace('state=st-1', 'state=st-2');
    const res = await client.post('/api/agents/oauth/consent', { oauth_query: tampered, accept: true });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('expired');
  });

  test('deny stores nothing and returns access_denied', async () => {
    const { oauthQuery } = await toConsent(client);
    const res = await client.post('/api/agents/oauth/consent', { oauth_query: oauthQuery, accept: false });
    expect(res.status).toBe(200);
    const url = new URL(res.body.redirectUri);
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('st-1');
    expect(await db.select().from(agentGrants)).toHaveLength(0);
  });

  test('accept upserts one grant, returns a code, and consent is asked again next time', async () => {
    const { clientId, oauthQuery, verifier } = await toConsent(client);
    const res = await client.post('/api/agents/oauth/consent', { oauth_query: oauthQuery, accept: true, scope: 'drive:write', mode: 'direct', workspaceId: ws });
    expect(res.status).toBe(200);
    const url = new URL(res.body.redirectUri);
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get('code')).toBeTruthy();
    expect(url.searchParams.get('state')).toBe('st-1');
    const grants = await db.select().from(agentGrants);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ userId, clientId, clientName: 'Test agent', scope: 'drive:write', mode: 'direct', workspaceId: ws, revokedAt: null });
    expect(await db.select().from(bauthOAuthConsent)).toHaveLength(0);

    // The code works (PKCE + resource) and yields a JWT for /mcp.
    const tok = await exchange({ grant_type: 'authorization_code', code: url.searchParams.get('code')!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: MCP_RESOURCE });
    expect(tok.status).toBe(200);
    const p = await resolvePrincipal(`Bearer ${tok.body!.access_token}`);
    if (isPrincipalFailure(p)) throw new Error(p.message);
    expect(p).toMatchObject({ kind: 'oauth', name: 'Test agent', scope: 'drive:write', mode: 'direct', workspaceId: ws });

    // Asking again goes back to the consent page (no silent re-consent); the existing grant is shown.
    const again = await authorize(client, clientId);
    expect(again.pathname).toBe('/oauth/consent');
    const info = await client.get(`/api/agents/oauth/consent-info?oauth_query=${encodeURIComponent(again.search.slice(1))}`);
    expect(info.body.existing).toMatchObject({ clientId, scope: 'drive:write', mode: 'direct', workspaceId: ws, workspaceName: 'My Drive' });
    const second = await client.post('/api/agents/oauth/consent', { oauth_query: again.search.slice(1), accept: true, scope: 'drive:read' });
    expect(second.status).toBe(200);
    const after = await db.select().from(agentGrants);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ scope: 'drive:read', mode: 'review', workspaceId: null });
    const kinds = (await db.select().from(auditEvents).where(eq(auditEvents.userId, userId)).orderBy(auditEvents.id)).map((e) => e.kind);
    expect(kinds.filter((k) => k.startsWith('agent.grant.'))).toEqual(['agent.grant.create', 'agent.grant.update']);
  });
});

/** Full flow up to tokens: register → authorize → consent (accept) → code exchange. */
async function connect(c: TestClient, decision: Record<string, unknown>) {
  const { clientId, oauthQuery, verifier } = await toConsent(c);
  const res = await c.post('/api/agents/oauth/consent', { oauth_query: oauthQuery, accept: true, ...decision });
  expect(res.status).toBe(200);
  const code = new URL(res.body.redirectUri).searchParams.get('code')!;
  const tok = await exchange({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: MCP_RESOURCE });
  expect(tok.status).toBe(200);
  return { clientId, access: tok.body!.access_token as string, refresh: tok.body!.refresh_token as string };
}

describe('connected apps', () => {
  test('list shows live grants with their client, access and workspace', async () => {
    const { clientId } = await connect(client, { scope: 'drive:propose', workspaceId: ws });
    const res = await client.get('/api/agents/apps');
    expect(res.status).toBe(200);
    expect(res.body.apps).toHaveLength(1);
    expect(res.body.apps[0]).toMatchObject({ clientId, name: 'Test agent', redirectHost: '127.0.0.1:8765', scope: 'drive:propose', mode: 'review', workspaceId: ws, workspaceName: 'My Drive', lastUsedAt: null });
    const other = await signInWithWorkspace('apps-other@test.local');
    expect((await other.client.get('/api/agents/apps')).body.apps).toHaveLength(0);
  });

  test('patch lowers access, switches mode and workspace; never raises access', async () => {
    const { access } = await connect(client, { scope: 'drive:write', mode: 'direct' });
    const [{ id }] = (await client.get('/api/agents/apps')).body.apps;
    expect((await client.patch(`/api/agents/apps/${id}`, { mode: 'review' })).body.app).toMatchObject({ scope: 'drive:write', mode: 'review' });
    expect((await client.patch(`/api/agents/apps/${id}`, { workspaceId: ws })).body.app).toMatchObject({ workspaceId: ws, workspaceName: 'My Drive' });
    const down = await client.patch(`/api/agents/apps/${id}`, { scope: 'drive:read' });
    expect(down.status).toBe(200);
    expect(down.body.app).toMatchObject({ scope: 'drive:read', mode: 'review' });
    const p = await resolvePrincipal(`Bearer ${access}`);
    expect(isPrincipalFailure(p) ? null : p.scope).toBe('drive:read');
    expect((await client.patch(`/api/agents/apps/${id}`, { scope: 'drive:write' })).status).toBe(400);
    expect((await client.patch(`/api/agents/apps/${id}`, { mode: 'direct' })).status).toBe(400);
    const other = await signInWithWorkspace('apps-foreign@test.local');
    expect((await client.patch(`/api/agents/apps/${id}`, { workspaceId: other.ws })).status).toBe(404);
    expect((await other.client.patch(`/api/agents/apps/${id}`, { mode: 'review' })).status).toBe(404);
    const kinds = (await db.select().from(auditEvents).where(eq(auditEvents.kind, 'agent.grant.update'))).length;
    expect(kinds).toBe(3);
  });

  test('disconnect: the access token gets 401, the refresh grant fails, consent is asked again', async () => {
    const { clientId, access, refresh } = await connect(client, { scope: 'drive:write', mode: 'direct' });
    expect(isPrincipalFailure(await resolvePrincipal(`Bearer ${access}`))).toBe(false);
    // A refresh works while connected (and rotates).
    const r1 = await exchange({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId, resource: MCP_RESOURCE });
    expect(r1.status).toBe(200);
    const [{ id }] = (await client.get('/api/agents/apps')).body.apps;

    const other = await signInWithWorkspace('apps-thief@test.local');
    expect((await other.client.del(`/api/agents/apps/${id}`)).status).toBe(404);

    expect((await client.del(`/api/agents/apps/${id}`)).status).toBe(204);
    expect(await resolvePrincipal(`Bearer ${access}`)).toMatchObject({ status: 401 });
    expect(await resolvePrincipal(`Bearer ${r1.body!.access_token}`)).toMatchObject({ status: 401 });
    const r2 = await exchange({ grant_type: 'refresh_token', refresh_token: r1.body!.refresh_token, client_id: clientId, resource: MCP_RESOURCE });
    expect(r2.status).toBeGreaterThanOrEqual(400);
    const live = await db
      .select()
      .from(bauthOAuthRefreshToken)
      .where(and(eq(bauthOAuthRefreshToken.clientId, clientId), eq(bauthOAuthRefreshToken.userId, userId)));
    expect(live.every((t) => t.revoked !== null)).toBe(true);
    expect((await client.get('/api/agents/apps')).body.apps).toHaveLength(0);
    expect((await client.del(`/api/agents/apps/${id}`)).status).toBe(204);
    expect((await db.select().from(auditEvents).where(eq(auditEvents.kind, 'agent.grant.revoke'))).length).toBe(1);

    const again = await authorize(client, clientId);
    expect(again.pathname).toBe('/oauth/consent');
  });
});

// End to end: an MCP client that knows only the server URL signs in with OAuth
// (discovery → dynamic registration → PKCE authorization → our consent →
// code exchange), uses the tools, refreshes its token, and is cut off when the
// user disconnects it. A second client consented for "Suggest changes" only
// gets the review tool set and its writes become proposals.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { decodeJwt } from 'jose';
import { auth as inProcessAuth } from '../../src/auth';
import { resetDb } from '../helpers';
import { startServer, type RunningServer } from './spawn-server';

const REDIRECT = 'http://127.0.0.1:8765/callback';

/** An in-memory OAuth client: remembers its registration, tokens and verifier, records where it was sent. */
class MemoryProvider implements OAuthClientProvider {
  info: OAuthClientInformationMixed | undefined;
  saved: OAuthTokens | undefined;
  verifier = '';
  authUrl: URL | null = null;
  registrations = 0;
  constructor(private readonly name: string, private readonly scope: string) {}
  get redirectUrl() {
    return REDIRECT;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.name,
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: this.scope,
    };
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.registrations++;
    this.info = info;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(t: OAuthTokens) {
    this.saved = t;
  }
  redirectToAuthorization(url: URL) {
    this.authUrl = url;
  }
  saveCodeVerifier(v: string) {
    this.verifier = v;
  }
  codeVerifier() {
    return this.verifier;
  }
}

let server: RunningServer;
let base: string;
let cookie = '';
let ws = '';

async function browser(path: string, init: { method?: string; body?: unknown; manual?: boolean } = {}) {
  const res = await fetch(path.startsWith('http') ? path : `${base}${path}`, {
    method: init.method ?? 'GET',
    redirect: init.manual ? 'manual' : 'follow',
    headers: { origin: base, cookie, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  for (const sc of res.headers.getSetCookie()) {
    const [pair] = sc.split(';');
    const name = pair.slice(0, pair.indexOf('='));
    const jar = new Map(cookie ? cookie.split('; ').map((kv) => [kv.slice(0, kv.indexOf('=')), kv] as const) : []);
    jar.set(name, pair);
    cookie = [...jar.values()].join('; ');
  }
  return res;
}

/** Connects `provider`: the first attempt needs authorization; the user consents with `decision`; the retry succeeds. */
async function connect(provider: MemoryProvider, decision: Record<string, unknown>): Promise<{ client: Client; appId: string }> {
  const url = new URL(`${base}/mcp`);
  const first = new StreamableHTTPClientTransport(url, { authProvider: provider });
  const c1 = new Client({ name: 'e2e', version: '1.0.0' });
  await expect(c1.connect(first)).rejects.toBeInstanceOf(UnauthorizedError);
  expect(provider.registrations).toBe(1);
  const auth = provider.authUrl!;
  expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
  expect(auth.searchParams.get('resource')).toBe(`${base}/mcp`);

  const toConsent = await browser(auth.toString(), { manual: true });
  expect(toConsent.status).toBe(302);
  const consentUrl = new URL(toConsent.headers.get('location')!, base);
  expect(consentUrl.pathname).toBe('/oauth/consent');
  expect(consentUrl.searchParams.get('sig')).toBeTruthy();
  const decided = await browser('/api/agents/oauth/consent', { method: 'POST', body: { oauth_query: consentUrl.search.slice(1), accept: true, ...decision } });
  expect(decided.status).toBe(200);
  const back = new URL(((await decided.json()) as { redirectUri: string }).redirectUri);
  expect(back.searchParams.get('state')).toBe(auth.searchParams.get('state'));
  await first.finishAuth(back.searchParams.get('code')!);

  const client = new Client({ name: 'e2e', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(url, { authProvider: provider }));
  const apps = (await (await browser('/api/agents/apps')).json()) as { apps: { id: string; clientId: string }[] };
  const app = apps.apps.find((a) => a.clientId === (provider.info as { client_id: string }).client_id)!;
  return { client, appId: app.id };
}

type Structured = Record<string, any>;
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name} failed: ${JSON.stringify(r.content)}`);
  return r.structuredContent as Structured;
};

beforeAll(async () => {
  await resetDb();
  // The child gets a minimal env; without USER the Postgres client would connect as "unknown".
  const user = process.env.PGUSER ?? process.env.USER ?? '';
  server = await startServer({ env: user ? { USER: user, PGUSER: user } : {} });
  base = server.base;
  const signIn = await browser('/api/auth/dev/sign-in', { method: 'POST', body: { email: 'e2e-oauth@test.local' } });
  expect(signIn.status).toBe(200);
  const me = (await (await browser('/api/me')).json()) as { defaultWorkspaceId: string };
  ws = me.defaultWorkspaceId;
}, 60_000);

afterAll(async () => {
  await server?.stop();
});

describe('MCP over OAuth', () => {
  test('sign in, consent, tools, refresh, disconnect', async () => {
    const provider = new MemoryProvider('E2E agent', 'offline_access drive:read drive:propose drive:write');
    const { client, appId } = await connect(provider, { scope: 'drive:write', mode: 'direct', workspaceId: null });

    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toHaveLength(13);
    const list = await call(client, 'list_workspaces');
    expect(list.default_workspace_id).toBe(ws);
    const opened = await call(client, 'open_workspace', { workspace_id: ws });
    const wrote = await call(client, 'write_changes', {
      workspace_id: ws,
      last_seen_commit_id: opened.head_commit_id,
      message: 'Add notes',
      changes: [{ op: 'write', path: '/notes/hello.md', content: '# Hello from an agent\n' }],
    });
    expect(wrote.outcome).toBe('committed');
    const timeline = (await (await browser(`/api/w/${ws}/timeline`)).json()) as { entries: { agent?: { name: string; kind: string } | null }[] };
    expect(timeline.entries[0].agent).toMatchObject({ name: 'E2E agent', kind: 'oauth' });

    // Refresh: a new access token that works on /mcp.
    const info = provider.info as { client_id: string };
    const refreshed = await fetch(`${base}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: provider.saved!.refresh_token!, client_id: info.client_id, resource: `${base}/mcp` }),
    });
    expect(refreshed.status).toBe(200);
    const fresh = (await refreshed.json()) as { access_token: string; refresh_token: string };
    provider.saved = { ...provider.saved!, access_token: fresh.access_token, refresh_token: fresh.refresh_token };
    expect((await call(client, 'list_workspaces')).default_workspace_id).toBe(ws);

    // Disconnect: the next call fails and the refresh grant is dead.
    expect((await browser(`/api/agents/apps/${appId}`, { method: 'DELETE' })).status).toBe(204);
    await expect(client.callTool({ name: 'list_workspaces', arguments: {} })).rejects.toThrow();
    const raw = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${fresh.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(raw.status).toBe(401);
    const dead = await fetch(`${base}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: fresh.refresh_token, client_id: info.client_id, resource: `${base}/mcp` }),
    });
    expect(dead.status).toBeGreaterThanOrEqual(400);
    await client.close().catch(() => {});
  }, 60_000);

  test('a client allowed only to suggest changes gets the review tools and its writes become proposals', async () => {
    const provider = new MemoryProvider('E2E reviewer', 'offline_access drive:read drive:propose');
    const { client } = await connect(provider, { scope: 'drive:propose' });
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toHaveLength(10);
    const opened = await call(client, 'open_workspace', { workspace_id: ws });
    const wrote = await call(client, 'write_changes', {
      workspace_id: ws,
      last_seen_commit_id: opened.head_commit_id,
      message: 'Suggest a plan',
      changes: [{ op: 'write', path: '/plan.md', content: 'A plan\n' }],
    });
    expect(wrote.outcome).toBe('proposed');
    expect(wrote.proposal_id).toBeTruthy();
    await client.close().catch(() => {});
  }, 60_000);
});

/** A raw tools/list against /mcp with `token`; returns the HTTP status. */
async function rawStatus(token: string): Promise<number> {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  await r.body?.cancel();
  return r.status;
}

describe('OAuth discovery and token checks', () => {
  test('a bare 401 leads a client to the resource metadata, then to the authorization server', async () => {
    const challenge = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(challenge.status).toBe(401);
    const www = challenge.headers.get('www-authenticate') ?? '';
    expect(www.startsWith('Bearer ')).toBe(true);
    const prmUrl = /resource_metadata="([^"]+)"/.exec(www)?.[1];
    expect(prmUrl).toBe(`${base}/.well-known/oauth-protected-resource`);

    const prm = (await (await fetch(prmUrl!)).json()) as Record<string, any>;
    expect(prm.resource).toBe(`${base}/mcp`);
    expect(prm.scopes_supported).toEqual(expect.arrayContaining(['drive:read', 'drive:propose', 'drive:write']));
    const suffixed = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    expect(await suffixed.json()).toEqual(prm);

    const issuer = prm.authorization_servers[0] as string;
    const as = (await (await fetch(`${issuer}/.well-known/oauth-authorization-server`)).json()) as Record<string, any>;
    expect(as.issuer).toBe(issuer);
    expect(as.code_challenge_methods_supported).toContain('S256');
    expect(as.grant_types_supported).toEqual(expect.arrayContaining(['authorization_code', 'refresh_token']));
    for (const k of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'jwks_uri']) expect(as[k]).toStartWith(base);
    const jwks = (await (await fetch(as.jwks_uri)).json()) as { keys: { alg?: string }[] };
    expect(jwks.keys.length).toBeGreaterThan(0);
  }, 60_000);

  test('tokens for another audience, expired tokens and tokens of a disconnected app are refused', async () => {
    const provider = new MemoryProvider('E2E audience', 'offline_access drive:read');
    const { client, appId } = await connect(provider, { scope: 'drive:read' });
    await client.close().catch(() => {});
    const real = provider.saved!.access_token;
    expect(await rawStatus(real)).toBe(200);

    // Mint with the server's own signing key (shared database and secret), so only the claim under test differs.
    const claims = decodeJwt(real) as Record<string, any>;
    expect(claims.aud).toBe(`${base}/mcp`);
    const now = Math.floor(Date.now() / 1000);
    const mint = async (over: Record<string, unknown>) =>
      (await inProcessAuth.api.signJWT({ body: { payload: { sub: claims.sub, azp: claims.azp, scope: claims.scope, iss: claims.iss, aud: claims.aud, iat: now, exp: now + 600, ...over } } })).token;
    expect(await rawStatus(await mint({}))).toBe(200);
    expect(await rawStatus(await mint({ aud: claims.iss }))).toBe(401);
    expect(await rawStatus(await mint({ aud: 'https://other.example/mcp' }))).toBe(401);
    expect(await rawStatus(await mint({ iss: 'https://other.example' }))).toBe(401);
    expect(await rawStatus(await mint({ iat: now - 3600, exp: now - 60 }))).toBe(401);
    expect(await rawStatus(real.slice(0, -4) + (real.endsWith('AAAA') ? 'BBBB' : 'AAAA'))).toBe(401);

    // A session JWT from the sign-in (audience = the site, not /mcp) never works as an agent credential.
    const session = await browser('/api/auth/token');
    if (session.status === 200) {
      const { token } = (await session.json()) as { token: string };
      expect(await rawStatus(token)).toBe(401);
    }

    // Disconnecting revokes the grant: a still-unexpired token stops working on the next request.
    expect((await browser(`/api/agents/apps/${appId}`, { method: 'DELETE' })).status).toBe(204);
    expect(await rawStatus(real)).toBe(401);
    expect(await rawStatus(await mint({}))).toBe(401);
  }, 60_000);
});

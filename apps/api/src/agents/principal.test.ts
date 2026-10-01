import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { auth } from '../auth';
import { db } from '../db/client';
import { agentGrants, agentTokens, bauthOAuthClient, bauthUser } from '../db/schema';
import { newId } from '../lib/ids';
import { createAgentToken, resetDb, signInWithWorkspace } from '../../test/helpers';
import { agentRef, isPrincipalFailure, principalWorkspace, principalWorkspaces, resolvePrincipal, type AgentPrincipal } from './principal';
import { MCP_RESOURCE, OAUTH_ISSUER } from './urls';

let userId: string;
let ws: string;

beforeEach(async () => {
  await resetDb();
  const r = await signInWithWorkspace('agent-owner@test.local');
  userId = r.me.user.id;
  ws = r.ws;
});

const bearer = (x: string) => `Bearer ${x}`;

function expectOk(r: Awaited<ReturnType<typeof resolvePrincipal>>): AgentPrincipal {
  if (isPrincipalFailure(r)) throw new Error(`expected a principal, got ${r.status} ${r.message}`);
  return r;
}

async function addClient(clientId = 'client-' + newId(), disabled = false): Promise<string> {
  await db.insert(bauthOAuthClient).values({
    id: newId(),
    clientId,
    disabled,
    name: 'Test app',
    redirectUris: ['http://127.0.0.1:8765/callback'],
    tokenEndpointAuthMethod: 'none',
    public: true,
  });
  return clientId;
}

async function addGrant(clientId: string, scope: 'drive:read' | 'drive:propose' | 'drive:write', mode: 'review' | 'direct' = 'review') {
  await db.insert(agentGrants).values({ id: newId(), userId, clientId, clientName: 'Test app', scope, mode });
}

async function sign(payload: Record<string, unknown>): Promise<string> {
  const r = await auth.api.signJWT({ body: { payload } });
  return r.token;
}

describe('agent tokens', () => {
  test('a valid token resolves to its user, scope, mode and restriction', async () => {
    const secret = await createAgentToken(userId, { scope: 'drive:write', mode: 'direct', workspaceId: ws, name: 'Research agent' });
    const p = expectOk(await resolvePrincipal(bearer(secret)));
    expect(p.kind).toBe('token');
    expect(p.credential).toMatch(/^pat:/);
    expect(p.name).toBe('Research agent');
    expect(p.user.id).toBe(userId);
    expect(p.scope).toBe('drive:write');
    expect(p.mode).toBe('direct');
    expect(p.workspaceId).toBe(ws);
    expect(agentRef(p)).toEqual({ kind: 'token', name: 'Research agent', credential: p.credential });
  });

  test('propose-only tokens are always in review mode', async () => {
    const secret = await createAgentToken(userId, { scope: 'drive:propose', mode: 'direct' });
    expect(expectOk(await resolvePrincipal(bearer(secret))).mode).toBe('review');
  });

  test('unknown, expired, revoked tokens and deleted users are refused', async () => {
    const unknown = 'vx_pat_' + 'A'.repeat(43);
    expect(await resolvePrincipal(bearer(unknown))).toMatchObject({ status: 401, code: 'unauthorized' });

    const expired = await createAgentToken(userId, { scope: 'drive:read', expiresAt: new Date(Date.now() - 1000) });
    expect(await resolvePrincipal(bearer(expired))).toMatchObject({ status: 401 });

    const revoked = await createAgentToken(userId, { scope: 'drive:read', name: 'gone' });
    await db.update(agentTokens).set({ revokedAt: new Date() }).where(eq(agentTokens.name, 'gone'));
    expect(await resolvePrincipal(bearer(revoked))).toMatchObject({ status: 401 });

    const live = await createAgentToken(userId, { scope: 'drive:read' });
    expectOk(await resolvePrincipal(bearer(live)));
    await db.delete(bauthUser).where(eq(bauthUser.id, userId));
    expect(await resolvePrincipal(bearer(live))).toMatchObject({ status: 401 });
  });

  test('malformed headers are refused', async () => {
    expect(await resolvePrincipal(undefined)).toMatchObject({ status: 401 });
    expect(await resolvePrincipal('Basic abc')).toMatchObject({ status: 401 });
    expect(await resolvePrincipal('Bearer ' + 'x'.repeat(5000))).toMatchObject({ status: 401 });
  });
});

describe('OAuth access tokens', () => {
  test('a JWT for the MCP resource with a live client and grant resolves', async () => {
    const clientId = await addClient();
    await addGrant(clientId, 'drive:write', 'direct');
    const jwt = await sign({ sub: userId, azp: clientId, scope: 'offline_access drive:read drive:propose drive:write', aud: MCP_RESOURCE });
    const p = expectOk(await resolvePrincipal(bearer(jwt)));
    expect(p.kind).toBe('oauth');
    expect(p.credential).toBe(`oauth:${clientId}`);
    expect(p.name).toBe('Test app');
    expect(p.scope).toBe('drive:write');
    expect(p.mode).toBe('direct');
  });

  test('the narrower of token scope and grant scope wins', async () => {
    const clientId = await addClient();
    await addGrant(clientId, 'drive:write', 'direct');
    const narrow = await sign({ sub: userId, azp: clientId, scope: 'drive:read', aud: MCP_RESOURCE });
    const p = expectOk(await resolvePrincipal(bearer(narrow)));
    expect(p.scope).toBe('drive:read');
    expect(p.mode).toBe('review');

    const other = await addClient();
    await addGrant(other, 'drive:propose');
    const wide = await sign({ sub: userId, azp: other, scope: 'drive:write', aud: MCP_RESOURCE });
    expect(expectOk(await resolvePrincipal(bearer(wide))).scope).toBe('drive:propose');
  });

  test('wrong audience, wrong issuer, expired, missing azp, disabled client and revoked grant are refused', async () => {
    const clientId = await addClient();
    await addGrant(clientId, 'drive:write');
    const base = { sub: userId, azp: clientId, scope: 'drive:write', aud: MCP_RESOURCE };
    for (const payload of [
      { ...base, aud: OAUTH_ISSUER },
      { ...base, iss: 'http://evil.example' },
      { ...base, exp: Math.floor(Date.now() / 1000) - 60 },
      { sub: userId, scope: 'drive:write', aud: MCP_RESOURCE },
    ]) {
      expect(await resolvePrincipal(bearer(await sign(payload)))).toMatchObject({ status: 401 });
    }

    const good = await sign(base);
    expectOk(await resolvePrincipal(bearer(good)));
    await db.update(agentGrants).set({ revokedAt: new Date() }).where(eq(agentGrants.clientId, clientId));
    expect(await resolvePrincipal(bearer(good))).toMatchObject({ status: 401 });

    const off = await addClient(undefined, true);
    await addGrant(off, 'drive:write');
    expect(await resolvePrincipal(bearer(await sign({ ...base, azp: off })))).toMatchObject({ status: 401 });
  });

  test('no drive scope is 403 insufficient_scope', async () => {
    const clientId = await addClient();
    await addGrant(clientId, 'drive:write');
    const jwt = await sign({ sub: userId, azp: clientId, scope: 'openid profile', aud: MCP_RESOURCE });
    expect(await resolvePrincipal(bearer(jwt))).toMatchObject({ status: 403, code: 'insufficient_scope' });
  });

  test('opaque tokens and session JWTs are refused with the resource hint', async () => {
    const opaque = await resolvePrincipal(bearer('vx_oat_' + 'a'.repeat(40)));
    expect(opaque).toMatchObject({ status: 401 });
    expect((opaque as { message: string }).message).toContain(`resource=${MCP_RESOURCE}`);
    const session = await sign({ sub: userId, email: 'agent-owner@test.local' });
    expect(await resolvePrincipal(bearer(session))).toMatchObject({ status: 401 });
  });
});

describe('workspace resolution', () => {
  test('restricted principals see only their workspace; foreign ids are 404', async () => {
    const other = await signInWithWorkspace('someone-else@test.local');
    const all = expectOk(await resolvePrincipal(bearer(await createAgentToken(userId, { scope: 'drive:read' }))));
    expect((await principalWorkspaces(all)).map((w) => w.id)).toEqual([ws]);
    expect((await principalWorkspace(all, undefined)).id).toBe(ws);
    await expect(principalWorkspace(all, other.ws)).rejects.toMatchObject({ status: 404, code: 'not_found' });
    await expect(principalWorkspace(all, 'vol_123')).rejects.toMatchObject({ status: 404 });

    const restricted = expectOk(
      await resolvePrincipal(bearer(await createAgentToken(userId, { scope: 'drive:read', workspaceId: ws }))),
    );
    expect((await principalWorkspace(restricted, undefined)).id).toBe(ws);
    expect((await principalWorkspace(restricted, ws)).id).toBe(ws);
  });
});

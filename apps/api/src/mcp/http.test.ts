// The /mcp endpoint itself: auth challenge, origin, methods, size and rate limits.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { agentGrants, agentTokens, bauthOAuthClient } from '../db/schema';
import { auth } from '../auth';
import { MCP_RESOURCE } from '../agents/urls';
import { newId } from '../lib/ids';
import { env } from '../env';
import { createAgentToken, makeApp, mcpCall } from '../../test/helpers';
import { endWorld, freshWorld, user, type User } from '../../test/e2e/kit';
import { MCP_MAX_BODY } from './http';

let u: User;
let secret: string;

beforeEach(async () => {
  await freshWorld();
  u = await user('mcp-http@test.local');
  secret = await createAgentToken(u.userId, { scope: 'drive:read', name: 'Reader' });
});
afterAll(() => endWorld());

const post = (headers: Record<string, string>, body: BodyInit) =>
  makeApp().fetch(new Request('http://localhost:4101/mcp', { method: 'POST', headers, body }));

describe('/mcp', () => {
  test('initialize answers with the server identity and instructions', async () => {
    const r = await mcpCall(makeApp(), secret, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('x-request-id')).toBeTruthy();
    expect(r.body!.result.serverInfo).toMatchObject({ name: 'volumes', version: '1.0.0' });
    expect(r.body!.result.instructions).toContain('This connection is read-only.');
    const tools = await mcpCall(makeApp(), secret, 'tools/list');
    expect(tools.body!.result.tools).toHaveLength(8);
  });

  test('missing or revoked credentials get 401 with the resource metadata challenge', async () => {
    const none = await mcpCall(makeApp(), null, 'tools/list');
    expect(none.status).toBe(401);
    const challenge = none.headers.get('www-authenticate')!;
    expect(challenge).toStartWith('Bearer resource_metadata="http://localhost:4100/.well-known/oauth-protected-resource"');
    expect(challenge).toContain('scope="offline_access drive:read drive:propose drive:write"');
    await db.update(agentTokens).set({ revokedAt: new Date() }).where(eq(agentTokens.userId, u.userId));
    const revoked = await mcpCall(makeApp(), secret, 'tools/list');
    expect(revoked.status).toBe(401);
    expect(revoked.body!.error.code).toBe('unauthorized');
    // A session cookie is never a credential here.
    const cookie = await mcpCall(makeApp(), null, 'tools/list', {}, { cookie: u.client.cookieHeader() });
    expect(cookie.status).toBe(401);
  });

  test('origins, methods and size', async () => {
    const evil = await mcpCall(makeApp(), secret, 'tools/list', {}, { origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    const same = await mcpCall(makeApp(), secret, 'tools/list', {}, { origin: 'http://localhost:4100' });
    expect(same.status).toBe(200);
    for (const method of ['GET', 'DELETE']) {
      const r = await makeApp().fetch(new Request('http://localhost:4101/mcp', { method, headers: { authorization: `Bearer ${secret}` } }));
      expect(r.status).toBe(405);
      expect(r.headers.get('allow')).toBe('POST');
    }
    const chunk = new Uint8Array(1024 * 1024).fill(32);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent > MCP_MAX_BODY) return c.close();
        sent += chunk.length;
        c.enqueue(chunk);
      },
    });
    const big = await post(
      { authorization: `Bearer ${secret}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      stream,
    );
    expect(big.status).toBe(413);
  });

  test('rate limit per credential', async () => {
    let last = 0;
    for (let i = 0; i < 70 && last !== 429; i++) last = (await mcpCall(makeApp(), secret, 'tools/list')).status;
    expect(last).toBe(429);
    const other = await createAgentToken(u.userId, { scope: 'drive:read', name: 'Other' });
    expect((await mcpCall(makeApp(), other, 'tools/list')).status).toBe(200);
  });

  test('failed authentication is limited per client address before any lookup', async () => {
    const bad = 'vx_pat_' + 'B'.repeat(43);
    const from = (ip: string) => ({ 'x-forwarded-for': ip });
    // Valid calls give their token back: they never use up the address's allowance.
    for (let i = 0; i < 50; i++) expect((await mcpCall(makeApp(), secret, 'tools/list', {}, from('203.0.113.7'))).status).toBe(200);
    const codes = await Promise.all(Array.from({ length: 90 }, () => mcpCall(makeApp(), bad, 'tools/list', {}, from('203.0.113.7'))));
    const limited = codes.filter((r) => r.status === 429);
    expect(codes.filter((r) => r.status === 401).length).toBeLessThanOrEqual(60);
    expect(limited.length).toBeGreaterThan(0);
    expect(limited[0].headers.get('retry-after')).toMatch(/^\d+$/);
    expect(limited[0].body!.error.code).toBe('rate_limited');
    // Another address is not affected.
    expect((await mcpCall(makeApp(), secret, 'tools/list', {}, from('198.51.100.9'))).status).toBe(200);
    expect((await mcpCall(makeApp(), bad, 'tools/list', {}, from('198.51.100.9'))).status).toBe(401);
  });

  test("one user's OAuth traffic never drains another user's budget for the same app", async () => {
    const clientId = 'client-' + newId();
    await db.insert(bauthOAuthClient).values({
      id: newId(),
      clientId,
      disabled: false,
      name: 'Shared app',
      redirectUris: ['http://127.0.0.1:8765/callback'],
      tokenEndpointAuthMethod: 'none',
      public: true,
    });
    const bob = await user('mcp-http-bob@test.local');
    const tokens: string[] = [];
    for (const who of [u.userId, bob.userId]) {
      await db.insert(agentGrants).values({ id: newId(), userId: who, clientId, clientName: 'Shared app', scope: 'drive:read', mode: 'review' });
      tokens.push((await auth.api.signJWT({ body: { payload: { sub: who, azp: clientId, scope: 'drive:read', aud: MCP_RESOURCE } } })).token);
    }
    const [alice, bobs] = tokens;
    let last = 0;
    for (let i = 0; i < 70 && last !== 429; i++) last = (await mcpCall(makeApp(), bobs, 'tools/list')).status;
    expect(last).toBe(429);
    expect((await mcpCall(makeApp(), alice, 'tools/list')).status).toBe(200);
  });

  test('the kill switch answers 404', async () => {
    const was = env.mcpEnabled;
    (env as { mcpEnabled: boolean }).mcpEnabled = false;
    try {
      expect((await mcpCall(makeApp(), secret, 'tools/list')).status).toBe(404);
    } finally {
      (env as { mcpEnabled: boolean }).mcpEnabled = was;
    }
  });
});

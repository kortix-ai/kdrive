// Agent tokens: create (secret shown once), list, the active cap, workspace
// checks, revoke (the same secret stops working on /mcp), audit without secrets.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { hashAgentToken } from '../agents/tokens';
import { db } from '../db/client';
import { agentTokens, auditEvents, workspaces } from '../db/schema';
import { endWorld, freshWorld } from '../../test/e2e/kit';
import { makeApp, mcpCall, signInWithWorkspace, type TestClient } from '../../test/helpers';

afterAll(() => endWorld());

let client: TestClient;
let ws: string;
let userId: string;

beforeEach(async () => {
  // A fresh database and storage emulator per test (the emulator caps live volumes).
  await freshWorld();
  const r = await signInWithWorkspace('tokens@test.local');
  client = r.client;
  ws = r.ws;
  userId = r.me.user.id;
});

const create = (body: Record<string, unknown>) => client.post('/api/agents/tokens', body);

describe('create and list', () => {
  test('the secret is returned once, never listed, and only its hash is stored', async () => {
    const res = await create({ name: '  Research agent ', scope: 'drive:write', mode: 'direct', workspaceId: ws, expiresInDays: 90 });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { token, secret } = res.body;
    expect(secret).toMatch(/^vx_pat_[A-Za-z0-9_-]{43}$/);
    expect(token).toMatchObject({
      name: 'Research agent',
      prefix: secret.slice(0, 12),
      scope: 'drive:write',
      mode: 'direct',
      workspaceId: ws,
      workspaceName: 'My Drive',
      lastUsedAt: null,
      revokedAt: null,
      expired: false,
    });
    const days = (Date.parse(token.expiresAt) - Date.parse(token.createdAt)) / 86_400_000;
    expect(Math.round(days)).toBe(90);

    const list = await client.get('/api/agents/tokens');
    expect(list.status).toBe(200);
    expect(list.body.tokens).toHaveLength(1);
    expect(list.body.tokens[0].id).toBe(token.id);
    expect(list.text).not.toContain(secret);
    expect(list.text).not.toContain(hashAgentToken(secret));

    const [row] = await db.select().from(agentTokens).where(eq(agentTokens.id, token.id));
    expect(row.tokenHash).toBe(hashAgentToken(secret));
    expect(JSON.stringify(row)).not.toContain(secret);
  });

  test('defaults: review mode, all workspaces, one year; read-only stores review', async () => {
    const res = await create({ name: 'Reader', scope: 'drive:read' });
    expect(res.status).toBe(201);
    expect(res.body.token).toMatchObject({ scope: 'drive:read', mode: 'review', workspaceId: null, workspaceName: null });
    const days = (Date.parse(res.body.token.expiresAt) - Date.parse(res.body.token.createdAt)) / 86_400_000;
    expect(Math.round(days)).toBe(365);
    const read = await create({ name: 'Reader 2', scope: 'drive:read', mode: 'direct' });
    expect(read.body.token.mode).toBe('review');
  });

  test('bad requests: propose + direct, empty or long names, odd expiry', async () => {
    expect((await create({ name: 'x', scope: 'drive:propose', mode: 'direct' })).status).toBe(400);
    expect((await create({ name: '   ', scope: 'drive:read' })).status).toBe(400);
    expect((await create({ name: 'x'.repeat(61), scope: 'drive:read' })).status).toBe(400);
    expect((await create({ name: 'x', scope: 'drive:read', expiresInDays: 0 })).status).toBe(400);
    expect((await create({ name: 'x', scope: 'drive:admin' })).status).toBe(400);
  });

  test('a foreign or deleted workspace is refused with 404', async () => {
    const other = await signInWithWorkspace('tokens-other@test.local');
    expect((await create({ name: 'x', scope: 'drive:read', workspaceId: other.ws })).status).toBe(404);
    const made = await client.post('/api/workspaces', { name: 'Side' });
    expect(made.status).toBe(201);
    const side = made.body.workspace.id as string;
    await db.update(workspaces).set({ deletedAt: new Date() }).where(eq(workspaces.id, side));
    expect((await create({ name: 'x', scope: 'drive:read', workspaceId: side })).status).toBe(404);
  });

  test('at most 25 active tokens; revoked and expired ones do not count', async () => {
    for (let i = 0; i < 25; i++) expect((await create({ name: `t${i}`, scope: 'drive:read' })).status).toBe(201);
    const full = await create({ name: 'one more', scope: 'drive:read' });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('conflict');
    const list = await client.get('/api/agents/tokens');
    expect(list.body.tokens).toHaveLength(25);
    expect((await client.del(`/api/agents/tokens/${list.body.tokens[0].id}`)).status).toBe(204);
    expect((await create({ name: 'after revoke', scope: 'drive:read' })).status).toBe(201);
    await db
      .update(agentTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(agentTokens.userId, userId), eq(agentTokens.name, 't5')));
    expect((await create({ name: 'after expiry', scope: 'drive:read' })).status).toBe(201);
    const after = await client.get('/api/agents/tokens');
    expect(after.body.tokens.find((t: any) => t.name === 't5').expired).toBe(true);
  });
});

describe('revoke', () => {
  test('the same secret gets 401 from /mcp; revoke is idempotent; other users get 404', async () => {
    const made = await create({ name: 'Worker', scope: 'drive:read' });
    const { secret, token } = made.body;
    const init = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } };
    const before = await mcpCall(makeApp(), secret, 'initialize', init);
    expect(before.status).not.toBe(401);

    const other = await signInWithWorkspace('tokens-thief@test.local');
    expect((await other.client.del(`/api/agents/tokens/${token.id}`)).status).toBe(404);

    expect((await client.del(`/api/agents/tokens/${token.id}`)).status).toBe(204);
    expect((await client.del(`/api/agents/tokens/${token.id}`)).status).toBe(204);
    expect((await client.del('/api/agents/tokens/nope')).status).toBe(404);

    const after = await mcpCall(makeApp(), secret, 'initialize', init);
    expect(after.status).toBe(401);
    const list = await client.get('/api/agents/tokens');
    expect(list.body.tokens[0].revokedAt).not.toBeNull();
  });

  test('audit rows record create and one revoke, never the secret', async () => {
    const made = await create({ name: 'Audited', scope: 'drive:propose', workspaceId: ws });
    const { secret, token } = made.body;
    await client.del(`/api/agents/tokens/${token.id}`);
    await client.del(`/api/agents/tokens/${token.id}`);
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.userId, userId));
    const kinds = rows.map((r) => r.kind).filter((k) => k.startsWith('agent.'));
    expect(kinds.sort()).toEqual(['agent.token.create', 'agent.token.revoke']);
    const create_ = rows.find((r) => r.kind === 'agent.token.create')!;
    expect(create_.meta).toMatchObject({ tokenId: token.id, name: 'Audited', scope: 'drive:propose', mode: 'review', workspaceId: ws });
    const all = JSON.stringify(rows);
    expect(all).not.toContain(secret);
    expect(all).not.toContain(hashAgentToken(secret));
  });

  test('needs a session', async () => {
    const res = await makeApp().fetch(new Request('http://localhost:4101/api/agents/tokens'));
    expect(res.status).toBe(401);
  });
});

// Agent tokens (personal access tokens for AI agents), mounted at /api/agents.
// The plaintext is returned once, on creation, and only its SHA-256 is stored.
import { Hono } from 'hono';
import { and, count, desc, eq, gt, isNull } from 'drizzle-orm';
import { AgentTokenListResponse, CreateAgentTokenRequest, CreateAgentTokenResponse, type AgentToken } from '@volumes/shared';
import { generateAgentToken } from '../agents/tokens';
import { db } from '../db/client';
import { agentTokens, workspaces, type AgentTokenRow } from '../db/schema';
import { audit } from '../lib/audit';
import { ApiError, noContent, ok, parseJson } from '../lib/http';
import { newId } from '../lib/ids';
import type { AppEnv } from '../types';

export const agentTokensRoutes = new Hono<AppEnv>();

/** Live (not revoked, not expired) tokens a user may hold at once. */
export const AGENT_TOKENS_ACTIVE_MAX = 25;
const DAY_MS = 86_400_000;

function toAgentToken(t: AgentTokenRow, workspaceName: string | null, now = Date.now()): AgentToken {
  return {
    id: t.id,
    name: t.name,
    prefix: t.tokenPrefix,
    scope: t.scope,
    mode: t.scope === 'drive:write' ? t.mode : 'review',
    workspaceId: t.workspaceId,
    workspaceName: t.workspaceId ? workspaceName : null,
    expiresAt: t.expiresAt.toISOString(),
    lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
    revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    expired: t.expiresAt.getTime() <= now,
  };
}

/** The user's live workspace `id` (its name), or a 404 that never says whether it exists. */
export async function ownWorkspaceName(userId: string, id: string, status: 400 | 404 = 404): Promise<string> {
  const [ws] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.userId, userId), isNull(workspaces.deletedAt)))
    .limit(1);
  if (!ws) throw status === 404 ? new ApiError(404, 'not_found', 'No such workspace.') : new ApiError(400, 'bad_request', 'Choose one of your workspaces.');
  return ws.name;
}

/** GET /api/agents/tokens → AgentTokenListResponse (newest first; revoked and expired ones flagged). */
agentTokensRoutes.get('/tokens', async (c) => {
  const rows = await db
    .select({ t: agentTokens, workspaceName: workspaces.name })
    .from(agentTokens)
    .leftJoin(workspaces, eq(workspaces.id, agentTokens.workspaceId))
    .where(eq(agentTokens.userId, c.get('user').id))
    .orderBy(desc(agentTokens.createdAt), desc(agentTokens.id));
  const now = Date.now();
  return ok(c, AgentTokenListResponse, { tokens: rows.map((r) => toAgentToken(r.t, r.workspaceName, now)) });
});

/** POST /api/agents/tokens CreateAgentTokenRequest → 201 CreateAgentTokenResponse */
agentTokensRoutes.post('/tokens', async (c) => {
  const user = c.get('user');
  const req = await parseJson(c, CreateAgentTokenRequest);
  const workspaceName = req.workspaceId ? await ownWorkspaceName(user.id, req.workspaceId) : null;
  const now = new Date();
  const [{ n }] = await db
    .select({ n: count() })
    .from(agentTokens)
    .where(and(eq(agentTokens.userId, user.id), isNull(agentTokens.revokedAt), gt(agentTokens.expiresAt, now)));
  if (n >= AGENT_TOKENS_ACTIVE_MAX) {
    throw new ApiError(409, 'conflict', `You can have up to ${AGENT_TOKENS_ACTIVE_MAX} active tokens. Revoke one you no longer use first.`);
  }
  const secret = generateAgentToken();
  const [row] = await db
    .insert(agentTokens)
    .values({
      id: newId(),
      userId: user.id,
      name: req.name,
      tokenHash: secret.hash,
      tokenPrefix: secret.prefix,
      scope: req.scope,
      mode: req.scope === 'drive:write' ? req.mode : 'review',
      workspaceId: req.workspaceId,
      expiresAt: new Date(now.getTime() + req.expiresInDays * DAY_MS),
      createdAt: now,
    })
    .returning();
  await audit(c, {
    kind: 'agent.token.create',
    userId: user.id,
    workspaceId: row.workspaceId,
    target: row.id,
    meta: {
      tokenId: row.id,
      name: row.name,
      scope: row.scope,
      mode: row.mode,
      workspaceId: row.workspaceId,
      expiresAt: row.expiresAt.toISOString(),
    },
  });
  c.header('Cache-Control', 'no-store');
  return ok(c, CreateAgentTokenResponse, { token: toAgentToken(row, workspaceName), secret: secret.secret }, 201);
});

/** DELETE /api/agents/tokens/:id → 204 (idempotent; another user's id is a 404). */
agentTokensRoutes.delete('/tokens/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const [row] = await db
    .select()
    .from(agentTokens)
    .where(and(eq(agentTokens.id, id), eq(agentTokens.userId, user.id)))
    .limit(1);
  if (!row) throw new ApiError(404, 'not_found', 'No such token.');
  if (!row.revokedAt) {
    const [revoked] = await db
      .update(agentTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(agentTokens.id, row.id), isNull(agentTokens.revokedAt)))
      .returning({ id: agentTokens.id });
    if (revoked) {
      await audit(c, {
        kind: 'agent.token.revoke',
        userId: user.id,
        workspaceId: row.workspaceId,
        target: row.id,
        meta: { tokenId: row.id, name: row.name },
      });
    }
  }
  return noContent(c);
});

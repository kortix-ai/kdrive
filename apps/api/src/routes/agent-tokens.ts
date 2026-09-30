// Agent tokens (personal access tokens for AI agents), mounted at /api/agents.
// (Builder A fills the handlers.)
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { stub } from './_stub';

export const agentTokensRoutes = new Hono<AppEnv>();

/** GET /api/agents/tokens → AgentTokenListResponse */
agentTokensRoutes.get('/tokens', stub);
/** POST /api/agents/tokens CreateAgentTokenRequest → 201 CreateAgentTokenResponse */
agentTokensRoutes.post('/tokens', stub);
/** DELETE /api/agents/tokens/:id → 204 */
agentTokensRoutes.delete('/tokens/:id', stub);

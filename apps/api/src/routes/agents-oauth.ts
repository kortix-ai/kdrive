// Connected apps (OAuth grants) and the consent page's API, mounted at /api/agents.
// (Builder A fills the handlers.)
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { stub } from './_stub';

export const agentsOauthRoutes = new Hono<AppEnv>();

/** GET /api/agents/apps → ConnectedAppListResponse */
agentsOauthRoutes.get('/apps', stub);
/** PATCH /api/agents/apps/:id UpdateConnectedAppRequest → ConnectedAppResponse */
agentsOauthRoutes.patch('/apps/:id', stub);
/** DELETE /api/agents/apps/:id → 204 */
agentsOauthRoutes.delete('/apps/:id', stub);
/** GET /api/agents/oauth/consent-info?oauth_query=… → OAuthConsentInfo */
agentsOauthRoutes.get('/oauth/consent-info', stub);
/** POST /api/agents/oauth/consent OAuthConsentDecision → OAuthConsentResult */
agentsOauthRoutes.post('/oauth/consent', stub);

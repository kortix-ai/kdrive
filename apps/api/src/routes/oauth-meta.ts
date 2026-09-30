// OAuth discovery documents for MCP clients, served at the app root:
// authorization-server metadata, OpenID configuration and the protected
// resource document (RFC 8414 / RFC 9728). Public, cacheable and CORS-open;
// all of them answer 404 when agent access is turned off.
import { Hono, type Context } from 'hono';
import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider';
import { AGENT_SCOPES } from '../agents/scopes';
import { MCP_RESOURCE, OAUTH_ISSUER, PUBLIC_ORIGIN } from '../agents/urls';
import { auth } from '../auth';
import { env } from '../env';
import type { AppEnv } from '../types';

export const oauthMetaRoutes = new Hono<AppEnv>();

const CORS = { 'access-control-allow-origin': '*' } as const;
const AS_HEADERS = { ...CORS, 'cache-control': 'public, max-age=300' };
const PRM_HEADERS = { ...CORS, 'cache-control': 'public, max-age=3600' };

/** The protected-resource document for /mcp. */
export function protectedResourceMetadata() {
  return {
    resource: MCP_RESOURCE,
    authorization_servers: [OAUTH_ISSUER],
    bearer_methods_supported: ['header'],
    scopes_supported: [...AGENT_SCOPES],
    resource_name: 'Volumes',
    resource_documentation: `${PUBLIC_ORIGIN}/settings/agents`,
  };
}

const off = (c: Context<AppEnv>) => c.json({ error: { code: 'not_found', message: 'No such route.' } }, 404);

const authServer = oauthProviderAuthServerMetadata(auth, { headers: AS_HEADERS });
const openIdConfig = oauthProviderOpenIdConfigMetadata(auth, { headers: AS_HEADERS });

const asMetadata = (c: Context<AppEnv>) => (env.mcpEnabled ? authServer(c.req.raw) : off(c));
const oidcMetadata = (c: Context<AppEnv>) => (env.mcpEnabled ? openIdConfig(c.req.raw) : off(c));
const prMetadata = (c: Context<AppEnv>) => {
  if (!env.mcpEnabled) return off(c);
  return c.json(protectedResourceMetadata(), 200, PRM_HEADERS);
};
const preflight = (c: Context<AppEnv>) => {
  if (!env.mcpEnabled) return off(c);
  return c.body(null, 204, {
    ...CORS,
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': '*',
    'access-control-max-age': '86400',
  });
};

oauthMetaRoutes.get('/.well-known/oauth-authorization-server', asMetadata);
oauthMetaRoutes.get('/.well-known/oauth-authorization-server/*', asMetadata);
oauthMetaRoutes.get('/.well-known/openid-configuration', oidcMetadata);
oauthMetaRoutes.get('/.well-known/oauth-protected-resource', prMetadata);
oauthMetaRoutes.get('/.well-known/oauth-protected-resource/*', prMetadata);
oauthMetaRoutes.options('/.well-known/oauth-authorization-server', preflight);
oauthMetaRoutes.options('/.well-known/oauth-authorization-server/*', preflight);
oauthMetaRoutes.options('/.well-known/openid-configuration', preflight);
oauthMetaRoutes.options('/.well-known/oauth-protected-resource', preflight);
oauthMetaRoutes.options('/.well-known/oauth-protected-resource/*', preflight);

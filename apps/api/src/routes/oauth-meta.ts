// OAuth discovery documents for MCP clients, served at the app root:
// authorization-server metadata, OpenID configuration and the protected
// resource document. (Builder A fills the handlers.)
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { stub } from './_stub';

export const oauthMetaRoutes = new Hono<AppEnv>();

oauthMetaRoutes.get('/.well-known/oauth-authorization-server', stub);
oauthMetaRoutes.get('/.well-known/oauth-authorization-server/*', stub);
oauthMetaRoutes.get('/.well-known/openid-configuration', stub);
oauthMetaRoutes.get('/.well-known/oauth-protected-resource', stub);
oauthMetaRoutes.get('/.well-known/oauth-protected-resource/*', stub);
oauthMetaRoutes.options('/.well-known/*', stub);

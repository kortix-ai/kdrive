import { oauthProvider } from '@better-auth/oauth-provider';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt } from 'better-auth/plugins';
import { AGENT_SCOPES, OAUTH_IDENTITY_SCOPES } from '../agents/scopes';
import { MCP_RESOURCE, OAUTH_CONSENT_PAGE, OAUTH_ISSUER, OAUTH_SIGN_IN_PAGE } from '../agents/urls';
import { db } from '../db/client';
import { env } from '../env';
import { audit } from '../lib/audit';
import { ensureUserBootstrap, touchLastSignIn } from '../services/workspaces';
import { devLogin } from './dev-login';
import {
  bauthAccount,
  bauthJwks,
  bauthOAuthAccessToken,
  bauthOAuthClient,
  bauthOAuthConsent,
  bauthOAuthRefreshToken,
  bauthSession,
  bauthUser,
  bauthVerification,
} from './schema';

/** Set by app.ts on every request it hands to better-auth (see clientIp in middleware/rate-limit.ts). */
export const CLIENT_IP_HEADER = 'x-vx-client-ip';

const logWarn = (what: string) => (e: unknown) => console.warn(`[auth] ${what} failed:`, e instanceof Error ? e.message : e);

const OAUTH_SCOPES = [...OAUTH_IDENTITY_SCOPES, ...AGENT_SCOPES];

/**
 * better-auth, mirroring Platinum's setup (drizzle adapter, bauth_* tables),
 * without the org / admin plugins. Social providers are enabled only when both
 * their env vars are set. The browser reaches it through the Next rewrite, so
 * baseURL is the web origin.
 *
 * AI agents sign in through the OAuth 2.1 provider: public clients register
 * dynamically, every authorization needs PKCE S256 and the user's consent on
 * /oauth/consent, and a request with resource=<origin>/mcp gets a short-lived
 * ES256 JWT for that audience (verified locally against our own JWKS).
 */
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/api/auth',
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: env.trustedOrigins,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: bauthUser,
      session: bauthSession,
      account: bauthAccount,
      verification: bauthVerification,
      oauthClient: bauthOAuthClient,
      oauthRefreshToken: bauthOAuthRefreshToken,
      oauthAccessToken: bauthOAuthAccessToken,
      oauthConsent: bauthOAuthConsent,
      jwks: bauthJwks,
    },
  }),
  socialProviders: {
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {}),
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
      : {}),
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 30 },
  },
  rateLimit: { enabled: !env.isTest, window: 60, max: 30 },
  advanced: {
    cookiePrefix: 'vx',
    // Secure whenever the public origin is https, whatever NODE_ENV says.
    useSecureCookies: env.secureCookies,
    defaultCookieAttributes: { sameSite: 'lax', httpOnly: true, secure: env.secureCookies },
    ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await ensureUserBootstrap(user).catch(logWarn('bootstrap'));
        },
      },
    },
    session: {
      create: {
        after: async (s) => {
          await audit(null, { kind: 'auth.sign_in', userId: s.userId, meta: { ip: s.ipAddress ?? null }, ip: s.ipAddress ?? null });
          await touchLastSignIn(s.userId).catch(logWarn('touchLastSignIn'));
        },
      },
    },
  },
  plugins: [
    // ES256 signing keys for access tokens; rotate every 30 days, retired keys stay valid 30 more.
    jwt({
      disableSettingJwtHeader: true,
      jwt: { issuer: OAUTH_ISSUER },
      jwks: { keyPairConfig: { alg: 'ES256' }, rotationInterval: 60 * 60 * 24 * 30, gracePeriod: 60 * 60 * 24 * 30 },
    }),
    oauthProvider({
      loginPage: OAUTH_SIGN_IN_PAGE,
      consentPage: OAUTH_CONSENT_PAGE,
      scopes: OAUTH_SCOPES,
      validAudiences: [MCP_RESOURCE],
      grantTypes: ['authorization_code', 'refresh_token'],
      accessTokenExpiresIn: 15 * 60,
      refreshTokenExpiresIn: 30 * 24 * 60 * 60,
      allowDynamicClientRegistration: true,
      // Public clients only; PKCE S256 is always required.
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultScopes: ['offline_access', ...AGENT_SCOPES],
      clientRegistrationAllowedScopes: OAUTH_SCOPES,
      storeClientSecret: 'hashed',
      storeTokens: 'hashed',
      prefix: { opaqueAccessToken: 'vx_oat_', refreshToken: 'vx_ort_', clientSecret: 'vx_ocs_' },
      advertisedMetadata: {
        scopes_supported: OAUTH_SCOPES,
        claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'scope', 'azp'],
      },
      silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
    }),
    ...(env.devLoginEnabled ? [devLogin()] : []),
  ],
});

export type Auth = typeof auth;

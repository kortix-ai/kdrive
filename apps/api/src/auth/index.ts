import { oauthProvider } from '@better-auth/oauth-provider';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { decodeJwt } from 'jose';
import { eq } from 'drizzle-orm';
import { jwt } from 'better-auth/plugins';
import { PASSWORD_MAX, PASSWORD_MIN } from '@volumes/shared';
import { AGENT_SCOPES, OAUTH_IDENTITY_SCOPES } from '../agents/scopes';
import { MCP_RESOURCE, OAUTH_CONSENT_PAGE, OAUTH_ISSUER, OAUTH_SIGN_IN_PAGE } from '../agents/urls';
import { db } from '../db/client';
import { env } from '../env';
import { audit } from '../lib/audit';
import { revokeAllAgentAccess } from '../services/agent-grants';
import { touchLastSignIn } from '../services/workspaces';
import { devLogin } from './dev-login';
import {
  EMAIL_VERIFY_TTL_SECONDS,
  isEmailChangeToken,
  RESET_TTL_SECONDS,
  sendAccountExists,
  sendChangeEmailConfirmation,
  sendPasswordChanged,
  sendResetPassword,
  sendVerification,
  sendWelcome,
} from './emails';
import { hashPassword, verifyPassword } from './password';
import { assertSignupAllowed } from './policy';
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
 * True for a verify-email token that would move an address (the new inbox's step, or a
 * legacy single-step change). better-auth still checks the signature; this only decides
 * whether the request needs a session first. The old inbox's approval needs none.
 */
export function finishesEmailChange(token: unknown): boolean {
  if (typeof token !== 'string' || !token) return false;
  try {
    const p = decodeJwt(token);
    return typeof p.updateTo === 'string' && p.requestType !== 'change-email-confirmation';
  } catch {
    return false;
  }
}

/**
 * better-auth, mirroring Platinum's setup (drizzle adapter, bauth_* tables,
 * argon2id passwords, opt-in email verification), without the org / admin
 * plugins. Social providers are enabled only when both their env vars are set.
 * The browser reaches it through the Next rewrite, so baseURL is the web origin.
 *
 * Account flows are enumeration-safe: sign-up answers the same for a new and a
 * taken address (the owner of a taken one gets an email instead), sign-in says
 * "wrong email or password" for both, and forgot-password and resend-verify
 * always succeed. Mail goes out in the background (see ./emails).
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
  emailAndPassword: {
    enabled: env.emailPassword,
    minPasswordLength: PASSWORD_MIN,
    maxPasswordLength: PASSWORD_MAX,
    // Sign-up never starts a session on its own: that is what lets it answer a new and a
    // taken address identically. The web client signs in with the same password next.
    autoSignIn: false,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: RESET_TTL_SECONDS,
    password: { hash: hashPassword, verify: verifyPassword },
    sendResetPassword: async ({ user, url }) => {
      if (env.emailLinks) sendResetPassword({ user, url });
      else console.warn('[auth] password reset requested, but no email provider is configured');
    },
    // A reset takes the account back: sessions end (above), and so does every agent
    // credential, so whoever held the account before keeps nothing that still works. Opening
    // the mailed link proves the inbox, so the address counts as verified from here on.
    onPasswordReset: async ({ user }) => {
      const agents = await revokeAllAgentAccess(user.id);
      if (!user.emailVerified) {
        await db.update(bauthUser).set({ emailVerified: true, updatedAt: new Date() }).where(eq(bauthUser.id, user.id));
        await audit(null, { kind: 'auth.email_verify', userId: user.id, actorEmail: user.email, meta: { via: 'password_reset' } });
      }
      sendPasswordChanged(user, 'reset', agents);
      await audit(null, { kind: 'auth.password_reset', userId: user.id, actorEmail: user.email, meta: agents });
    },
    onExistingUserSignUp: async ({ user }) => sendAccountExists(user),
  },
  // Opt-in verification, as in Platinum. autoSignInAfterVerification stays false: true would
  // make the mail a password-less sign-in for anyone who can read the mailbox. Whether an
  // unverified user may use the app is our gate (VOLUMES_REQUIRE_EMAIL_VERIFICATION), not
  // better-auth's, so they can still sign in and land on the verify screen.
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: false,
    autoSignInAfterVerification: false,
    expiresIn: EMAIL_VERIFY_TTL_SECONDS,
    sendVerificationEmail: async (data) => sendVerification(data),
    afterEmailVerification: async (user, request) => {
      const change = isEmailChangeToken(request ? new URL(request.url).searchParams.get('token') : null);
      if (!change) sendWelcome(user);
      await audit(null, { kind: change ? 'auth.email_change' : 'auth.email_verify', userId: user.id, actorEmail: user.email });
    },
  },
  user: {
    // Two steps for a verified account: the current inbox approves, the new inbox confirms.
    changeEmail: { enabled: true, updateEmailWithoutVerification: false, sendChangeEmailConfirmation: async (d) => sendChangeEmailConfirmation(d) },
  },
  socialProviders: {
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {}),
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
      : {}),
  },
  account: {
    // Spelled out (these are better-auth's defaults today) so an upgrade cannot loosen them.
    // A provider sign-in joins an existing account with the same address only when the
    // provider vouches for the address (Google's email_verified) AND the account here has
    // proven it too. Otherwise whoever first typed someone's address into the sign-up form,
    // never verified it and kept the password would share the account with its real owner
    // once they arrive with Google. That owner gets ?error=account_not_linked instead and
    // takes the account back with a password reset (which also verifies the address).
    accountLinking: {
      enabled: true,
      trustedProviders: [],
      requireLocalEmailVerified: true,
      allowDifferentEmails: false,
    },
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
    // Explicit, so tests run the same origin, callbackURL and CSRF checks as production
    // (better-auth turns them off under NODE_ENV=test by default).
    disableOriginCheck: false,
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // The sign-up gate runs before better-auth looks the address up, so a refused address
      // gets the same answer whether or not it has an account.
      if (ctx.path === '/sign-up/email') assertSignupAllowed(String(ctx.body?.email ?? ''));
      if (ctx.path === '/change-email') {
        // An unverified account never moves: the address it holds was never proven, so a
        // change would turn an unowned sign-up into a verified account at any address. It can
        // be deleted and created again instead. A new address passes the sign-up gate too.
        const s = await getSessionFromCtx(ctx, { disableCookieCache: true }); // the 30 s cache may predate verification
        if (s && !s.user.emailVerified) {
          throw new APIError('FORBIDDEN', { code: 'EMAIL_NOT_VERIFIED', message: 'Verify your current email before changing it.' });
        }
        assertSignupAllowed(String(ctx.body?.newEmail ?? ''));
      }
      // The last step of an email change signs the browser in when it has no session.
      // Require one: the link must finish a change the account holder started, never open it.
      if (ctx.path === '/verify-email' && finishesEmailChange(ctx.query?.token) && !(await getSessionFromCtx(ctx, { disableCookieCache: true }))) {
        throw new APIError('UNAUTHORIZED', { code: 'SIGN_IN_REQUIRED', message: 'Sign in to confirm your new email.' });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/change-password' || ctx.context.returned instanceof APIError) return;
      const u = ctx.context.session?.user;
      if (!u) return;
      // "Sign out other sessions" with a new password ends agent credentials as well.
      const agents = ctx.body?.revokeOtherSessions === true ? await revokeAllAgentAccess(u.id) : undefined;
      sendPasswordChanged(u, 'change', agents);
      await audit(null, { kind: 'auth.password_change', userId: u.id, actorEmail: u.email, meta: agents ?? {} });
    }),
  },
  databaseHooks: {
    user: {
      create: {
        // Every new account (email, OAuth first sign-in, dev login) passes the mode gate.
        // A refused provider sign-up creates nothing and lands back on the page with
        // ?error=SIGNUP_RESTRICTED (see assertSignupAllowed).
        before: async (user, ctx) => {
          assertSignupAllowed(user.email, ctx);
          return { data: user };
        },
        // No drive here: GET /api/me provisions it on first use, after verification when that
        // is required, so a throwaway sign-up never costs a storage volume.
        after: async (user) => {
          await audit(null, { kind: 'auth.sign_up', userId: user.id, actorEmail: user.email });
          // Provider sign-ups arrive verified: welcome them now. Email sign-ups get it on verify.
          if (user.emailVerified) sendWelcome(user);
        },
      },
      update: {
        // Every path that moves an address (the change-email steps, any future admin edit)
        // passes the same sign-up gate as a new account.
        before: async (data) => {
          if (typeof data.email === 'string') assertSignupAllowed(data.email);
          return { data };
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

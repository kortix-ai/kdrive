import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '../db/client';
import { env } from '../env';
import { audit } from '../lib/audit';
import { ensureUserBootstrap, touchLastSignIn } from '../services/workspaces';
import { devLogin } from './dev-login';
import { bauthAccount, bauthSession, bauthUser, bauthVerification } from './schema';

const logWarn = (what: string) => (e: unknown) => console.warn(`[auth] ${what} failed:`, e instanceof Error ? e.message : e);

/**
 * better-auth, mirroring Platinum's setup (drizzle adapter, bauth_* tables),
 * without the org / admin / oauth plugins. Social providers are enabled only
 * when both their env vars are set. The browser reaches it through the Next
 * rewrite, so baseURL is the web origin.
 */
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/api/auth',
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: env.trustedOrigins,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user: bauthUser, session: bauthSession, account: bauthAccount, verification: bauthVerification },
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
    defaultCookieAttributes: { sameSite: 'lax', httpOnly: true, secure: env.isProd },
    // The Next rewrite forwards the browser's address in x-forwarded-for.
    ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
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
  plugins: env.devLoginEnabled ? [devLogin()] : [],
});

export type Auth = typeof auth;

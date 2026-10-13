import type { MiddlewareHandler } from 'hono';
import { auth } from '../auth';
import { env } from '../env';
import { ApiError } from '../lib/http';
import { isAdminUser } from '../services/admins';
import type { AppEnv } from '../types';

/** Loads the better-auth session (if any) into c.var.user / c.var.session. Never rejects. */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  try {
    // Always check the session row: the 30 s cookie cache would otherwise keep a
    // deleted account (or a revoked session) signed in until it expires.
    const s = await auth.api.getSession({ headers: c.req.raw.headers, query: { disableCookieCache: true } });
    if (s?.user && s.session) {
      c.set('user', {
        id: s.user.id,
        email: s.user.email,
        name: s.user.name ?? null,
        image: s.user.image ?? null,
        emailVerified: !!s.user.emailVerified,
      });
      c.set('session', { id: s.session.id, expiresAt: new Date(s.session.expiresAt) });
    }
  } catch (e) {
    console.warn('[session] lookup failed:', e instanceof Error ? e.message : e);
  }
  await next();
};

/** 401 `unauthorized` without a session. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')) throw new ApiError(401, 'unauthorized', 'Sign in to continue.');
  await next();
};

/** 403 `forbidden` unless the user's verified email is in the `admins` table (see isAdminUser). */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const u = c.get('user');
  if (!u) throw new ApiError(401, 'unauthorized', 'Sign in to continue.');
  if (!(await isAdminUser(u))) throw new ApiError(403, 'forbidden', 'Admins only.');
  await next();
};

/** What an unverified user may still reach while VOLUMES_REQUIRE_EMAIL_VERIFICATION holds them: who am I, and leaving. */
const UNVERIFIED_OK = new Set(['GET /api/me', 'DELETE /api/me']);

/** 403 `email_not_verified` for a signed-in user with an unconfirmed address, when verification is required. */
export function assertEmailVerified(method: string, path: string, user: { emailVerified?: boolean }): void {
  if (!env.requireEmailVerification || user.emailVerified !== false) return;
  if (UNVERIFIED_OK.has(`${method} ${path}`)) return;
  throw new ApiError(403, 'email_not_verified', 'Verify your email to continue. Check your inbox for the link.');
}

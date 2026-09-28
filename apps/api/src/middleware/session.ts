import type { MiddlewareHandler } from 'hono';
import { auth } from '../auth';
import { isAdminEmail } from '../env';
import { ApiError } from '../lib/http';
import type { AppEnv } from '../types';

/** Loads the better-auth session (if any) into c.var.user / c.var.session. Never rejects. */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  try {
    // Always check the session row: the 30 s cookie cache would otherwise keep a
    // deleted account (or a revoked session) signed in until it expires.
    const s = await auth.api.getSession({ headers: c.req.raw.headers, query: { disableCookieCache: true } });
    if (s?.user && s.session) {
      c.set('user', { id: s.user.id, email: s.user.email, name: s.user.name ?? null, image: s.user.image ?? null });
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

/** 403 `forbidden` unless the user's email is in VOLUMES_ADMIN_EMAILS. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const u = c.get('user');
  if (!u) throw new ApiError(401, 'unauthorized', 'Sign in to continue.');
  if (!isAdminEmail(u.email)) throw new ApiError(403, 'forbidden', 'Admins only.');
  await next();
};

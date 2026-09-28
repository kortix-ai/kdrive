import type { MiddlewareHandler } from 'hono';
import { env } from '../env';
import { ApiError } from '../lib/http';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const BLOCK_PUT = /^\/api\/w\/[^/]+\/uploads\/[^/]+\/blocks\/[^/]+$/;

function hasBody(req: Request): boolean {
  const len = req.headers.get('content-length');
  if (len !== null) return Number(len) > 0;
  return req.headers.has('transfer-encoding') || req.body !== null;
}

/**
 * Same-origin + content-type guard for our mutating routes (better-auth guards
 * its own). The Origin must be a trusted origin; a body must be JSON (the
 * block PUT must be application/octet-stream). Failure: 403 `csrf`.
 */
export const csrfGuard: MiddlewareHandler = async (c, next) => {
  const method = c.req.method.toUpperCase();
  const path = c.req.path;
  if (!MUTATING.has(method) || !path.startsWith('/api/') || path.startsWith('/api/auth/')) return next();

  const origin = c.req.header('origin');
  let originOk = false;
  if (origin) originOk = env.trustedOrigins.includes(origin.replace(/\/$/, ''));
  else {
    // Some browsers omit Origin on same-origin requests; fall back to Referer.
    const ref = c.req.header('referer');
    if (ref) {
      try {
        originOk = env.trustedOrigins.includes(new URL(ref).origin);
      } catch {
        originOk = false;
      }
    }
  }
  if (!originOk) throw new ApiError(403, 'csrf', 'Cross-site request refused.');

  if (hasBody(c.req.raw)) {
    const ct = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const want = method === 'PUT' && BLOCK_PUT.test(path) ? 'application/octet-stream' : 'application/json';
    if (ct !== want) throw new ApiError(403, 'csrf', `Content-Type must be ${want}.`);
  }
  return next();
};

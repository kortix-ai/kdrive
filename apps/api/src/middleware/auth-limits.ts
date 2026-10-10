import type { Context } from 'hono';
import { ApiError } from '../lib/http';
import { checkRateLimitKey, clientIp, ipBucket, limits } from './rate-limit';

type Limit = { name: string; capacity: number; refillPerSec: number };

/**
 * Rate limits for the account routes better-auth serves, applied before the request
 * reaches it. Unconditional (unlike better-auth's own limiter, which is off in tests),
 * so the limits that keep sign-in guessing and mail bombing slow are the ones tested.
 *
 * Per route: [per-address bucket or null, per-client bucket]. The address bucket goes
 * first (see limits in rate-limit.ts); both must pass.
 */
const RULES: Record<string, [Limit | null, Limit]> = {
  '/api/auth/sign-in/email': [limits.signInEmail, limits.signInIp],
  '/api/auth/sign-up/email': [limits.signUpEmail, limits.signUpIp],
  '/api/auth/request-password-reset': [limits.mailEmail, limits.mailIp],
  '/api/auth/send-verification-email': [limits.mailEmail, limits.mailIp],
  '/api/auth/reset-password': [null, limits.credentialIp],
  '/api/auth/change-password': [null, limits.credentialIp],
  '/api/auth/change-email': [limits.mailEmail, limits.credentialIp],
};

/** Account bodies are a handful of short fields; anything bigger is refused, never skipped. */
export const AUTH_BODY_MAX = 4096;

/**
 * The JSON object an account route was sent. Fails closed: a body that is not JSON, too
 * big, or not an object is refused here (400 / 413), so it can never slip past the
 * per-address limit by being something we could not read.
 */
export function readAuthBody(contentType: string | undefined, body: ArrayBuffer | undefined): Record<string, unknown> {
  const ct = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (ct !== 'application/json') throw new ApiError(400, 'bad_request', 'Send the request as JSON.');
  if (body && body.byteLength > AUTH_BODY_MAX) throw new ApiError(413, 'payload_too_large', 'Request body is too large.');
  let v: unknown;
  try {
    v = JSON.parse(new TextDecoder().decode(body ?? new ArrayBuffer(0)));
  } catch {
    throw new ApiError(400, 'bad_request', 'Request body is not valid JSON.');
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ApiError(400, 'bad_request', 'Request body must be a JSON object.');
  return v as Record<string, unknown>;
}

/** The lower-cased target address in `field`, or a 400 when there is none. */
export function bodyEmail(body: Record<string, unknown>, field = 'email'): string {
  const v = body[field];
  if (typeof v !== 'string' || !v.trim()) throw new ApiError(400, 'bad_request', 'Enter your email address.');
  return v.trim().toLowerCase();
}

/** Throws 429 `rate_limited` when an account route is over budget, 400 / 413 when its body cannot be read. */
export function checkAuthLimits(c: Context, body: ArrayBuffer | undefined): void {
  if (c.req.method !== 'POST') return;
  const rule = RULES[c.req.path];
  if (!rule) return;
  const [perEmail, perIp] = rule;
  const json = readAuthBody(c.req.header('content-type'), body);
  if (perEmail) {
    const email = bodyEmail(json, c.req.path === '/api/auth/change-email' ? 'newEmail' : 'email');
    checkRateLimitKey(perEmail, `${c.req.path}|${email}`);
  }
  checkRateLimitKey(perIp, `${c.req.path}|${ipBucket(clientIp(c))}`);
}

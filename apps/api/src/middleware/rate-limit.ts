import type { Context, MiddlewareHandler } from 'hono';
import { ApiError } from '../lib/http';

/** The connecting socket's address (from the server), or null when the app runs in-process. */
export function socketIp(c: Context): string | null {
  const b = c.env as { ip?: string | null } | undefined;
  return b?.ip ?? null;
}

/** 127.0.0.0/8, ::1 and their IPv4-mapped forms. */
export function isLoopback(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const v = ip.toLowerCase().replace(/^::ffff:/, '');
  return v === '::1' || v === 'localhost' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v);
}

/**
 * The client's address for rate limits and the audit trail.
 * - A non-loopback peer is the client itself: forwarding headers are ignored.
 * - A loopback peer is the web app's rewrite on this host (the API listens on
 *   127.0.0.1 by default). Only the right-most x-forwarded-for hop is trusted:
 *   it is the one the nearest proxy wrote; anything left of it is client-supplied.
 * - In-process calls (tests, the seed script) have no socket and are treated
 *   like the loopback case.
 */
export function clientIp(c: Context): string {
  const peer = socketIp(c);
  if (peer !== null && !isLoopback(peer)) return peer;
  const hops = (c.req.header('x-forwarded-for') ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const last = hops[hops.length - 1];
  if (last && last.length <= 64) return last;
  return peer ?? 'local';
}

interface Bucket {
  tokens: number;
  updated: number;
}

/** In-memory token bucket keyed by an arbitrary string. */
export class TokenBucket {
  private buckets = new Map<string, Bucket>();
  constructor(
    readonly capacity: number,
    readonly refillPerSec: number,
    private now: () => number = Date.now,
  ) {}

  /** Takes one token. Returns 0 when allowed, else the seconds to wait. */
  take(key: string, cost = 1): number {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, updated: t };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.updated) / 1000) * this.refillPerSec);
    b.updated = t;
    if (b.tokens >= cost) {
      b.tokens -= cost;
      if (this.buckets.size > 50_000) this.prune(t);
      return 0;
    }
    return Math.max(1, Math.ceil((cost - b.tokens) / this.refillPerSec));
  }

  reset(): void {
    this.buckets.clear();
  }

  private prune(t: number): void {
    for (const [k, b] of this.buckets) {
      if (b.tokens + ((t - b.updated) / 1000) * this.refillPerSec >= this.capacity) this.buckets.delete(k);
    }
  }
}

const registry = new Map<string, TokenBucket>();

/** Clears every limiter (tests). */
export function resetRateLimits(): void {
  for (const b of registry.values()) b.reset();
}

export interface RateLimitOptions {
  name: string;
  capacity: number;
  refillPerSec: number;
  /** Bucket key; return null to skip limiting this request. */
  key: (c: Context) => string | null;
}

/** Throws 429 `rate_limited` (+ Retry-After) when the bucket is empty. */
export function checkRateLimit(o: RateLimitOptions, c: Context): void {
  let b = registry.get(o.name);
  if (!b) {
    b = new TokenBucket(o.capacity, o.refillPerSec);
    registry.set(o.name, b);
  }
  const k = o.key(c);
  if (k === null) return;
  const wait = b.take(k);
  if (wait > 0) {
    throw new ApiError(429, 'rate_limited', 'Too many requests. Try again shortly.', { retryAfterSeconds: wait }, {
      'Retry-After': String(wait),
    });
  }
}

export function rateLimit(o: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    checkRateLimit(o, c);
    await next();
  };
}

/** Presets from architecture §6.1. */
export const limits = {
  uploadPlan: { name: 'upload-plan', capacity: 30, refillPerSec: 30 / 60 },
  devSignIn: { name: 'dev-sign-in', capacity: 10, refillPerSec: 10 / 60 },
  /** Backstop across every client: forwarding headers can be forged in front of the rewrite. */
  devSignInAll: { name: 'dev-sign-in-all', capacity: 60, refillPerSec: 1 },
  /** Per user and upload: 1 MiB blocks at up to ~100/s, without touching the user's general budget. */
  blockPut: { name: 'block-put', capacity: 2000, refillPerSec: 100 },
  linkOpenIpToken: { name: 'link-open-ip', capacity: 60, refillPerSec: 1 },
  linkOpenToken: { name: 'link-open-token', capacity: 600, refillPerSec: 10 },
  user: { name: 'user', capacity: 600, refillPerSec: 10 },
} as const;

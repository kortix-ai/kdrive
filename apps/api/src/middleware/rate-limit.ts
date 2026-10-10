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

  /** Gives back `cost` tokens taken for a request that turned out not to count. */
  refund(key: string, cost = 1): void {
    const b = this.buckets.get(key);
    if (b) b.tokens = Math.min(this.capacity, b.tokens + cost);
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
  const k = o.key(c);
  if (k === null) return;
  checkRateLimitKey(o, k);
}

/** checkRateLimit for callers without a Hono context (MCP tool handlers): same buckets, explicit key. */
export function checkRateLimitKey(o: Omit<RateLimitOptions, 'key'>, key: string): void {
  let b = registry.get(o.name);
  if (!b) {
    b = new TokenBucket(o.capacity, o.refillPerSec);
    registry.set(o.name, b);
  }
  const k = key;
  const wait = b.take(k);
  if (wait > 0) {
    throw new ApiError(429, 'rate_limited', 'Too many requests. Try again shortly.', { retryAfterSeconds: wait }, {
      'Retry-After': String(wait),
    });
  }
}

/** Takes a token without throwing: true when allowed (for work that is skipped silently when over budget). */
export function tryTakeRateLimitKey(o: Omit<RateLimitOptions, 'key'>, key: string): boolean {
  let b = registry.get(o.name);
  if (!b) {
    b = new TokenBucket(o.capacity, o.refillPerSec);
    registry.set(o.name, b);
  }
  return b.take(key) === 0;
}

/**
 * The rate-limit identity of a client address. IPv6 clients usually own a whole
 * /64 and can rotate through it freely, so an IPv6 address counts as its /64.
 */
export function ipBucket(ip: string): string {
  const v = ip.trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]!;
  if (!v.includes(':')) return v;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v);
  if (mapped) return mapped[1]!;
  const [head = '', tail] = v.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return `${groups
    .slice(0, 4)
    .map((g) => (Number.parseInt(g, 16) || 0).toString(16))
    .join(':')}::/64`;
}

/** Gives back the token checkRateLimitKey took for `key` (a request that should not count). */
export function refundRateLimitKey(o: Omit<RateLimitOptions, 'key'>, key: string): void {
  registry.get(o.name)?.refund(key);
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
  /**
   * Per client address on /mcp, before the credential is looked up: every
   * attempt takes a token and a successful one gives it back, so only failed
   * authentication is limited (30/min, burst 60).
   */
  mcpAuthIp: { name: 'mcp-auth-ip', capacity: 60, refillPerSec: 0.5 },
  /** Per agent grant on /mcp: 120 requests/min, burst 60. */
  mcp: { name: 'mcp', capacity: 60, refillPerSec: 2 },
  // Account flows (middleware/auth-limits.ts). Where a target address is known it is checked
  // first: it is the axis an attacker cannot rotate (the mailbox being bombed or guessed).
  /** Sign-in: 10 per address per 15 min, 30 per client per 15 min (burst = capacity). */
  signInEmail: { name: 'auth-sign-in-email', capacity: 10, refillPerSec: 10 / 900 },
  signInIp: { name: 'auth-sign-in-ip', capacity: 30, refillPerSec: 30 / 900 },
  /** Sign-up: 5 per address and 10 per client, per hour. */
  signUpEmail: { name: 'auth-sign-up-email', capacity: 5, refillPerSec: 5 / 3600 },
  signUpIp: { name: 'auth-sign-up-ip', capacity: 10, refillPerSec: 10 / 3600 },
  /** "You already have an account" mail: at most one per address per hour (over budget: skipped silently). */
  accountExistsMail: { name: 'auth-account-exists-mail', capacity: 1, refillPerSec: 1 / 3600 },
  /** Anything that sends mail to a named address (forgot password, resend verify): 3 per address, 10 per client, per hour. */
  mailEmail: { name: 'auth-mail-email', capacity: 3, refillPerSec: 3 / 3600 },
  mailIp: { name: 'auth-mail-ip', capacity: 10, refillPerSec: 10 / 3600 },
  /** Token and password submissions (reset, change password, change email): 10 per client per 15 min. */
  credentialIp: { name: 'auth-credential-ip', capacity: 10, refillPerSec: 10 / 900 },
  /** Per agent grant: write_changes calls, 30/min. */
  mcpWrite: { name: 'mcp-write', capacity: 10, refillPerSec: 0.5 },
} as const;

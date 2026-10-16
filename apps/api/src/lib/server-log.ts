import type { ServerLogEntry, ServerLogLevel } from '@volumes/shared';

/**
 * The API's own recent trouble, kept in memory for Admin → Logs → Server log: everything it
 * writes with console.warn / console.error, and every request answered with a 5xx (method,
 * path, status, duration; never a body, a header or the query string). A ring of
 * SERVER_LOG_CAPACITY entries per process, gone on restart. Every message is redacted before
 * it is stored, so a key or token that ends up in a log line never reaches the admin page.
 */
export const SERVER_LOG_CAPACITY = 2000;
/** Longest message kept (the rest is cut). */
const MAX_MESSAGE = 2000;

const ring: ServerLogEntry[] = [];
let nextId = 1;
const since = new Date();

const REDACTED = '[redacted]';

/** Patterns that look like secrets, replaced before anything is stored. */
const SECRET_PATTERNS: RegExp[] = [
  // Authorization values: "Bearer <token>", "Basic <creds>".
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // Stripe and Platinum keys, webhook secrets, our own OAuth token prefixes.
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{6,}/g,
  /\b(?:sk|rk|pk)_[A-Za-z0-9]{16,}/g,
  /\bwhsec_[A-Za-z0-9+/=]{6,}/g,
  /\bpt_(?:live|test)_[A-Za-z0-9_-]{6,}/g,
  /\bvx_o(?:at|rt|cs)_[A-Za-z0-9_-]{6,}/g,
  /\bvx_[A-Za-z0-9]{2,8}_[A-Za-z0-9_-]{16,}/g,
  // key=value / "key": "value" pairs whose name says secret.
  /\b((?:api[_-]?key|secret|token|password|passwd|authorization|cookie|signature)["']?\s*[:=]\s*["']?)[^\s"',;&]{4,}/gi,
  // JWTs.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  // Long hex runs (32+) and long base64 / base64url runs (40+).
  /\b[A-Fa-f0-9]{32,}\b/g,
  /[A-Za-z0-9+/_-]{40,}={0,2}/g,
];

/** Replaces anything that looks like a secret with [redacted]. */
export function redact(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match, prefix?: unknown) => {
      // The key=value pattern keeps its key; "Bearer x" keeps the scheme.
      if (typeof prefix === 'string' && prefix && match.startsWith(prefix)) {
        return /^(bearer|basic)$/i.test(prefix) ? `${prefix} ${REDACTED}` : `${prefix}${REDACTED}`;
      }
      return REDACTED;
    });
  }
  return out;
}

/** Strips the query string and fragment from a path (they can carry tokens). */
export function pathOnly(path: string): string {
  const cut = path.search(/[?#]/);
  return cut >= 0 ? path.slice(0, cut) : path;
}

function push(e: Omit<ServerLogEntry, 'id' | 'at'>): void {
  const message = redact(e.message.length > MAX_MESSAGE ? `${e.message.slice(0, MAX_MESSAGE)}…` : e.message);
  ring.push({ ...e, message, id: nextId++, at: new Date().toISOString() });
  if (ring.length > SERVER_LOG_CAPACITY) ring.splice(0, ring.length - SERVER_LOG_CAPACITY);
}

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

/** Records one console line. */
export function recordConsole(level: ServerLogLevel, args: unknown[]): void {
  push({ level, source: 'console', message: format(args) });
}

/** Records a request answered with a 5xx. */
export function recordRequestError(r: { method: string; path: string; status: number; durationMs: number }): void {
  const path = redact(pathOnly(r.path));
  push({
    level: 'error',
    source: 'request',
    message: `${r.method} ${path} -> ${r.status} (${r.durationMs} ms)`,
    method: r.method,
    path,
    status: r.status,
    durationMs: r.durationMs,
  });
}

let installed = false;

/** Starts copying console.warn / console.error into the ring (idempotent; output is unchanged). */
export function installConsoleCapture(): void {
  if (installed) return;
  installed = true;
  const warn = console.warn.bind(console);
  const error = console.error.bind(console);
  console.warn = (...args: unknown[]) => {
    try {
      recordConsole('warn', args);
    } catch {
      /* never break logging */
    }
    warn(...args);
  };
  console.error = (...args: unknown[]) => {
    try {
      recordConsole('error', args);
    } catch {
      /* never break logging */
    }
    error(...args);
  };
}

/** Newest first, filtered by level and (for polling) to entries after an id. */
export function readServerLog(q: { level?: 'all' | ServerLogLevel; after?: number; limit?: number } = {}): {
  entries: ServerLogEntry[];
  capacity: number;
  since: string;
} {
  const limit = q.limit ?? 500;
  const out: ServerLogEntry[] = [];
  for (let i = ring.length - 1; i >= 0 && out.length < limit; i--) {
    const e = ring[i];
    if (q.after !== undefined && e.id <= q.after) break;
    if (q.level === 'error' && e.level !== 'error') continue;
    out.push(e);
  }
  return { entries: out, capacity: SERVER_LOG_CAPACITY, since: since.toISOString() };
}

/** Empties the ring (tests). */
export function clearServerLog(): void {
  ring.length = 0;
}

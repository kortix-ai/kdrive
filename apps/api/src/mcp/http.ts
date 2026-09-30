// The /mcp endpoint: stateless Streamable HTTP, bearer credentials only.
// Origin check, methods, size cap, auth, rate limit, then one fresh server +
// transport per request (no sessions, no SSE streams).
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Context } from 'hono';
import { isPrincipalFailure, resolvePrincipal } from '../agents/principal';
import { AGENT_SCOPES } from '../agents/scopes';
import { PRM_URL } from '../agents/urls';
import { env } from '../env';
import { ApiError } from '../lib/http';
import { checkRateLimitKey, clientIp, limits } from '../middleware/rate-limit';
import type { AppEnv } from '../types';
import { buildMcpServer } from './server';

/** Largest request body (24 MiB of decoded writes is ~32 MiB of base64 plus JSON). */
export const MCP_MAX_BODY = 34 * 1024 * 1024;
const SCOPE_HINT = ['offline_access', ...AGENT_SCOPES].join(' ');

function jsonError(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

/** Browser origins allowed to call /mcp: the app's trusted origins plus VOLUMES_MCP_ORIGINS. */
export function mcpOriginAllowed(origin: string): boolean {
  const o = origin.replace(/\/$/, '');
  return env.trustedOrigins.includes(o) || env.mcpOrigins.includes(o);
}

function authHeader(error?: 'insufficient_scope'): string {
  const parts = [`resource_metadata="${PRM_URL}"`, `scope="${SCOPE_HINT}"`];
  if (error) parts.unshift(`error="${error}"`);
  return `Bearer ${parts.join(', ')}`;
}

/** Reads the body, refusing it once it grows past `max` bytes. */
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export async function handleMcp(req: Request, c: Context<AppEnv>): Promise<Response> {
  if (!env.mcpEnabled) return jsonError(404, 'not_found', 'No such route.');
  const reqId = c.get('reqId') ?? '-';
  const withId = (r: Response) => {
    r.headers.set('X-Request-Id', reqId);
    return r;
  };

  // 1. Browser-originated calls only from allow-listed origins (native clients send none).
  const origin = req.headers.get('origin');
  if (origin && !mcpOriginAllowed(origin)) return withId(jsonError(403, 'forbidden', 'Origin not allowed.'));

  // 2. Stateless: nothing to stream (GET) and no session to end (DELETE).
  if (req.method !== 'POST') {
    return withId(jsonError(405, 'method_not_allowed', 'Use POST for MCP requests.', { Allow: 'POST' }));
  }

  // 3. Size, before anything is parsed.
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MCP_MAX_BODY) {
    return withId(jsonError(413, 'payload_too_large', 'Request body is too large (at most 34 MiB).'));
  }

  // 4. Auth: bearer only (cookies are never looked at).
  const ip = clientIp(c);
  const p = await resolvePrincipal(req.headers.get('authorization'), { ip });
  if (isPrincipalFailure(p)) {
    const header = authHeader(p.code === 'insufficient_scope' ? 'insufficient_scope' : undefined);
    return withId(jsonError(p.status, p.code, p.message, { 'www-authenticate': header }));
  }

  // 5. Per-credential rate limit.
  try {
    checkRateLimitKey(limits.mcp, `mcp|${p.credential}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) {
      return withId(jsonError(429, 'rate_limited', e.message, e.headers ?? { 'Retry-After': '1' }));
    }
    throw e;
  }

  const body = await readCapped(req, MCP_MAX_BODY);
  if (!body) return withId(jsonError(413, 'payload_too_large', 'Request body is too large (at most 34 MiB).'));
  const buffered = new Request(req.url, { method: 'POST', headers: req.headers, body: body as unknown as BodyInit });

  // 6. One fresh server + transport per request.
  const server = buildMcpServer(p, { reqId, ip });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const res = await transport.handleRequest(buffered);
    const out = new Response(res.body, { status: res.status, headers: res.headers });
    return withId(out);
  } finally {
    // The JSON response is fully built before handleRequest resolves; close frees the per-request server.
    void server.close().catch(() => {});
  }
}

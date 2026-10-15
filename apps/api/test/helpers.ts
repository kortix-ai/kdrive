import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { sql as rawSql } from 'drizzle-orm';
import { BLOCK_SIZE } from '@volumes/shared';
import { generateAgentToken } from '../src/agents/tokens';
import { createApp } from '../src/app';
import { db } from '../src/db/client';
import { MIGRATIONS_DIR } from '../src/db/migrate';
import { agentTokens, type AgentMode, type AgentScope } from '../src/db/schema';
import { newId } from '../src/lib/ids';
import { resetRateLimits } from '../src/middleware/rate-limit';
import { clearAdminUsageCache } from '../src/services/admin-panel';
import { clearAdminCache } from '../src/services/admins';
import { clearTreeCache } from '../src/services/tree';

export const ORIGIN = 'http://localhost:4100';

const TABLES = [
  'stars',
  'recent_opens',
  'proposal_blocks',
  'proposal_files',
  'proposals',
  'agent_grants',
  'agent_tokens',
  'bauth_oauth_access_token',
  'bauth_oauth_refresh_token',
  'bauth_oauth_consent',
  'bauth_oauth_client',
  'bauth_jwks',
  'audit_events',
  'admins',
  'storage_requests',
  'billing_accounts',
  'billing_events',
  'quota_reservations',
  'uploads',
  'share_links',
  'checkpoints',
  'action_paths',
  'actions',
  'workspaces',
  'user_settings',
  'bauth_verification',
  'bauth_account',
  'bauth_session',
  'bauth_user',
];

/** The admins the migrations seed (re-run after every reset, so tests see what a new server has). */
const ADMIN_SEED = readFileSync(nodePath.join(MIGRATIONS_DIR, '0009_admins.sql'), 'utf8').match(/INSERT INTO "admins"[^;]*;/g) ?? [];

/** The admin every suite signs in as (besides the seeded one). */
export const TEST_ADMIN = 'admin@test.local';

/** TRUNCATE every table (CASCADE), re-seed the admins and clear in-memory limiters and caches. */
export async function resetDb(): Promise<void> {
  await db.execute(rawSql.raw(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`));
  for (const stmt of ADMIN_SEED) await db.execute(rawSql.raw(stmt));
  await db.execute(rawSql`INSERT INTO admins (email) VALUES (${TEST_ADMIN})`);
  resetRateLimits();
  clearTreeCache();
  clearAdminCache();
  clearAdminUsageCache();
}

let app: ReturnType<typeof createApp> | null = null;
export function makeApp() {
  if (!app) app = createApp();
  return app;
}

export type Json = Record<string, any>;

export interface TestResponse<T = Json> {
  status: number;
  headers: Headers;
  body: T;
  text: string;
}

/** A signed-in client: cookie jar + `Origin: http://localhost:4100` on every request. */
export class TestClient {
  cookies = new Map<string, string>();
  constructor(readonly email: string) {}

  cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  absorb(res: Response): void {
    const list = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const sc of list) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (/max-age=0/i.test(sc) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  /** Low level: any method, any body, any headers. Returns the raw Response. */
  async raw(method: string, path: string, init: { body?: BodyInit | null; headers?: Record<string, string> } = {}): Promise<Response> {
    const headers = new Headers({ origin: ORIGIN, ...(init.headers ?? {}) });
    const cookie = this.cookieHeader();
    if (cookie) headers.set('cookie', cookie);
    const res = await makeApp().fetch(new Request(`http://localhost:4101${path}`, { method, headers, body: init.body ?? null }));
    this.absorb(res);
    return res;
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<TestResponse<T>> {
    const res = await this.raw(method, path, {
      body: body === undefined ? null : JSON.stringify(body),
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: res.status, headers: res.headers, body: parsed as T, text };
  }

  get<T = Json>(path: string) {
    return this.json<T>('GET', path);
  }
  post<T = Json>(path: string, body: unknown = {}) {
    return this.json<T>('POST', path, body);
  }
  put<T = Json>(path: string, body: unknown = {}) {
    return this.json<T>('PUT', path, body);
  }
  patch<T = Json>(path: string, body: unknown = {}) {
    return this.json<T>('PATCH', path, body);
  }
  del<T = Json>(path: string, body?: unknown) {
    return this.json<T>('DELETE', path, body);
  }
}

/** Signs in (creating the user on first use) through the dev login endpoint. */
export async function signIn(email: string, name?: string): Promise<TestClient> {
  const client = new TestClient(email);
  const res = await client.post('/api/auth/dev/sign-in', { email, name });
  if (res.status !== 200) throw new Error(`dev sign-in failed: ${res.status} ${res.text}`);
  return client;
}

/** A signed-in client plus its default workspace id. */
export async function signInWithWorkspace(email: string): Promise<{ client: TestClient; ws: string; me: Json }> {
  const client = await signIn(email);
  const me = await client.get('/api/me');
  if (me.status !== 200) throw new Error(`/api/me failed: ${me.status} ${me.text}`);
  return { client, ws: me.body.defaultWorkspaceId as string, me: me.body };
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** 1 MiB blocks + their sha256 (the last block is short, never padded). */
export function blocksOf(bytes: Uint8Array): { sha: string; bytes: Uint8Array }[] {
  const out: { sha: string; bytes: Uint8Array }[] = [];
  for (let off = 0; off < bytes.length; off += BLOCK_SIZE) {
    const chunk = bytes.subarray(off, Math.min(off + BLOCK_SIZE, bytes.length));
    out.push({ sha: sha256Hex(chunk), bytes: chunk });
  }
  return out;
}

export const enc = (s: string) => new TextEncoder().encode(s);

/**
 * Drives plan → PUT missing blocks → commit through the HTTP API
 * (requires the API-files upload routes). Returns the commit response body.
 */
export async function uploadFile(
  client: TestClient,
  ws: string,
  path: string,
  bytes: Uint8Array | string,
  opts: { conflict?: 'ask' | 'keep-both' | 'replace'; mtime?: number; actionId?: string } = {},
): Promise<{ plan: Json; commit: Json; sent: number }> {
  const data = typeof bytes === 'string' ? enc(bytes) : bytes;
  const blocks = blocksOf(data);
  const plan = await client.post(`/api/w/${ws}/uploads`, {
    files: [{ path, size: data.length, blocks: blocks.map((b) => b.sha), mtime: opts.mtime }],
    dirs: [],
    conflict: opts.conflict ?? 'replace',
    actionId: opts.actionId,
  });
  if (plan.status !== 200 && plan.status !== 201) throw new Error(`plan failed: ${plan.status} ${plan.text}`);
  const missing = new Set<string>(plan.body.missing);
  let sent = 0;
  for (const b of blocks) {
    if (!missing.has(b.sha)) continue;
    missing.delete(b.sha);
    const r = await client.raw('PUT', `/api/w/${ws}/uploads/${plan.body.uploadId}/blocks/${b.sha}`, {
      body: b.bytes as unknown as BodyInit,
      headers: { 'content-type': 'application/octet-stream' },
    });
    if (r.status !== 204) throw new Error(`block PUT failed: ${r.status} ${await r.text()}`);
    sent++;
  }
  const commit = await client.post(`/api/w/${ws}/uploads/${plan.body.uploadId}/commit`, {});
  if (commit.status !== 200) throw new Error(`commit failed: ${commit.status} ${commit.text}`);
  return { plan: plan.body, commit: commit.body, sent };
}

/**
 * Inserts an agent token straight into the database and returns its secret
 * (the tokens route is not needed). Expires in a year unless `expiresAt` says otherwise.
 */
export async function createAgentToken(
  userId: string,
  opts: { scope: AgentScope; mode?: AgentMode; workspaceId?: string | null; name?: string; expiresAt?: Date },
): Promise<string> {
  const t = generateAgentToken();
  await db.insert(agentTokens).values({
    id: newId(),
    userId,
    name: opts.name ?? 'Test agent',
    tokenHash: t.hash,
    tokenPrefix: t.prefix,
    scope: opts.scope,
    mode: opts.mode ?? 'review',
    workspaceId: opts.workspaceId ?? null,
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 365 * 86_400_000),
  });
  return t.secret;
}

let rpcId = 0;

/**
 * One raw JSON-RPC call to /mcp through the in-process app (no MCP client):
 * returns the HTTP status, headers and the parsed JSON body (null when empty).
 */
export async function mcpCall(
  app: { fetch: (req: Request) => Response | Promise<Response> },
  secret: string | null,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Headers; body: Json | null; text: string }> {
  const h = new Headers({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-06-18',
    ...headers,
  });
  if (secret) h.set('authorization', `Bearer ${secret}`);
  const res = await app.fetch(
    new Request('http://localhost:4101/mcp', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    }),
  );
  const text = await res.text();
  let body: Json | null = null;
  try {
    body = text ? (JSON.parse(text) as Json) : null;
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, body, text };
}

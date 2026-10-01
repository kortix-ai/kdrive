// Shared fixtures for the end-to-end suites: every suite drives the real Hono
// app over HTTP (dev sign-in cookie jar, same-origin Origin header) against the
// emulated driver and the volumes_test database.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { setStoreForTests } from '../../src/storage';
import { EmulatedStore, type EmulatedStoreOptions } from '../../src/storage/emulated';
import { resetRateLimits } from '../../src/middleware/rate-limit';
import { blocksOf, enc, resetDb, signInWithWorkspace, type Json, type TestClient } from '../helpers';

let dir: string | null = null;
let current: EmulatedStore | null = null;

/**
 * beforeEach: an empty database and a brand-new emulator in its own temp dir.
 * The emulator caps live volumes per process (like a Platinum org), and
 * resetDb() leaves volumes alone, so each test gets a clean store.
 */
export async function freshWorld(opts: Omit<EmulatedStoreOptions, 'dir'> = {}): Promise<EmulatedStore> {
  await resetDb();
  endWorld();
  dir = mkdtempSync(nodePath.join(tmpdir(), 'vx-e2e-'));
  current = new EmulatedStore({ dir, ...opts });
  setStoreForTests(current);
  resetRateLimits();
  return current;
}

/** afterEach / afterAll: back to the default store and drop the temp dir. */
export function endWorld(): void {
  setStoreForTests(null);
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
  current = null;
}

export interface User {
  client: TestClient;
  ws: string;
  me: Json;
  userId: string;
}

export async function user(email: string): Promise<User> {
  const r = await signInWithWorkspace(email);
  return { ...r, userId: r.me.user.id as string };
}

export type Tree = Record<string, string | Uint8Array>;

/**
 * One upload through the HTTP relay: plan → PUT only the missing blocks →
 * commit. Returns the plan, the commit response and how many blocks were sent.
 */
export async function upload(
  u: Pick<User, 'client' | 'ws'>,
  files: Tree,
  opts: { dirs?: string[]; conflict?: 'ask' | 'keep-both' | 'replace'; actionId?: string } = {},
): Promise<{ plan: Json; commit: Json; sent: number; sentBytes: number }> {
  const list = Object.entries(files).map(([path, v]) => {
    const bytes = typeof v === 'string' ? enc(v) : v;
    return { path, bytes, blocks: blocksOf(bytes) };
  });
  const plan = await u.client.post(`/api/w/${u.ws}/uploads`, {
    files: list.map((f) => ({ path: f.path, size: f.bytes.length, blocks: f.blocks.map((b) => b.sha) })),
    dirs: opts.dirs ?? [],
    conflict: opts.conflict ?? 'replace',
    ...(opts.actionId ? { actionId: opts.actionId } : {}),
  });
  if (plan.status !== 200) throw new Error(`plan ${plan.status}: ${plan.text}`);
  const missing = new Set<string>(plan.body.missing);
  let sent = 0;
  let sentBytes = 0;
  for (const f of list) {
    for (const b of f.blocks) {
      if (!missing.has(b.sha)) continue;
      missing.delete(b.sha);
      const r = await u.client.raw('PUT', `/api/w/${u.ws}/uploads/${plan.body.uploadId}/blocks/${b.sha}`, {
        body: b.bytes as unknown as BodyInit,
        headers: { 'content-type': 'application/octet-stream' },
      });
      if (r.status !== 204) throw new Error(`block ${r.status}: ${await r.text()}`);
      sent++;
      sentBytes += b.bytes.length;
    }
  }
  const commit = await u.client.post(`/api/w/${u.ws}/uploads/${plan.body.uploadId}/commit`, {});
  if (commit.status !== 200) throw new Error(`commit ${commit.status}: ${commit.text}`);
  return { plan: plan.body, commit: commit.body, sent, sentBytes };
}

export const q = (params: Record<string, string | string[] | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) s.append(k, one);
  }
  return s.toString();
};

export async function ls(u: Pick<User, 'client' | 'ws'>, path = '/', at?: string): Promise<string[]> {
  const r = await u.client.get(`/api/w/${u.ws}/files?${q({ path, at })}`);
  if (r.status !== 200) throw new Error(`list ${r.status}: ${r.text}`);
  return (r.body.entries as Json[]).map((e) => (e.type === 'dir' ? `${e.name}/` : e.name));
}

export async function text(u: Pick<User, 'client' | 'ws'>, path: string, at?: string): Promise<string> {
  const r = await u.client.raw('GET', `/api/w/${u.ws}/files/content?${q({ path, at })}`);
  if (r.status !== 200) throw new Error(`content ${r.status}: ${await r.text()}`);
  return r.text();
}

export async function head(u: Pick<User, 'client' | 'ws'>): Promise<string> {
  const r = await u.client.get(`/api/w/${u.ws}/commits/head`);
  if (r.status !== 200) throw new Error(`head ${r.status}: ${r.text}`);
  return r.body.id as string;
}

export async function timeline(u: Pick<User, 'client' | 'ws'>, limit = 50): Promise<Json[]> {
  const r = await u.client.get(`/api/w/${u.ws}/timeline?limit=${limit}`);
  if (r.status !== 200) throw new Error(`timeline ${r.status}: ${r.text}`);
  return r.body.entries as Json[];
}

/** Minimal zip reader (client-zip stores entries uncompressed). */
export function readZip(buf: Uint8Array): Map<string, Uint8Array | null> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('no end of central directory');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array | null>();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const csize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const local = dv.getUint32(off + 42, true);
    const name = dec.decode(buf.subarray(off + 46, off + 46 + nameLen));
    const lNameLen = dv.getUint16(local + 26, true);
    const lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    out.set(name, name.endsWith('/') ? null : buf.subarray(start, start + csize));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export const dec = (b: Uint8Array | null | undefined) => (b ? new TextDecoder().decode(b) : '');

// AI agent access: tokens inserted directly, raw JSON-RPC to /mcp, and a real server for SDK clients.
export { createAgentToken, mcpCall } from '../helpers';
export { startServer, type RunningServer } from './spawn-server';

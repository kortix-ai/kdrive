// Test fixtures for the versioning suites (API-versioning). They perform user
// actions the way the file routes record them in the ledger (upload with block
// lists, rename/move, delete, new folder), straight against the store, so the
// versioning tests do not depend on the HTTP file routes.

import { BLOCK_SIZE, basename, dirname } from '@volumes/shared';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { resetDb, signInWithWorkspace, type TestClient } from '../../test/helpers';
import { getStore, setStoreForTests } from '../storage';
import { EmulatedStore, type EmulatedStoreOptions } from '../storage/emulated';
import type { VolumeStore } from '../storage/types';
import { withAction, lastKnownBlocks, type ActionCtx } from './ledger';
import { statOrNull, listTree } from './tree';
import { getWorkspaceForUser } from './workspaces';

let freshDir: string | null = null;

/**
 * beforeEach: empty DB + a brand-new emulator in its own temp dir, so these
 * suites never eat into the shared emulator's volume limit.
 */
export async function freshWorld(opts: Omit<EmulatedStoreOptions, 'dir'> = {}): Promise<EmulatedStore> {
  await resetDb();
  cleanWorld();
  freshDir = mkdtempSync(nodePath.join(tmpdir(), 'vx-versioning-'));
  const store = new EmulatedStore({ dir: freshDir, ...opts });
  setStoreForTests(store);
  return store;
}

/** afterEach: back to the default store; drop the temp emulator. */
export function cleanWorld(): void {
  setStoreForTests(null);
  if (freshDir) rmSync(freshDir, { recursive: true, force: true });
  freshDir = null;
}

export const te = (s: string) => new TextEncoder().encode(s);

export function blocksOf(bytes: Uint8Array): { sha: string; bytes: Uint8Array }[] {
  const out: { sha: string; bytes: Uint8Array }[] = [];
  for (let off = 0; off < bytes.length; off += BLOCK_SIZE) {
    const chunk = bytes.subarray(off, Math.min(off + BLOCK_SIZE, bytes.length));
    out.push({ sha: createHash('sha256').update(chunk).digest('hex'), bytes: chunk });
  }
  return out;
}

export interface Kit {
  client: TestClient;
  ws: string;
  ctx: ActionCtx;
  vol: string;
}

export async function kitFor(email: string): Promise<Kit> {
  const { client, ws, me } = await signInWithWorkspace(email);
  const w = await getWorkspaceForUser(me.user.id, ws);
  if (!w) throw new Error('workspace missing');
  return { client, ws, ctx: { ws: w, userId: me.user.id }, vol: w.volumeId };
}

/** Upload one or more files as ONE action (plan → PUT missing → commit), recording block lists. */
export async function upload(k: Kit, files: Record<string, string | Uint8Array>, opts: { dirs?: string[]; summary?: string } = {}) {
  const store = getStore();
  const list = Object.entries(files).map(([path, v]) => {
    const bytes = typeof v === 'string' ? te(v) : v;
    return { path, bytes, blocks: blocksOf(bytes) };
  });
  const paths = [];
  for (const f of list) {
    const prev = await statOrNull(k.ctx.ws, f.path);
    paths.push({
      op: prev ? ('changed' as const) : ('added' as const),
      path: f.path,
      entryType: 'file' as const,
      size: f.bytes.length,
      prevSize: prev?.size,
      blockHashes: f.blocks.map((b) => b.sha),
    });
  }
  let sent = 0;
  const r = await withAction(
    k.ctx,
    { kind: 'upload', summary: opts.summary ?? `Uploaded ${list.map((f) => basename(f.path)).join(', ')}`, paths },
    async (rec) => {
      const plan = await store.planUpload(k.vol, {
        files: list.map((f) => ({ path: f.path, size: f.bytes.length, blocks: f.blocks.map((b) => b.sha) })),
        dirs: opts.dirs ?? [],
        overwrite: true,
      });
      const missing = new Set(plan.missing);
      for (const f of list)
        for (const b of f.blocks) {
          if (!missing.has(b.sha)) continue;
          missing.delete(b.sha);
          await store.putBlock(k.vol, plan.uploadId, b.sha, b.bytes);
          sent++;
        }
      const c = await store.commitUpload(k.vol, plan.uploadId);
      await rec.commit(c);
      return c;
    },
  );
  return { ...r, sent };
}

export async function mkdir(k: Kit, path: string) {
  const store = getStore();
  return withAction(k.ctx, { kind: 'folder.create', summary: `Created folder ${basename(path)}`, paths: [{ op: 'added', path, entryType: 'dir' }] }, async (rec) => {
    const plan = await store.planUpload(k.vol, { files: [], dirs: [path], overwrite: false });
    await rec.commit(await store.commitUpload(k.vol, plan.uploadId));
  });
}

export async function move(k: Kit, from: string, to: string, kind: 'rename' | 'move' = dirname(from) === dirname(to) ? 'rename' : 'move') {
  const store = getStore();
  const s = await statOrNull(k.ctx.ws, from);
  if (!s) throw new Error(`no ${from}`);
  const known = s.type === 'file' ? await lastKnownBlocks(k.ctx.ws.id, from, new Date()) : null;
  return withAction(
    k.ctx,
    {
      kind,
      summary: kind === 'rename' ? `Renamed ${basename(from)} to ${basename(to)}` : `Moved ${basename(from)} to ${dirname(to)}`,
      paths: [
        {
          op: 'moved',
          path: to,
          fromPath: from,
          entryType: s.type === 'dir' ? 'dir' : 'file',
          size: s.size,
          blockHashes: known && known.size === s.size ? known.blocks : undefined,
        },
      ],
    },
    async (rec) => rec.commit(await store.move(k.vol, from, to)),
  );
}

export async function remove(k: Kit, ...paths: string[]) {
  const store = getStore();
  const changes = [];
  for (const p of paths) {
    const s = await statOrNull(k.ctx.ws, p);
    if (!s) throw new Error(`no ${p}`);
    const size = s.type === 'dir' ? (await listTree(k.ctx.ws, p)).entries.reduce((n, e) => n + (e.type === 'dir' ? 0 : e.size), 0) : s.size;
    changes.push({ op: 'deleted' as const, path: p, entryType: s.type === 'dir' ? ('dir' as const) : ('file' as const), size });
  }
  return withAction(
    k.ctx,
    { kind: 'delete', summary: paths.length === 1 ? `Deleted ${basename(paths[0])}` : `Deleted ${paths.length} items`, paths: changes },
    async (rec) => {
      for (const p of paths) await rec.commit(await store.remove(k.vol, p, { recursive: true }));
    },
  );
}

export async function readText(k: Kit, path: string, at?: string): Promise<string> {
  const r = await getStore().read(k.vol, path, { at });
  return new TextDecoder().decode(new Uint8Array(await new Response(r.body).arrayBuffer()));
}

/** Wraps the current store and counts block PUTs (to prove restores send no bytes). */
export function countingStore(): { counts: { putBlock: number; missing: number }; restore: () => void } {
  const real = getStore();
  const counts = { putBlock: 0, missing: 0 };
  const proxy = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'putBlock') {
        return (...args: Parameters<VolumeStore['putBlock']>) => {
          counts.putBlock++;
          return target.putBlock(...args);
        };
      }
      if (prop === 'planUpload') {
        return async (...args: Parameters<VolumeStore['planUpload']>) => {
          const r = await target.planUpload(...args);
          counts.missing += r.missing.length;
          return r;
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  setStoreForTests(proxy);
  return { counts, restore: () => setStoreForTests(real) };
}

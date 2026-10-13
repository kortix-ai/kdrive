// A paged (infinite) list whose page request is still in flight when the session ends
// must not write the previous user's page back into the cache when it resolves.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { MeResponse } from '@volumes/shared';

const me: MeResponse = {
  user: { id: 'u1', email: 'alice@b.c', name: 'Alice', image: null, emailVerified: true },
  isAdmin: false,
  defaultWorkspaceId: 'ws-default',
  workspaces: [{ id: 'ws-default', name: 'My Drive', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z', usageBytes: 0, forkedFrom: null, role: 'owner' as const, owner: null }],
  usage: { quotaBytes: 10, usedBytes: 0, level: 'ok', byWorkspace: [] },
};

let React: typeof import('react');
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
const pending: ((r: Response) => void)[] = [];

beforeAll(async () => {
  GlobalRegistrator.register({ url: 'http://localhost:4100/drive' });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (() => new Promise<Response>((r) => pending.push(r))) as unknown as typeof fetch;
  React = await import('react');
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

describe('sign-out and paged lists', () => {
  test('a timeline page in flight at sign-out does not refill the cache', async () => {
    const { cache } = await import('swr/_internal');
    const { useVx } = await import('@/lib/store');
    const { useTimeline } = await import('./hooks');
    const { endSession } = await import('@/lib/session');

    useVx.getState().setMe(me);
    function Timeline() {
      useTimeline();
      return null;
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<Timeline />));
    for (let i = 0; i < 20 && !pending.length; i++) await wait(5);
    expect(pending.length).toBeGreaterThan(0);

    await act(async () => endSession());
    await act(async () => root.unmount());
    host.remove();

    // The previous user's page arrives after the session ended.
    const page = { entries: [], nextCursor: null, headCommitId: 'vc_alice_head' };
    for (const r of pending.splice(0)) r(new Response(JSON.stringify(page), { status: 200, headers: { 'content-type': 'application/json' } }));
    await wait(30);

    const leaked = [...cache.keys()].filter((k) => JSON.stringify(cache.get(k)?.data ?? null).includes('vc_alice_head'));
    expect(leaked).toEqual([]);
  });

  test('every paged list binds its fetcher to the session', () => {
    const root = resolve(import.meta.dir, '../..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const src = readFileSync(p, 'utf8');
          const calls = src.match(/useSWRInfinite</g)?.length ?? 0;
          const bound = src.match(/sessionBound\(/g)?.length ?? 0;
          if (calls > bound) offenders.push(relative(root, p));
        }
      }
    };
    for (const d of ['app', 'components', 'lib']) walk(join(root, d));
    expect(offenders).toEqual([]);
  });
});

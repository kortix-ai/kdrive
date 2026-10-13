// A session that ends outside this tab (signed out in another tab, or expired): the next
// /me answers 401. The shell must end the session here too, so the previous user's state
// and cached responses are gone and the sign-in page does not bounce back to the drive.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import type { MeResponse } from '@volumes/shared';

const replaced: string[] = [];
const router = { replace: (u: string) => void replaced.push(u), push: (u: string) => void replaced.push(u), prefetch: () => {}, back: () => {}, refresh: () => {} };
let pathname = '/drive';
mock.module('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(pathname.startsWith('/signin') ? 'next=%2Fdrive' : ''),
}));

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

beforeAll(async () => {
  GlobalRegistrator.register({ url: 'http://localhost:4100/drive' });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/config')) return json(200, { providers: [], devLogin: true, storage: 'emulated', retention: '' });
    // Every signed-in call now fails: the session ended elsewhere.
    return json(401, { error: { code: 'unauthorized', message: 'Sign in.' } });
  }) as unknown as typeof fetch;
  React = await import('react');
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

describe('a session that ended outside this tab', () => {
  test('a 401 from /me ends the session here and sign-in stays on /signin', async () => {
    const { mutate } = await import('swr');
    const { cache } = await import('swr/_internal');
    const { useVx } = await import('@/lib/store');
    const { AppShell } = await import('./app-shell');
    const SignInPage = (await import('@/app/signin/page')).default;

    // Alice was signed in in this tab: her identity is cached and in the store.
    await mutate('me', me, false);
    useVx.getState().setMe(me);
    useVx.getState().select(['/payroll.xlsx']);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<AppShell>{null}</AppShell>));
    for (let i = 0; i < 20 && !replaced.some((u) => u.startsWith('/signin')); i++) await wait(10);
    await wait(20);
    expect(replaced.find((u) => u.startsWith('/signin'))).toBe('/signin?next=%2Fdrive');
    await act(async () => root.unmount());

    // The session is over in this tab too.
    expect(useVx.getState().me).toBeNull();
    expect(useVx.getState().selection).toEqual([]);
    expect(cache.get('me')?.data).toBeUndefined();

    // The sign-in page must not send the tab straight back to the drive.
    pathname = '/signin';
    replaced.length = 0;
    const root2 = createRoot(host);
    await act(async () => root2.render(<SignInPage />));
    await wait(50);
    expect(replaced).toEqual([]);
    await act(async () => root2.unmount());
    host.remove();
  });
});

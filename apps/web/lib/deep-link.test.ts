// Deep links from agents: an owned `ws` switches the workspace and is stripped from the URL,
// an unknown one toasts and stays, and `file` on /drive/** opens the preview once.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { MeResponse } from '@volumes/shared';

const replaced: string[] = [];
let pathname = '/drive';
const router = { replace: (u: string) => void replaced.push(u), push: () => {}, prefetch: () => {}, back: () => {}, refresh: () => {} };
mock.module('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

const me: MeResponse = {
  user: { id: 'u1', email: 'a@b.c', name: 'A', image: null },
  isAdmin: false,
  defaultWorkspaceId: 'ws-home',
  workspaces: [
    { id: 'ws-home', name: 'My Drive', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z', usageBytes: 0, forkedFrom: null },
    { id: 'ws-work', name: 'Work', isDefault: false, createdAt: '2026-01-01T00:00:00.000Z', usageBytes: 0, forkedFrom: null },
  ],
  usage: { quotaBytes: 10, usedBytes: 0, level: 'ok', byWorkspace: [] },
};

const lists: string[] = [];
let React: typeof import('react');
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;

beforeAll(async () => {
  GlobalRegistrator.register({ url: 'http://localhost:4100/drive' });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    lists.push(url);
    const body = {
      path: '/Reports',
      commitId: 'vc_1',
      entries: [
        { path: '/Reports/q3 plan.md', name: 'q3 plan.md', type: 'file', size: 10, mtime: 0 },
        { path: '/Reports/old', name: 'old', type: 'dir', size: 0, mtime: 0 },
      ],
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  React = await import('react');
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

beforeEach(async () => {
  replaced.length = 0;
  lists.length = 0;
  const { useVx } = await import('./store');
  useVx.setState({ me, workspaceId: 'ws-home', toasts: [], panel: null } as never);
});

const tick = (ms = 10) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

async function mountAt(url: string) {
  const u = new URL(url, 'http://localhost:4100');
  window.history.replaceState(null, '', u.pathname + u.search);
  pathname = u.pathname;
  const { SWRConfig } = await import('swr');
  const { useDeepLink } = await import('./deep-link');
  function Probe() {
    useDeepLink();
    return null;
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, React.createElement(Probe))));
  return {
    rerender: () => act(async () => root.render(React.createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, React.createElement(Probe)))),
    unmount: () => act(async () => root.unmount()),
  };
}

describe('planDeepLink', () => {
  test('owned, current, unknown and missing workspaces', async () => {
    const { planDeepLink } = await import('./deep-link');
    const p1 = planDeepLink({ pathname: '/proposals/p1', search: '?ws=ws-work' }, me, 'ws-home');
    expect(p1).toEqual({ switchTo: 'ws-work', unknownWs: false, file: null, cleanUrl: '/proposals/p1' });
    const p2 = planDeepLink({ pathname: '/drive', search: '?ws=ws-home&view=grid' }, me, 'ws-home');
    expect(p2.switchTo).toBeNull();
    expect(p2.cleanUrl).toBe('/drive?view=grid');
    const p3 = planDeepLink({ pathname: '/drive/Reports', search: '?ws=ws-other&file=a.md' }, me, 'ws-home');
    expect(p3.unknownWs).toBe(true);
    expect(p3.file).toBeNull();
    expect(p3.cleanUrl).toBe('/drive/Reports');
    expect(planDeepLink({ pathname: '/drive', search: '' }, me, 'ws-home').cleanUrl).toBeNull();
  });

  test('file only on the drive, decoded folder, no path tricks', async () => {
    const { drivePathOf, planDeepLink } = await import('./deep-link');
    expect(drivePathOf('/drive')).toBe('/');
    expect(drivePathOf('/drive/My%20Docs/sub')).toBe('/My Docs/sub');
    expect(drivePathOf('/drives')).toBeNull();
    expect(drivePathOf('/proposals')).toBeNull();
    const ok = planDeepLink({ pathname: '/drive/Reports', search: '?ws=ws-work&file=q3%20plan.md' }, me, 'ws-home');
    expect(ok.file).toEqual({ ws: 'ws-work', dir: '/Reports', name: 'q3 plan.md' });
    expect(planDeepLink({ pathname: '/checkpoints', search: '?file=a.md' }, me, 'ws-home').file).toBeNull();
    expect(planDeepLink({ pathname: '/drive', search: '?file=..%2Fx' }, me, 'ws-home').file).toBeNull();
    expect(planDeepLink({ pathname: '/drive', search: '?file=..' }, me, 'ws-home').file).toBeNull();
  });
});

describe('useDeepLink', () => {
  test('an owned ws switches the workspace and is stripped from the URL', async () => {
    const { useVx } = await import('./store');
    const m = await mountAt('/proposals/p1?ws=ws-work');
    expect(useVx.getState().workspaceId).toBe('ws-work');
    expect(replaced).toEqual(['/proposals/p1']);
    expect(useVx.getState().toasts.length).toBe(0);
    await m.unmount();
  });

  test('an unknown ws toasts and stays', async () => {
    const { useVx } = await import('./store');
    const m = await mountAt('/drive?ws=ws-nope');
    expect(useVx.getState().workspaceId).toBe('ws-home');
    expect(useVx.getState().toasts.map((t) => t.message)).toEqual(["That drive isn't available."]);
    expect(replaced).toEqual(['/drive']);
    await m.unmount();
  });

  test('file opens the preview once the listing loads, and only once', async () => {
    const { useVx } = await import('./store');
    const m = await mountAt('/drive/Reports?ws=ws-work&file=q3%20plan.md');
    expect(useVx.getState().workspaceId).toBe('ws-work');
    for (let i = 0; i < 40 && !useVx.getState().panel; i++) await tick();
    expect(useVx.getState().panel).toEqual({ kind: 'preview', path: '/Reports/q3 plan.md', at: null });
    expect(lists.some((u) => u.startsWith('/api/w/ws-work/files?path=%2FReports'))).toBe(true);
    expect(replaced).toEqual(['/drive/Reports']);
    // The user closes it; nothing opens it again (the URL was cleaned and the link handled).
    useVx.getState().closePanel();
    await m.rerender();
    await tick(30);
    expect(useVx.getState().panel).toBeNull();
    await m.unmount();
  });

  test('a file that is not in the folder toasts instead', async () => {
    const { useVx } = await import('./store');
    const m = await mountAt('/drive/Reports?file=gone.md');
    for (let i = 0; i < 40 && !useVx.getState().toasts.length; i++) await tick();
    expect(useVx.getState().panel).toBeNull();
    expect(useVx.getState().toasts.at(-1)?.message).toBe("gone.md isn't in this folder any more.");
    await m.unmount();
  });

  test('waits for the signed-in user', async () => {
    const { useVx } = await import('./store');
    useVx.setState({ me: null } as never);
    const m = await mountAt('/drive?ws=ws-work');
    expect(replaced).toEqual([]);
    await act(async () => useVx.setState({ me } as never));
    await tick();
    expect(useVx.getState().workspaceId).toBe('ws-work');
    expect(replaced).toEqual(['/drive']);
    await m.unmount();
  });
});

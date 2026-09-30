// The sidebar's open-proposals count: hidden at 0, the number, "99+" above 99.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';

let React: typeof import('react');
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
let open = 0;
const asked: string[] = [];

beforeAll(async () => {
  GlobalRegistrator.register({ url: 'http://localhost:4100/drive' });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    asked.push(String(input));
    return new Response(JSON.stringify({ open }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  React = await import('react');
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
});

afterEach(() => {
  document.body.innerHTML = '';
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function render(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, unmount: () => act(async () => root.unmount()) };
}

describe('proposals nav count', () => {
  test('labels', async () => {
    const { navCountLabel } = await import('./proposals-nav-count');
    expect(navCountLabel(0)).toBeNull();
    expect(navCountLabel(undefined)).toBeNull();
    expect(navCountLabel(-1)).toBeNull();
    expect(navCountLabel(1)).toBe('1');
    expect(navCountLabel(99)).toBe('99');
    expect(navCountLabel(100)).toBe('99+');
    expect(navCountLabel(4321)).toBe('99+');
  });

  test('the pill is hidden at 0, shows the number, and caps at 99+', async () => {
    const { NavCountPill } = await import('./proposals-nav-count');
    const zero = await render(<NavCountPill n={0} />);
    expect(zero.host.querySelector('[data-nav-count]')).toBeNull();
    await zero.unmount();
    const three = await render(<NavCountPill n={3} />);
    expect(three.host.querySelector('[data-nav-count]')?.textContent).toStartWith('3');
    await three.unmount();
    const many = await render(<NavCountPill n={250} />);
    expect(many.host.querySelector('[data-nav-count]')?.textContent).toStartWith('99+');
    await many.unmount();
  });

  test('reads the open count of the current workspace', async () => {
    const { SWRConfig } = await import('swr');
    const { useVx } = await import('@/lib/store');
    const { ProposalsNavCount } = await import('./proposals-nav-count');
    useVx.setState({ workspaceId: 'ws-a' } as never);
    open = 7;
    const r = await render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ProposalsNavCount />
      </SWRConfig>,
    );
    for (let i = 0; i < 20 && !r.host.querySelector('[data-nav-count]'); i++) await act(async () => void (await new Promise((res) => setTimeout(res, 10))));
    expect(r.host.querySelector('[data-nav-count]')?.textContent).toStartWith('7');
    expect(asked.some((u) => u.endsWith('/api/w/ws-a/proposals/count'))).toBe(true);
    await r.unmount();

    open = 0;
    const r2 = await render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ProposalsNavCount />
      </SWRConfig>,
    );
    await act(async () => void (await new Promise((res) => setTimeout(res, 30))));
    expect(r2.host.querySelector('[data-nav-count]')).toBeNull();
    await r2.unmount();
  });
});

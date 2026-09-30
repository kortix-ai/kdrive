// The text compare view renders a bounded number of rows, however many lines changed:
// a 200 KB file of newlines against an empty version must not put 100,000 rows (400,000
// grid cells) in the page. The rest is behind "Show more", with a notice.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { FileSide } from '@volumes/shared';

let React: typeof import('react');
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
let CompareText: typeof import('./compare-text').CompareText;
let TEXT_COMPARE_MAX_ROWS: number;
const bodies = new Map<string, string>();

beforeAll(async () => {
  GlobalRegistrator.register({ url: 'http://localhost:4100/compare' });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (input: RequestInfo | URL) => new Response(bodies.get(String(input)) ?? '', { status: 200 })) as unknown as typeof fetch;
  React = await import('react');
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
  ({ CompareText } = await import('./compare-text'));
  ({ TEXT_COMPARE_MAX_ROWS } = await import('@/lib/versioning/text-diff'));
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const side = (id: string, text: string): FileSide => {
  bodies.set(`/c/${id}`, text);
  return { commitId: id, createdAt: '2026-01-01T00:00:00.000Z', size: text.length, mtime: 0, mime: 'text/plain', version: id, contentUrl: `/c/${id}`, downloadUrl: `/d/${id}` };
};

const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

async function render(el: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(el));
  for (let i = 0; i < 100 && !host.querySelector('.grid'); i++) await wait(20);
  return { host, done: async () => (await act(async () => root.unmount()), host.remove()) };
}

describe('text compare is bounded', () => {
  test('100,000 added lines render at most the row cap, with a notice and "Show more"', async () => {
    const { host, done } = await render(<CompareText a={side('a1', '')} b={side('b1', 'x\n'.repeat(100_000))} path="/big.txt" mode="split" />);
    const grid = host.querySelector('.grid')!;
    expect(grid).not.toBeNull();
    // 2 pane heads + 4 cells per row (+ block anchors)
    expect(grid.children.length).toBeLessThanOrEqual(TEXT_COMPARE_MAX_ROWS * 4 + 64);
    expect(host.textContent).toContain(`Showing the first ${TEXT_COMPARE_MAX_ROWS.toLocaleString('en-US')} of 100,000 rows`);
    const more = [...host.querySelectorAll('button')].find((b) => /Show .* more/.test(b.textContent ?? ''));
    expect(more).toBeDefined();
    await act(async () => more!.click());
    expect(grid.children.length).toBeGreaterThan(TEXT_COMPARE_MAX_ROWS * 4);
    expect(grid.children.length).toBeLessThanOrEqual(TEXT_COMPARE_MAX_ROWS * 8 + 64);
    await done();
  }, 60_000);

  test('the unified view is bounded the same way', async () => {
    const { host, done } = await render(<CompareText a={side('a2', '')} b={side('b2', 'y\n'.repeat(100_000))} path="/big2.txt" mode="unified" />);
    const grid = host.querySelector('.grid')!;
    expect(grid.children.length).toBeLessThanOrEqual(TEXT_COMPARE_MAX_ROWS * 3 + 64);
    await done();
  }, 60_000);

  test('a small diff shows every row and no notice', async () => {
    const { host, done } = await render(<CompareText a={side('a3', 'one\ntwo\n')} b={side('b3', 'one\nthree\n')} path="/s.txt" mode="split" />);
    expect(host.textContent).not.toContain('Showing the first');
    expect(host.textContent).toContain('three');
    await done();
  });
});

// Proposals inbox and review: rows (counts, agent badge, states, empty state), the compare
// view picked per change, ticked rows sent as `seqs`, a 409 stale_base showing the conflict
// bar whose "Accept anyway" sends `force: true`, and the accept toast carrying Undo.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ProposalDetailResponse, ProposalFile, ProposalSummary } from '@volumes/shared';

const pushed: string[] = [];
let search = new URLSearchParams();
const router = { replace: (u: string) => void pushed.push(u), push: (u: string) => void pushed.push(u), prefetch: () => {}, back: () => {}, refresh: () => {} };
mock.module('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/proposals',
  useSearchParams: () => search,
  useParams: () => ({ id: 'p1' }),
}));

type Call = { method: string; url: string; body: unknown };
type Handler = (c: Call) => { status: number; body: unknown } | undefined;
const calls: Call[] = [];
let handler: Handler = () => undefined;

let React: typeof import('react');
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;

beforeAll(async () => {
  GlobalRegistrator.register({ url: 'http://localhost:4100/proposals', width: 1280, height: 900 });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    const call = { method, url, body };
    calls.push(call);
    const r = handler(call);
    if (url.includes('/content')) return new Response('line one\nline two\n', { status: 200, headers: { 'content-type': 'text/plain' } });
    const out = r ?? { status: 404, body: { error: { code: 'not_found', message: 'Not found.' } } };
    return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  React = await import('react');
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
});

beforeEach(async () => {
  calls.length = 0;
  pushed.length = 0;
  search = new URLSearchParams();
  handler = () => undefined;
  const { useVx } = await import('@/lib/store');
  useVx.setState({ workspaceId: 'ws1', toasts: [], me: null } as never);
});

afterEach(() => {
  document.body.innerHTML = '';
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const tick = (ms = 10) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
async function until(cond: () => boolean, tries = 60) {
  for (let i = 0; i < tries && !cond(); i++) await tick();
}

async function render(node: React.ReactNode) {
  const { SWRConfig } = await import('swr');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{node}</SWRConfig>));
  return { host, unmount: () => act(async () => root.unmount()) };
}

const click = (el: Element | null | undefined) =>
  act(async () => {
    if (!el) throw new Error('element not found');
    (el as HTMLElement).click();
  });
const byText = (root: ParentNode, sel: string, text: string) => [...root.querySelectorAll(sel)].find((e) => e.textContent?.trim().startsWith(text));

const agent = { kind: 'token' as const, name: 'Research agent', credential: 'pat:t1' };
const summary = (over: Partial<ProposalSummary> = {}): ProposalSummary => ({
  id: 'p1',
  workspaceId: 'ws1',
  agent,
  message: 'Tidy the notes',
  status: 'open',
  createdAt: '2026-09-30T10:00:00.000Z',
  decidedAt: null,
  baseCommitId: 'vc_base0000001',
  opCount: 4,
  bytesTotal: 100,
  counts: { added: 2, modified: 1, removed: 1, moved: 0, copied: 0, folders: 0 },
  pending: 4,
  url: 'http://localhost:4100/proposals/p1?ws=ws1',
  ...over,
});

const side = (commitId: string, over: Record<string, unknown> = {}) => ({
  commitId,
  createdAt: '2026-09-30T10:00:00.000Z',
  size: 20,
  mtime: 0,
  mime: 'text/markdown',
  version: commitId === 'proposed' ? null : 'h-now',
  contentUrl: `/api/w/ws1/x/${commitId}/content`,
  downloadUrl: `/api/w/ws1/x/${commitId}/content?download=1`,
  ...over,
});

const file = (seq: number, over: Partial<ProposalFile> = {}): ProposalFile => ({
  seq,
  op: 'write',
  change: 'modified',
  path: `/notes/f${seq}.md`,
  fromPath: null,
  entryType: 'file',
  size: 20,
  baseSize: 18,
  mime: 'text/markdown',
  status: 'pending',
  conflict: null,
  compare: { kind: 'text', a: side('vc_head'), b: side('proposed'), tooLargeForDiff: false },
  ...over,
});

describe('inbox', () => {
  test('a row shows the message, the agent badge, count chips and links to its review', async () => {
    const { ProposalRow } = await import('./proposal-row');
    const { host, unmount } = await render(<ProposalRow proposal={summary()} />);
    const a = host.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('/proposals/p1');
    expect(a.textContent).toContain('Tidy the notes');
    expect(host.querySelector('[data-agent-badge]')?.textContent).toContain('Research agent');
    expect(a.textContent).toContain('+2');
    expect(a.textContent).toContain('M1');
    expect(a.textContent).toContain('−1');
    expect(a.textContent).not.toMatch(/R\d/);
    expect(a.textContent).toContain('4 files');
    expect(a.textContent).not.toContain('Accepted');
    await unmount();
  });

  test('decided rows carry their state; a proposal without a message gets a generated title', async () => {
    const { ProposalRow } = await import('./proposal-row');
    const cases: [ProposalSummary['status'], string][] = [
      ['accepted', 'Accepted'],
      ['partial', 'Partly accepted'],
      ['discarded', 'Discarded'],
      ['expired', 'Expired'],
    ];
    for (const [status, label] of cases) {
      const r = await render(<ProposalRow proposal={summary({ status, pending: 0, decidedAt: '2026-09-30T11:00:00.000Z' })} />);
      expect(r.host.textContent).toContain(label);
      await r.unmount();
    }
    const r = await render(<ProposalRow proposal={summary({ message: '  ', counts: { added: 2, modified: 1, removed: 0, moved: 1, copied: 0, folders: 1 } })} />);
    expect(r.host.textContent).toContain('Add 2 files, edit 1, move 1, create 1 folder');
    expect(r.host.textContent).toContain('R1');
    expect(r.host.textContent).toContain('1 folder');
    await r.unmount();
  });

  test('empty waiting list teaches and links to the agents settings', async () => {
    handler = (c) => (c.url.includes('/proposals/count') ? { status: 200, body: { open: 0 } } : c.url.includes('/proposals') ? { status: 200, body: { proposals: [], nextCursor: null, openCount: 0 } } : undefined);
    const Page = (await import('@/app/(app)/proposals/page')).default;
    const { host, unmount } = await render(<Page />);
    await until(() => !!host.textContent?.includes('Nothing to review'));
    expect(host.textContent).toContain('Nothing to review');
    expect(byText(host, 'a', 'Connect an agent')?.getAttribute('href')).toBe('/settings/agents');
    expect(calls.some((c) => c.url.includes('/api/w/ws1/proposals?status=open'))).toBe(true);
    await unmount();
  });

  test('rows list, and "Load more" asks for the page before the cursor', async () => {
    handler = (c) => {
      if (c.url.includes('/proposals/count')) return { status: 200, body: { open: 2 } };
      if (c.url.includes('before=p1')) return { status: 200, body: { proposals: [summary({ id: 'p0', message: 'Older one' })], nextCursor: null, openCount: 2 } };
      if (c.url.includes('/proposals?')) return { status: 200, body: { proposals: [summary()], nextCursor: 'p1', openCount: 2 } };
      return undefined;
    };
    const Page = (await import('@/app/(app)/proposals/page')).default;
    const { host, unmount } = await render(<Page />);
    await until(() => !!host.querySelector('[data-proposal="p1"]'));
    expect(host.querySelectorAll('[data-proposal]').length).toBe(1);
    await click(byText(host, 'button', 'Load more'));
    await until(() => !!host.querySelector('[data-proposal="p0"]'));
    expect(host.querySelectorAll('[data-proposal]').length).toBe(2);
    expect(host.textContent).toContain('Older one');
    expect(byText(host, 'button', 'Load more')).toBeUndefined();
    await unmount();
  });
});

describe('review pane picks the compare view', () => {
  test('by compare.kind and op', async () => {
    const { reviewView } = await import('./review-pane');
    expect(reviewView(file(0))).toBe('text');
    expect(reviewView(file(0, { compare: { kind: 'image', a: null, b: side('proposed') as never, tooLargeForDiff: false } }))).toBe('image');
    expect(reviewView(file(0, { compare: { kind: 'csv', a: null, b: side('proposed') as never, tooLargeForDiff: false } }))).toBe('csv');
    expect(reviewView(file(0, { compare: { kind: 'binary', a: null, b: side('proposed') as never, tooLargeForDiff: false } }))).toBe('meta');
    expect(reviewView(file(0, { compare: { kind: 'text', a: null, b: side('proposed') as never, tooLargeForDiff: true } }))).toBe('meta');
    expect(reviewView(file(0, { op: 'delete', change: 'removed' }))).toBe('removed');
    expect(reviewView(file(0, { op: 'move', change: 'moved', fromPath: '/a.md', compare: null }))).toBe('move');
    expect(reviewView(file(0, { op: 'mkdir', change: 'folder', entryType: 'dir', compare: null }))).toBe('folder');
  });

  test('renders CompareText, CompareImage, CompareCsv and CompareMeta', async () => {
    const { ReviewPane } = await import('./review-pane');
    const text = await render(<ReviewPane file={file(0)} />);
    expect(text.host.querySelector('[data-view="text"]')).not.toBeNull();
    await until(() => !!text.host.textContent?.includes('line one'));
    expect(text.host.textContent).toContain('line one');
    expect(text.host.textContent).toContain('Proposed');
    await text.unmount();

    const img = await render(<ReviewPane file={file(1, { path: '/p.png', compare: { kind: 'image', a: side('vc_head', { mime: 'image/png' }) as never, b: side('proposed', { mime: 'image/png' }) as never, tooLargeForDiff: false } })} />);
    expect(img.host.querySelector('[data-view="image"] img')).not.toBeNull();
    await img.unmount();

    const csv = await render(<ReviewPane file={file(2, { path: '/t.csv', compare: { kind: 'csv', a: side('vc_head') as never, b: side('proposed') as never, tooLargeForDiff: false } })} />);
    expect(csv.host.querySelector('[data-view="csv"]')).not.toBeNull();
    expect(byText(csv.host, 'button', 'Changes only')).toBeDefined();
    await csv.unmount();

    const bin = await render(<ReviewPane file={file(3, { path: '/b.bin', compare: { kind: 'binary', a: side('vc_head') as never, b: side('proposed') as never, tooLargeForDiff: false } })} />);
    expect(bin.host.querySelector('[data-view="meta"]')?.textContent).toContain('Hash');
    await bin.unmount();

    const del = await render(<ReviewPane file={file(4, { op: 'delete', change: 'removed', compare: { kind: 'text', a: side('vc_head') as never, b: null, tooLargeForDiff: false } })} />);
    expect(del.host.textContent).toContain('Not present at this version');
    await del.unmount();

    const mv = await render(<ReviewPane file={file(5, { op: 'move', change: 'moved', fromPath: '/old/a.md', path: '/new/a.md', compare: null })} />);
    expect(mv.host.textContent).toContain('/old/a.md');
    expect(mv.host.querySelector('a[href="/drive/old?file=a.md"]')).not.toBeNull();
    await mv.unmount();

    const dir = await render(<ReviewPane file={file(6, { op: 'mkdir', change: 'folder', entryType: 'dir', path: '/drafts', compare: null })} />);
    expect(dir.host.textContent).toContain('Creates the folder /drafts');
    await dir.unmount();
  });
});

describe('review', () => {
  const detail = (over: Partial<ProposalDetailResponse> = {}): ProposalDetailResponse => ({
    proposal: summary({ opCount: 3, pending: 3 }),
    files: [file(0), file(1, { change: 'added', baseSize: null }), file(2)],
    headCommitId: 'vc_head',
    conflicts: 0,
    ...over,
  });
  const action = { id: 'act_9', kind: 'proposal.accept', summary: 'Accepted from Research agent', status: 'committed', headCommitId: 'vc_new', baseCommitId: 'vc_head', createdAt: '2026-09-30T10:05:00.000Z', itemCount: 2, bytesDelta: 4, undoable: true, agent, proposalId: 'p1' };

  async function mount() {
    const { ProposalReview } = await import('./proposal-review');
    const r = await render(<ProposalReview id="p1" />);
    await until(() => !!r.host.querySelector('[data-seq]'));
    return r;
  }
  const accepts = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/api/w/ws1/proposals/p1/accept'));

  test('ticked rows are sent as seqs and the toast carries Undo', async () => {
    handler = (c) => {
      if (c.method === 'POST' && c.url.endsWith('/accept')) return { status: 200, body: { proposal: summary({ pending: 1 }), action } };
      if (c.url.endsWith('/api/w/ws1/proposals/p1')) return { status: 200, body: detail() };
      return undefined;
    };
    const { host, unmount } = await mount();
    expect(host.querySelector('h1')?.textContent).toBe('Tidy the notes');
    expect(byText(host, 'button', 'Accept all')).toBeDefined();
    await click(host.querySelector('input[aria-label="Select /notes/f0.md"]'));
    await click(host.querySelector('input[aria-label="Select /notes/f2.md"]'));
    const btn = byText(host, 'button', 'Accept 2 selected');
    expect(btn).toBeDefined();
    expect(byText(host, 'button', 'Discard 2 selected')).toBeDefined();
    await click(btn);
    await until(() => accepts().length > 0);
    expect(accepts()[0].body).toEqual({ seqs: [0, 2], force: false });
    const { useVx } = await import('@/lib/store');
    await until(() => useVx.getState().toasts.length > 0);
    const t = useVx.getState().toasts.at(-1)!;
    expect(t.message).toBe('Accepted 2 changes from Research agent');
    expect(t.undoActionId).toBe('act_9');
    expect(t.undoWorkspaceId).toBe('ws1');
    await unmount();
  });

  test('"Accept this file" accepts one seq; discarding sends the selection', async () => {
    handler = (c) => {
      if (c.method === 'POST' && c.url.endsWith('/accept')) return { status: 200, body: { proposal: summary(), action } };
      if (c.method === 'POST' && c.url.endsWith('/discard')) return { status: 200, body: { proposal: summary() } };
      if (c.url.endsWith('/api/w/ws1/proposals/p1')) return { status: 200, body: detail() };
      return undefined;
    };
    const { host, unmount } = await mount();
    await click(host.querySelector('[data-seq="1"]'));
    await click(byText(host, 'button', 'Accept this file'));
    await until(() => accepts().length > 0);
    expect(accepts()[0].body).toEqual({ seqs: [1], force: false });
    await tick(20);
    await click(byText(host, 'button', 'Discard all'));
    await until(() => calls.some((c) => c.url.endsWith('/discard')));
    expect(calls.find((c) => c.url.endsWith('/discard'))?.body).toEqual({});
    const { useVx } = await import('@/lib/store');
    await until(() => useVx.getState().toasts.some((x) => x.message.startsWith('Discarded')));
    expect(useVx.getState().toasts.some((x) => x.message === 'Discarded 3 changes')).toBe(true);
    await unmount();
  });

  test('a 409 stale_base shows the conflict bar; "Accept anyway" confirms, then sends force', async () => {
    let refused = false;
    handler = (c) => {
      if (c.method === 'POST' && c.url.endsWith('/accept')) {
        if (!(c.body as { force?: boolean }).force) {
          refused = true;
          return { status: 409, body: { error: { code: 'stale_base', message: '1 of the files you are changing was changed.', details: { current_commit_id: 'vc_newer', conflicts: [{ path: '/notes/f2.md', reason: 'changed', current: null }] } } } };
        }
        return { status: 200, body: { proposal: summary({ status: 'accepted', pending: 0 }), action } };
      }
      if (c.url.endsWith('/api/w/ws1/proposals/p1')) {
        const d = detail();
        if (refused) {
          d.files = d.files.map((f) => (f.seq === 2 ? { ...f, conflict: { reason: 'changed', currentSize: 30 } } : f));
          d.conflicts = 1;
        }
        return { status: 200, body: d };
      }
      return undefined;
    };
    const { host, unmount } = await mount();
    expect(host.querySelector('[data-conflict-bar]')).toBeNull();
    await click(byText(host, 'button', 'Accept all'));
    await until(() => !!host.querySelector('[data-conflict-bar]'));
    const bar = host.querySelector('[data-conflict-bar]')!;
    expect(bar.textContent).toContain('1 file changed since the agent read it.');
    await until(() => !!host.querySelector('[data-drift]'));
    // "Show them" narrows the list to the conflicting row.
    await click(byText(bar, 'button', 'Show them'));
    expect(host.querySelectorAll('[data-seq]').length).toBe(1);
    expect(host.querySelector('[data-seq="2"]')).not.toBeNull();
    await click(byText(bar, 'button', 'Accept anyway'));
    expect(accepts().length).toBe(1);
    await click(byText(host, 'button', 'Replace newer changes'));
    await until(() => accepts().length === 2);
    expect(accepts()[1].body).toEqual({ force: true });
    await unmount();
  });

  test('a change that builds on another takes it along; a link to one change opens it', async () => {
    search = new URLSearchParams('ws=ws1&seq=1');
    handler = (c) => {
      if (c.method === 'POST' && c.url.endsWith('/accept')) return { status: 200, body: { proposal: summary(), action } };
      if (c.url.endsWith('/api/w/ws1/proposals/p1'))
        return {
          status: 200,
          body: detail({
            files: [
              file(0, { change: 'added', baseSize: null, path: '/Projects/brief.md', inDrive: { path: false, from: null, folder: false } }),
              file(1, { op: 'move', change: 'moved', fromPath: '/Projects/brief.md', path: '/Archive/brief.md', compare: null, requires: [0], inDrive: { path: false, from: false, folder: false } }),
              file(2),
            ],
          }),
        };
      return undefined;
    };
    const { host, unmount } = await mount();
    await until(() => !!host.querySelector('[data-view="move"]'));
    expect(host.querySelector('[data-seq="1"]')?.getAttribute('aria-current')).toBe('true');
    // Neither the source (made by change 0) nor the destination folder is in the drive yet.
    expect(host.querySelector('[data-view="move"] a')).toBeNull();
    expect(host.textContent).toContain('Also accepts: added /Projects/brief.md');
    await click(byText(host, 'button', 'Accept this file'));
    await until(() => accepts().length > 0);
    expect(accepts()[0].body).toEqual({ seqs: [0, 1], force: false });
    await tick(20);
    await click(host.querySelector('input[aria-label="Select /Projects/brief.md → /Archive/brief.md"]'));
    expect((host.querySelector('input[aria-label="Select /Projects/brief.md"]') as HTMLInputElement).checked).toBe(true);
    await click(host.querySelector('input[aria-label="Select /Projects/brief.md"]'));
    expect((host.querySelector('input[aria-label="Select /Projects/brief.md → /Archive/brief.md"]') as HTMLInputElement).checked).toBe(false);
    await unmount();
  });

  test('a refusal the conflict bar already shows nudges it and moves focus there', async () => {
    handler = (c) => {
      if (c.method === 'POST' && c.url.endsWith('/accept'))
        return { status: 409, body: { error: { code: 'stale_base', message: '1 file changed.', details: { current_commit_id: 'vc_x', conflicts: [{ path: '/notes/f2.md', reason: 'changed', current: null }] } } } };
      if (c.url.endsWith('/api/w/ws1/proposals/p1')) return { status: 200, body: detail({ conflicts: 1, files: [file(0), file(1), file(2, { conflict: { reason: 'changed', currentSize: 3 } })] }) };
      return undefined;
    };
    const { host, unmount } = await mount();
    await until(() => !!host.querySelector('[data-conflict-bar]'));
    const bar = host.querySelector('[data-conflict-bar]') as HTMLElement;
    expect(bar.hasAttribute('data-nudge')).toBe(false);
    await click(byText(host, 'button', 'Accept all'));
    await until(() => accepts().length > 0 && bar.hasAttribute('data-nudge'));
    expect(bar.hasAttribute('data-nudge')).toBe(true);
    expect(document.activeElement).toBe(bar);
    await unmount();
  });

  test('decided rows link to the drive only when accepted and there', async () => {
    handler = (c) =>
      c.url.endsWith('/api/w/ws1/proposals/p1')
        ? {
            status: 200,
            body: detail({
              proposal: summary({ status: 'partial', pending: 0 }),
              files: [file(0, { status: 'accepted', compare: null, inDrive: { path: true, from: null, folder: true } }), file(1, { status: 'discarded', compare: null, inDrive: { path: false, from: null, folder: true } })],
            }),
          }
        : undefined;
    const { host, unmount } = await mount();
    await until(() => !!byText(host, 'a', 'Open in drive'));
    expect(byText(host, 'a', 'Open in drive')?.getAttribute('href')).toBe('/drive/notes?file=f0.md');
    await click(host.querySelector('[data-seq="1"]'));
    expect(host.textContent).toContain('This change was discarded.');
    expect(byText(host, 'a', 'Open in drive')).toBeUndefined();
    await unmount();
  });

  test('a proposal that no longer exists offers the way back', async () => {
    handler = () => undefined;
    const { ProposalReview } = await import('./proposal-review');
    const { host, unmount } = await render(<ProposalReview id="gone" />);
    await until(() => !!host.textContent?.includes('This proposal no longer exists'));
    expect(byText(host, 'a', 'Back to proposals')?.getAttribute('href')).toBe('/proposals');
    await unmount();
  });

  test('a decided proposal shows its state and no actions', async () => {
    handler = (c) =>
      c.url.endsWith('/api/w/ws1/proposals/p1')
        ? { status: 200, body: detail({ proposal: summary({ status: 'partial', pending: 0 }), files: [file(0, { status: 'accepted' }), file(1, { status: 'discarded' })] }) }
        : undefined;
    const { host, unmount } = await mount();
    expect(host.textContent).toContain('Partly accepted');
    expect(byText(host, 'button', 'Accept all')).toBeUndefined();
    expect(byText(host, 'button', 'Accept this file')).toBeUndefined();
    expect(host.querySelector('input[type=checkbox]')).toBeNull();
    await unmount();
  });
});

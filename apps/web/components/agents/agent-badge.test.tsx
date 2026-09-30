// The "Agent" badge, and where it shows: a timeline entry and a versions row carry it only
// when an AI agent made the change.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import type { AgentRef, FileVersion, TimelineEntry } from '@volumes/shared';

const router = { replace: () => {}, push: () => {}, prefetch: () => {}, back: () => {}, refresh: () => {} };
mock.module('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/drive',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

let React: typeof import('react');
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
let versions: FileVersion[] = [];

beforeAll(async () => {
  GlobalRegistrator.register({ url: 'http://localhost:4100/drive' });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/versions') ? { path: '/notes.md', versions, source: 'ledger' } : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
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

const agent: AgentRef = { kind: 'token', name: 'Research agent', credential: 'pat:tok_1' };

async function render(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, unmount: () => act(async () => root.unmount()) };
}

const entry = (over: Partial<TimelineEntry> = {}): TimelineEntry => ({
  id: 'e1',
  commitId: 'vc_1a2b3c4d5e6f',
  createdAt: '2026-09-30T10:00:00.000Z',
  kind: 'agent.batch',
  summary: 'Wrote notes.md',
  itemCount: 1,
  bytesDelta: 120,
  paths: [{ path: '/notes.md', fromPath: null, op: 'write' }],
  checkpoints: [],
  isHead: false,
  undoable: false,
  actionId: 'act_1',
  actor: null,
  mergedCount: 0,
  restoredTo: null,
  ...over,
}) as unknown as TimelineEntry;

describe('AgentBadge', () => {
  test('shows the name with the Bot icon and a tooltip naming the credential kind', async () => {
    const { AgentBadge } = await import('./agent-badge');
    const { host, unmount } = await render(<AgentBadge agent={agent} />);
    const el = host.querySelector('[data-agent-badge]')!;
    expect(el.textContent).toContain('Research agent');
    expect(el.getAttribute('title')).toBe('Changed by the AI agent Research agent (token)');
    expect(el.querySelector('svg')).not.toBeNull();
    await unmount();

    const r2 = await render(<AgentBadge agent={{ kind: 'oauth', name: 'Desk app', credential: 'oauth:c1' }} />);
    expect(r2.host.querySelector('[data-agent-badge]')!.getAttribute('title')).toBe('Changed by the AI agent Desk app (app)');
    await r2.unmount();
  });

  test('long names are cut at 24 characters with an ellipsis; the tooltip keeps the full name', async () => {
    const { AgentBadge, agentDisplayName } = await import('./agent-badge');
    const long = 'An agent with a really very long name indeed';
    expect(agentDisplayName(long).length).toBeLessThanOrEqual(24);
    expect(agentDisplayName(long).endsWith('…')).toBe(true);
    expect(agentDisplayName('  ')).toBe('AI agent');
    const { host, unmount } = await render(<AgentBadge agent={{ ...agent, name: long }} />);
    const el = host.querySelector('[data-agent-badge]')!;
    expect(el.textContent).not.toContain(long);
    expect(el.getAttribute('title')).toContain(long);
    await unmount();
  });
});

describe('badge placements', () => {
  test('a timeline entry shows the badge only when an agent made the change', async () => {
    const { TimelineEntryRow } = await import('@/components/versioning/timeline-entry');
    const noop = () => {};
    const a = await render(<TimelineEntryRow entry={entry({ agent })} selected={false} viewerEmail={null} onOpen={noop} onMenu={noop} />);
    expect(a.host.querySelector('[data-agent-badge]')?.textContent).toContain('Research agent');
    await a.unmount();
    const b = await render(<TimelineEntryRow entry={entry({ agent: null })} selected={false} viewerEmail={null} onOpen={noop} onMenu={noop} />);
    expect(b.host.querySelector('[data-agent-badge]')).toBeNull();
    await b.unmount();
  });

  test('versions rows show the badge only on versions an agent wrote', async () => {
    const { useVx } = await import('@/lib/store');
    const VersionsPanel = (await import('@/components/versioning/versions-panel')).default;
    const base = { path: '/notes.md', size: 10, version: 'h1', isCurrent: false, checkpointNames: [], summary: 'Edited', op: 'changed', actionId: null };
    versions = [
      { ...base, commitId: 'vc_agent000001', createdAt: '2026-09-30T10:00:00.000Z', isCurrent: true, agent },
      { ...base, commitId: 'vc_person00002', createdAt: '2026-09-29T10:00:00.000Z', agent: null },
    ] as unknown as FileVersion[];
    useVx.setState({ workspaceId: 'ws1', panel: { kind: 'versions', path: '/notes.md', at: null } } as never);
    const { host, unmount } = await render(<VersionsPanel />);
    for (let i = 0; i < 20 && !host.textContent?.includes('Current'); i++) await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
    const badges = host.querySelectorAll('[data-agent-badge]');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toContain('Research agent');
    await unmount();
    useVx.setState({ panel: null } as never);
  });
});

describe('history rail filter', () => {
  test('"Agents" keeps only entries an agent made', async () => {
    const { RAIL_FILTERS, matchesRailFilter } = await import('@/components/versioning/timeline-rail');
    expect(RAIL_FILTERS.map((f) => f.label)).toContain('Agents');
    expect(matchesRailFilter(entry({ agent }), 'agents')).toBe(true);
    expect(matchesRailFilter(entry({ agent: null }), 'agents')).toBe(false);
    expect(matchesRailFilter(entry({ agent: null }), 'all')).toBe(true);
  });
});

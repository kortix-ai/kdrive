// AI agents UI: the token dialog shows the secret once and forgets it on close; setup snippets
// carry the MCP URL; "Apply directly" exists only with "Make changes"; the consent card never
// offers more access than the app requested.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type { OAuthConsentInfo } from '@volumes/shared';

let React: typeof import('react');
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
let SWRConfig: typeof import('swr').SWRConfig;
let mod: {
  access: typeof import('./access-options');
  connect: typeof import('./connect-section');
  dialog: typeof import('./token-dialog');
  consent: typeof import('./consent-card');
  list: typeof import('./token-list');
};

const MCP_URL = 'https://drive.example.test/mcp';
const SECRET = 'vx_pat_' + 'S'.repeat(43);
const calls: { url: string; method: string; body: unknown }[] = [];
let consentInfo: OAuthConsentInfo;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input);
  const method = (init.method ?? 'GET').toUpperCase();
  calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : null });
  if (url === '/api/config') return json({ providers: [], devLogin: true, storageMode: 'emulated', mcp: { enabled: true, url: MCP_URL } });
  if (url === '/api/agents/tokens' && method === 'POST') {
    const now = new Date().toISOString();
    return json(
      {
        token: { id: 't1', name: 'Research agent', prefix: SECRET.slice(0, 12), scope: 'drive:propose', mode: 'review', workspaceId: null, workspaceName: null, expiresAt: now, lastUsedAt: null, revokedAt: null, createdAt: now, expired: false },
        secret: SECRET,
      },
      201,
    );
  }
  if (url === '/api/agents/tokens') return json({ tokens: [] });
  if (url.startsWith('/api/agents/oauth/consent-info')) return json(consentInfo);
  return json({ error: { code: 'not_found', message: 'No such route.' } }, 404);
}

beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = fakeFetch as unknown as typeof fetch;
  React = await import('react');
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
  ({ SWRConfig } = await import('swr'));
  mod = {
    access: await import('./access-options'),
    connect: await import('./connect-section'),
    dialog: await import('./token-dialog'),
    consent: await import('./consent-card'),
    list: await import('./token-list'),
  };
});

const unmounts: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const u of unmounts.splice(0)) await u();
  document.body.innerHTML = '';
  calls.length = 0;
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const tick = (ms = 10) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

async function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (n: React.ReactNode) => act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{n}</SWRConfig>));
  await render(node);
  unmounts.push(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  return { render };
}

const byText = (text: string, sel = 'button') => [...document.querySelectorAll<HTMLElement>(sel)].find((b) => b.textContent?.trim().includes(text)) ?? null;
const radio = (title: string) => [...document.querySelectorAll<HTMLButtonElement>('[role=radio]')].find((r) => r.textContent?.includes(title)) ?? null;
const click = (el: HTMLElement | null) => act(async () => void el!.click());

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('snippets', () => {
  test('the config and command line snippets carry the MCP URL (and the token when given)', () => {
    const { mcpConfigSnippet, cliSnippet, TOKEN_PLACEHOLDER } = mod.connect;
    expect(JSON.parse(mcpConfigSnippet(MCP_URL))).toEqual({ mcpServers: { volumes: { type: 'http', url: MCP_URL } } });
    expect(JSON.parse(mcpConfigSnippet(MCP_URL, TOKEN_PLACEHOLDER)).mcpServers.volumes.headers).toEqual({ Authorization: 'Bearer <your token>' });
    expect(cliSnippet(MCP_URL)).toBe(`your-agent mcp add --transport http volumes ${MCP_URL}`);
  });

  test('the Connect section shows the URL and both snippet sets', async () => {
    await mount(<mod.connect.ConnectSection />);
    await tick();
    const url = document.querySelector<HTMLInputElement>('input[readonly]');
    expect(url?.value).toBe(MCP_URL);
    expect(document.querySelector('pre[aria-label="MCP client configuration"]')?.textContent).toContain(MCP_URL);
    expect(document.body.textContent).toContain(`your-agent mcp add --transport http volumes ${MCP_URL}`);
    await click(radio('Agent token'));
    expect(document.querySelector('pre')?.textContent).toContain('Bearer <your token>');
    expect(document.querySelector('pre')?.textContent).toContain(MCP_URL);
  });
});

describe('access options', () => {
  test('"Apply directly" is offered only with "Make changes"', async () => {
    let value: import('./access-options').AccessValue = { scope: 'drive:propose', mode: 'review' };
    function Host() {
      const [v, setV] = React.useState(value);
      value = v;
      return <mod.access.AccessOptions value={v} onChange={setV} />;
    }
    await mount(<Host />);
    expect(radio('Apply directly')).toBeNull();
    expect(document.body.textContent).toContain(mod.access.PROPOSE_MODE_LINE);
    await click(radio('Make changes'));
    expect(value).toEqual({ scope: 'drive:write', mode: 'review' });
    expect(radio('Apply directly')?.disabled).toBe(false);
    await click(radio('Apply directly'));
    expect(value).toEqual({ scope: 'drive:write', mode: 'direct' });
    await click(radio('Read only'));
    expect(value).toEqual({ scope: 'drive:read', mode: 'review' });
    expect(radio('Apply directly')).toBeNull();
  });
});

describe('token dialog', () => {
  test('shows the secret once, then forgets it on close', async () => {
    let setOpen: (v: boolean) => void = () => {};
    function Host() {
      const [open, set] = React.useState(true);
      setOpen = set;
      return <mod.dialog.TokenDialog open={open} onClose={() => set(false)} />;
    }
    await mount(<Host />);
    await tick();
    expect(byText('Create token')?.hasAttribute('disabled')).toBe(true);
    const name = document.querySelector<HTMLInputElement>('input[placeholder="Research agent"]')!;
    await act(async () => typeInto(name, 'Research agent'));
    await click(byText('Create token'));
    await tick();
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({ name: 'Research agent', scope: 'drive:propose', mode: 'review', workspaceId: null, expiresInDays: 365 });
    expect(document.body.textContent).toContain('Copy your token');
    expect(document.body.textContent).toContain("You won't see it again.");
    expect(document.querySelector<HTMLInputElement>('input[data-secret]')?.value).toBe(SECRET);
    expect(document.querySelector('pre')?.textContent).toContain(`Bearer ${SECRET}`);

    await click(byText('Done'));
    await tick();
    expect(document.body.innerHTML).not.toContain(SECRET);
    await act(async () => setOpen(true));
    await tick();
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(document.body.textContent).toContain('New agent token');
    expect(document.querySelector<HTMLInputElement>('input[placeholder="Research agent"]')?.value).toBe('');
  });

  test('name rules', () => {
    expect(mod.dialog.tokenNameError('ok')).toBeNull();
    expect(mod.dialog.tokenNameError('x'.repeat(61))).toContain('60');
  });
});

describe('consent card', () => {
  const base: OAuthConsentInfo = {
    client: { clientId: 'c1', name: 'Helper app', uri: null, redirectHost: '127.0.0.1:8765' },
    requested: { scope: 'drive:propose', identity: ['offline_access'] },
    workspaces: [
      { id: 'w1', name: 'My Drive', isDefault: true },
      { id: 'w2', name: 'Side', isDefault: false },
    ],
    existing: null,
  };

  test('limits access to the requested level and preselects the default workspace', async () => {
    consentInfo = base;
    await mount(<mod.consent.ConsentCard oauthQuery="client_id=c1&sig=s" />);
    await tick();
    expect(document.body.textContent).toContain('Connect Helper app to Volumes');
    expect(document.body.textContent).toContain('127.0.0.1:8765');
    const write = radio('Make changes')!;
    expect(write.disabled).toBe(true);
    expect(write.textContent).toContain('Not requested by this app');
    expect(radio('Suggest changes')?.getAttribute('aria-checked')).toBe('true');
    expect(radio('Read only')?.disabled).toBe(false);
    expect(document.querySelector('[aria-label="Workspace: My Drive"]')).not.toBeNull();
  });

  test('an existing grant preselects its choices, clamped to the request', () => {
    const init = mod.consent.initialChoice({
      ...base,
      existing: { id: 'g', clientId: 'c1', name: 'Helper app', redirectHost: null, scope: 'drive:write', mode: 'direct', workspaceId: 'w2', workspaceName: 'Side', createdAt: '', lastUsedAt: null },
    });
    expect(init).toEqual({ access: { scope: 'drive:propose', mode: 'review' }, workspaceId: 'w2' });
    expect(mod.consent.initialChoice(base)).toEqual({ access: { scope: 'drive:propose', mode: 'review' }, workspaceId: 'w1' });
  });

  test('signed query check', () => {
    const { signedQueryUsable } = mod.consent;
    expect(signedQueryUsable(new URLSearchParams('client_id=a'))).toBe(false);
    expect(signedQueryUsable(new URLSearchParams('sig=x&exp=1'))).toBe(false);
    expect(signedQueryUsable(new URLSearchParams(`sig=x&exp=${Math.floor(Date.now() / 1000) + 600}`))).toBe(true);
  });
});

describe('labels', () => {
  test('used label', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    expect(mod.list.usedLabel(null, now)).toBe('never used');
    expect(mod.list.usedLabel('2026-09-30T11:55:00Z', now)).toBe('used 5 min ago');
  });
});

// Emailed account links: opening one only shows a confirm screen (a link scanner fetching the
// page changes nothing); the API is called when the button is pressed, and the last email-change
// step asks a signed-out visitor to sign in and come back.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';

const replaced: string[] = [];
const router = { replace: (u: string) => void replaced.push(u), push: () => {}, prefetch: () => {}, back: () => {}, refresh: () => {} };
mock.module('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/verify-email',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

let React: typeof import('react');
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
const calls: string[] = [];
const roots: { unmount(): void }[] = [];
const realFetch = globalThis.fetch;
let signedIn = true;
let verifyAnswer: { status: number; body: unknown } = { status: 200, body: { status: true } };

beforeAll(async () => {
  GlobalRegistrator.register({ url: 'http://localhost:4100/verify-email' });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes('/api/auth/get-session')) return reply(200, signedIn ? { session: { id: 's' }, user: { id: 'u' } } : null);
    if (url.includes('/api/auth/verify-email')) return reply(verifyAnswer.status, verifyAnswer.body);
    return reply(401, { error: { code: 'unauthorized', message: 'x' } });
  }) as unknown as typeof fetch;
  React = await import('react');
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = '';
  calls.length = 0;
  replaced.length = 0;
  signedIn = true;
  verifyAnswer = { status: 200, body: { status: true } };
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await GlobalRegistrator.unregister();
});

async function render(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  await act(async () => new Promise((r) => setTimeout(r, 20)));
  return host;
}
const button = (host: HTMLElement, text: RegExp) => [...host.querySelectorAll('button')].find((b) => text.test(b.textContent ?? ''))!;

describe('linkStep and stepResultQuery', () => {
  test('only a known step with a token is a pending link', async () => {
    const { linkStep, stepResultQuery } = await import('./verify-state');
    const q = (s: string) => linkStep(new URLSearchParams(s));
    expect(q('step=verify&token=t')).toEqual({ step: 'verify', token: 't' });
    expect(q('step=approve')).toBeNull();
    expect(q('step=delete&token=t')).toBeNull();
    expect(stepResultQuery('approve', null)).toBe('?change=approved');
    expect(stepResultQuery('confirm', null)).toBe('?change=done');
    expect(stepResultQuery('verify', null)).toBe('');
    expect(stepResultQuery('verify', 'TOKEN_EXPIRED')).toBe('?error=TOKEN_EXPIRED');
  });
});

describe('ConfirmLink', () => {
  test('opening the link calls nothing; pressing the button verifies and shows the outcome', async () => {
    const { ConfirmLink } = await import('./confirm-link');
    const host = await render(<ConfirmLink step="verify" token="tok.en" />);
    expect(host.textContent).toContain('Confirm your email');
    expect(calls.some((u) => u.includes('/verify-email'))).toBe(false);
    await act(async () => button(host, /Confirm email/).click());
    expect(calls.find((u) => u.includes('/api/auth/verify-email'))).toContain('token=tok.en');
    expect(replaced.at(-1)).toBe('/verify-email');
  });

  test('a refused token lands on its error state', async () => {
    verifyAnswer = { status: 401, body: { code: 'TOKEN_EXPIRED', message: 'expired' } };
    const { ConfirmLink } = await import('./confirm-link');
    const host = await render(<ConfirmLink step="approve" token="t" />);
    await act(async () => button(host, /Approve change/).click());
    expect(replaced.at(-1)).toBe('/verify-email?error=TOKEN_EXPIRED');
  });

  test('the last email-change step sends a signed-out visitor to sign in and back', async () => {
    signedIn = false;
    const { ConfirmLink } = await import('./confirm-link');
    const host = await render(<ConfirmLink step="confirm" token="t1" />);
    const a = host.querySelector('a')!;
    expect(a.textContent).toBe('Sign in to confirm');
    const next = new URL(a.getAttribute('href')!, 'http://localhost:4100').searchParams.get('next');
    expect(next).toBe('/verify-email?step=confirm&token=t1');
    const { safeNext } = await import('./auth-bits');
    expect(safeNext(next)).toBe(next!);
  });
});

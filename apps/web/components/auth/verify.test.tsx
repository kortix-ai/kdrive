// Email verification UI: the landing page's states, the resend cooldown, the in-app banner
// (resend hits better-auth, then counts down), and the strength meter.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';

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
const calls: { url: string; body: string }[] = [];

beforeAll(async () => {
  GlobalRegistrator.register({ url: 'http://localhost:4100/drive' });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input instanceof Request ? input.url : input), body: String(init?.body ?? '') });
    return new Response(JSON.stringify({ status: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  React = await import('react');
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(() => {
  document.body.innerHTML = '';
  window.sessionStorage.clear();
  calls.length = 0;
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function render(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => createRoot(host).render(node));
  return host;
}
const button = (host: HTMLElement, text: RegExp) => [...host.querySelectorAll('button')].find((b) => text.test(b.textContent ?? ''))!;

describe('verifyState', () => {
  test('maps better-auth redirects to the page states', async () => {
    const { verifyState } = await import('./verify-state');
    const q = (s: string) => new URLSearchParams(s);
    expect(verifyState(q(''))).toBe('verified');
    expect(verifyState(q('error=TOKEN_EXPIRED'))).toBe('expired');
    expect(verifyState(q('error=token_expired'))).toBe('expired');
    expect(verifyState(q('error=INVALID_TOKEN'))).toBe('invalid');
    expect(verifyState(q('error=USER_NOT_FOUND'))).toBe('invalid');
    expect(verifyState(q('change=approved'))).toBe('change-approved');
    expect(verifyState(q('change=done'))).toBe('change-done');
  });
});

describe('resend cooldown', () => {
  test('cooldownLeft counts down from the last send', async () => {
    const { cooldownLeft } = await import('./verify-email');
    expect(cooldownLeft(null, 1000)).toBe(0);
    expect(cooldownLeft(1000, 1000)).toBe(60);
    expect(cooldownLeft(1000, 31_000)).toBe(30);
    expect(cooldownLeft(1000, 61_001)).toBe(0);
  });

  test('the banner resends through better-auth, then shows the countdown', async () => {
    const { VerifyBanner } = await import('./verify-email');
    const host = await render(<VerifyBanner email="ada@test.local" />);
    expect(host.textContent).toContain('ada@test.local');
    await act(async () => button(host, /Resend email/).click());
    const sent = calls.find((c) => c.url.includes('/api/auth/send-verification-email'));
    expect(sent).toBeDefined();
    expect(JSON.parse(sent!.body)).toMatchObject({ email: 'ada@test.local', callbackURL: '/verify-email' });
    expect(button(host, /Resend in \d+s/).disabled).toBe(true);
  });

  test('the banner can be hidden for this tab', async () => {
    const { VerifyBanner } = await import('./verify-email');
    const host = await render(<VerifyBanner email="ada@test.local" />);
    await act(async () => (host.querySelector('[aria-label="Hide for now"]') as HTMLButtonElement).click());
    expect(host.textContent).toBe('');
    expect(window.sessionStorage.getItem('vx.verify-banner')).toBe('hidden');
  });
});

describe('StrengthMeter', () => {
  test('says nothing for an empty field, then labels the password', async () => {
    const { StrengthMeter } = await import('./auth-bits');
    expect((await render(<StrengthMeter password="" />)).textContent).toBe('');
    expect((await render(<StrengthMeter password="abc" />)).textContent).toContain('Too short');
    expect((await render(<StrengthMeter password="correct horse battery staple" />)).textContent).toContain('Strong');
  });
});

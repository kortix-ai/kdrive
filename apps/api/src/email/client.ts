// Transactional email, the same shape as Platinum's: best-effort, no template
// dependencies, and an ordered fallback chain of providers. Resend goes first,
// Mailtrap second; only providers with a key take part, and any failure
// (non-2xx, timeout, network error) falls through to the next, so one vendor
// is never a single point of failure. Every request has a 10 s timeout.
//
// With no provider configured, a local run (development / test) prints the
// message's links to the API log so the account flows still work end to end.
// Anywhere else it is a logged no-op that never prints a link: a reset or
// verify link in a production log is a credential in a log.
//
// sendEmail() never throws. Callers treat "not sent" as a normal outcome.
import { env } from '../env';

const RESEND_SEND_URL = 'https://api.resend.com/emails';
const MAILTRAP_SEND_URL = 'https://send.api.mailtrap.io/api/send';
const TIMEOUT_MS = 10_000;

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Provider-side tag (Mailtrap category), e.g. "email-verify". */
  category: string;
  /** Links in the message, printed on a local run without a provider. */
  links?: string[];
}

export interface SendResult {
  sent: boolean;
  skipped?: boolean;
  status?: number;
  error?: string;
  provider?: 'resend' | 'mailtrap' | 'console' | 'test';
}

type From = { email: string; name: string };
type Provider = { name: 'resend' | 'mailtrap'; send: (m: EmailMessage, from: From) => Promise<Response> };

function providers(): Provider[] {
  const chain: Provider[] = [];
  const resendKey = env.RESEND_API_KEY;
  if (resendKey) {
    chain.push({
      name: 'resend',
      send: (m, from) =>
        fetch(RESEND_SEND_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: `${from.name} <${from.email}>`, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
    });
  }
  const mailtrapToken = env.MAILTRAP_API_TOKEN;
  if (mailtrapToken) {
    chain.push({
      name: 'mailtrap',
      send: (m, from) =>
        fetch(MAILTRAP_SEND_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${mailtrapToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [{ email: m.to }], subject: m.subject, html: m.html, text: m.text, category: m.category }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
    });
  }
  return chain;
}

/** A provider is configured (GET /api/config tells the web app whether delivery is real). */
export function emailEnabled(): boolean {
  return !!(env.RESEND_API_KEY || env.MAILTRAP_API_TOKEN);
}

/** Tests: every message goes here instead of a provider or the log. */
let testSink: ((m: EmailMessage) => void) | null = null;
export function setEmailSinkForTests(sink: ((m: EmailMessage) => void) | null): void {
  testSink = sink;
}

/** Send one message through the chain. Never throws; on total failure describes the last provider tried. */
export async function sendEmail(m: EmailMessage): Promise<SendResult> {
  if (testSink) {
    testSink(m);
    return { sent: true, provider: 'test' };
  }
  const chain = providers();
  if (chain.length === 0) {
    if (env.isLocalMode) {
      console.info(`[email] (no provider, local run) "${m.subject}" to ${m.to}${(m.links ?? []).map((l) => `\n  ${l}`).join('')}`);
      return { sent: false, skipped: true, provider: 'console' };
    }
    console.warn(`[email] no provider configured (RESEND_API_KEY / MAILTRAP_API_TOKEN), skipping "${m.subject}"`);
    return { sent: false, skipped: true };
  }
  let last: SendResult = { sent: false, error: 'send_failed' };
  for (const p of chain) {
    try {
      const res = await p.send(m, env.emailFrom);
      if (res.ok) return { sent: true, status: res.status, provider: p.name };
      const body = (await res.text().catch(() => '')).slice(0, 300);
      console.warn(`[email] ${p.name} ${res.status}: ${body}`);
      last = { sent: false, status: res.status, error: body || res.statusText || 'send_failed', provider: p.name };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[email] ${p.name} send failed: ${msg}`);
      last = { sent: false, error: msg, provider: p.name };
    }
  }
  return last;
}

const pending = new Set<Promise<unknown>>();

/**
 * Sends without holding up the request. Account emails go out in the background so
 * a known address and an unknown one answer in the same time (no timing oracle).
 */
export function sendInBackground(m: EmailMessage): void {
  const p = sendEmail(m)
    .catch(() => undefined)
    .finally(() => pending.delete(p));
  pending.add(p);
}

/** Tests: wait for every background send started so far. */
export async function settleEmails(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}

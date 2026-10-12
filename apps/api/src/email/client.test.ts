import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { env } from '../env';
import { sendEmail, setEmailSinkForTests } from './client';

const MSG = { to: 'a@test.local', subject: 'S', html: '<p>h</p>', text: 't', category: 'email-verify', links: ['http://localhost:4100/x'] };
const saved = { resend: env.RESEND_API_KEY, mailtrap: env.MAILTRAP_API_TOKEN, local: env.isLocalMode };

function withProviders(resend?: string, mailtrap?: string, local = true) {
  setEmailSinkForTests(null);
  Object.assign(env, { RESEND_API_KEY: resend, MAILTRAP_API_TOKEN: mailtrap, isLocalMode: local });
}
afterEach(() => {
  Object.assign(env, { RESEND_API_KEY: saved.resend, MAILTRAP_API_TOKEN: saved.mailtrap, isLocalMode: saved.local });
  setEmailSinkForTests(() => {});
});

describe('sendEmail', () => {
  test('Resend first; a failure falls through to Mailtrap', async () => {
    withProviders('re_key', 'mt_token');
    const calls: string[] = [];
    const f = spyOn(globalThis, 'fetch').mockImplementation((async (url: string, init: RequestInit) => {
      calls.push(`${url} ${(init.headers as Record<string, string>).Authorization}`);
      return url.includes('resend') ? new Response('down', { status: 503 }) : new Response('{}', { status: 200 });
    }) as unknown as typeof fetch);
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = await sendEmail(MSG);
      expect(r).toMatchObject({ sent: true, provider: 'mailtrap' });
      expect(calls).toEqual(['https://api.resend.com/emails Bearer re_key', 'https://send.api.mailtrap.io/api/send Bearer mt_token']);
    } finally {
      f.mockRestore();
      warn.mockRestore();
    }
  });

  test('every provider failing reports the last one and never throws', async () => {
    withProviders('re_key', 'mt_token');
    const f = spyOn(globalThis, 'fetch').mockImplementation((async () => {
      throw new Error('timeout');
    }) as unknown as typeof fetch);
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await sendEmail(MSG)).toMatchObject({ sent: false, provider: 'mailtrap', error: 'timeout' });
    } finally {
      f.mockRestore();
      warn.mockRestore();
    }
  });

  test('no provider: a local run prints the links, anything else skips without them', async () => {
    const info = spyOn(console, 'info').mockImplementation(() => {});
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      withProviders(undefined, undefined, true);
      expect(await sendEmail(MSG)).toMatchObject({ sent: false, skipped: true, provider: 'console' });
      expect(String(info.mock.calls[0]?.[0])).toContain('http://localhost:4100/x');
      withProviders(undefined, undefined, false);
      expect(await sendEmail(MSG)).toMatchObject({ sent: false, skipped: true });
      expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).not.toContain('http://');
    } finally {
      info.mockRestore();
      warn.mockRestore();
    }
  });
});

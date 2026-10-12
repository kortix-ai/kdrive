import { esc, lifetime, renderFrame, renderText } from './layout';
import type { Rendered } from './verify';

/** "Forgot password": a one-time link to choose a new password. */
export function renderResetPassword(p: { url: string; email: string; expiresInSeconds: number }): Rendered {
  const life = lifetime(p.expiresInSeconds);
  const subject = 'Reset your KDRIVE password';
  const html = renderFrame({
    subject,
    preheader: `Choose a new password. The link works once and expires in ${life}.`,
    eyebrow: 'Password reset',
    title: 'Reset your password',
    body: [
      'We got a request to reset the password for your KDRIVE account. Choose a new one below.',
      'Resetting signs you out everywhere else.',
    ],
    cta: { label: 'Choose a new password', url: p.url },
    footer: [
      `Sent to ${esc(p.email)} &middot; The link works once and expires in ${life}.`,
      'If you did not ask for this, ignore this email: your password stays the same.',
    ],
  });
  const text = renderText([
    subject,
    '',
    'We got a request to reset the password for your KDRIVE account. Choose a new one here:',
    '',
    p.url,
    '',
    `The link works once and expires in ${life}. Resetting signs you out everywhere else.`,
    'If you did not ask for this, ignore this email: your password stays the same.',
  ]);
  return { subject, html, text };
}

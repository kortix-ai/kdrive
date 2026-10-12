import { esc, renderFrame, renderText } from './layout';
import type { Rendered } from './verify';

/** Once the address is confirmed (or arrives verified from a provider). */
export function renderWelcome(p: { email: string; name: string | null; appUrl: string }): Rendered {
  const subject = 'Welcome to KDRIVE';
  const hi = p.name ? `Welcome, ${esc(p.name)}.` : 'Welcome.';
  const html = renderFrame({
    subject,
    preheader: 'Every change is a version. Here is how to make the most of it.',
    eyebrow: 'Welcome',
    title: 'Your drive is ready',
    body: [
      `${hi} KDRIVE keeps every version of every file, so you can travel back, compare and restore, and undo the restore.`,
      'Drop files in, make checkpoints before big changes, and share read-only links that never expose the rest of your drive.',
    ],
    cta: { label: 'Open KDRIVE', url: p.appUrl },
    footer: [`Sent to ${esc(p.email)} because you created a KDRIVE account.`],
  });
  const text = renderText([
    subject,
    '',
    `${p.name ? `Welcome, ${p.name}.` : 'Welcome.'} KDRIVE keeps every version of every file, so you can travel back, compare and restore.`,
    '',
    `Open your drive: ${p.appUrl}`,
  ]);
  return { subject, html, text };
}

/** A sign-up attempt for an address that already has an account (the page itself never says so). */
export function renderAccountExists(p: { email: string; signInUrl: string; resetUrl: string }): Rendered {
  const subject = 'You already have a KDRIVE account';
  const html = renderFrame({
    subject,
    preheader: 'Someone tried to create an account with this address.',
    eyebrow: 'Account notice',
    title: 'You already have an account',
    body: [
      `Someone tried to create a KDRIVE account with ${esc(p.email)}, which already has one.`,
      `If it was you, sign in instead, or <a href="${esc(p.resetUrl)}" style="color:#ededf0;">reset your password</a> if you forgot it.`,
    ],
    cta: { label: 'Sign in', url: p.signInUrl },
    footer: [`Sent to ${esc(p.email)}. If this was not you, you can ignore this email: nothing changed.`],
  });
  const text = renderText([
    subject,
    '',
    `Someone tried to create a KDRIVE account with ${p.email}, which already has one.`,
    `Sign in: ${p.signInUrl}`,
    `Forgot your password? ${p.resetUrl}`,
    '',
    'If this was not you, you can ignore this email: nothing changed.',
  ]);
  return { subject, html, text };
}

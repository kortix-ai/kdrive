import { esc, lifetime, renderFrame, renderText, strong } from './layout';
import type { Rendered } from './verify';

/** Sent to the CURRENT address first: the owner approves moving the account to `newEmail`. */
export function renderChangeEmailConfirm(p: { url: string; email: string; newEmail: string; expiresInSeconds: number }): Rendered {
  const life = lifetime(p.expiresInSeconds);
  const subject = 'Approve your KDRIVE email change';
  const html = renderFrame({
    subject,
    preheader: `Someone asked to move this account to ${p.newEmail}.`,
    eyebrow: 'Email change',
    title: 'Approve the email change',
    body: [
      `Someone signed in to your KDRIVE account asked to change its email from ${strong(p.email)} to ${strong(p.newEmail)}.`,
      'Approve it below, then confirm from the new inbox. Nothing changes until both steps are done.',
    ],
    cta: { label: 'Approve change', url: p.url },
    footer: [
      `Sent to ${esc(p.email)} &middot; This link expires in ${life}.`,
      'If this was not you, ignore this email and change your password.',
    ],
  });
  const text = renderText([
    subject,
    '',
    `Someone signed in to your KDRIVE account asked to change its email from ${p.email} to ${p.newEmail}.`,
    'Approve it with the link below, then confirm from the new inbox.',
    '',
    p.url,
    '',
    `This link expires in ${life}. If this was not you, ignore this email and change your password.`,
  ]);
  return { subject, html, text };
}

import { INVITE_TTL_DAYS } from '@volumes/shared';
import { esc, renderFrame, renderText, strong } from './layout';
import type { Rendered } from './verify';

/** Someone invited this address to one of their drives (sent whether or not the address has an account). */
export function renderDriveInvite(p: {
  email: string;
  inviterName: string | null;
  inviterEmail: string;
  driveName: string;
  role: 'editor' | 'viewer';
  url: string;
}): Rendered {
  const who = p.inviterName ? `${p.inviterName} (${p.inviterEmail})` : p.inviterEmail;
  const can = p.role === 'editor' ? 'add, change and restore files' : 'browse, download and compare versions';
  const subject = `${p.inviterName ?? p.inviterEmail} invited you to “${p.driveName}” on KDRIVE`;
  const html = renderFrame({
    subject,
    preheader: `You can ${can} once you accept.`,
    eyebrow: 'Drive invitation',
    title: `Join ${esc(p.driveName)}`,
    body: [
      `${strong(who)} invited you to their drive ${strong(p.driveName)} as ${p.role === 'editor' ? 'an editor' : 'a viewer'}. Once you accept, you can ${can}.`,
      `Sign in (or create an account) with ${esc(p.email)} and accept it from the drive switcher. The invitation works for ${INVITE_TTL_DAYS} days.`,
    ],
    cta: { label: 'Open the invitation', url: p.url },
    footer: [`Sent to ${esc(p.email)} because ${esc(p.inviterEmail)} invited this address. If you were not expecting it, ignore this email: nothing happens until you accept.`],
  });
  const text = renderText([
    subject,
    '',
    `${who} invited you to their drive "${p.driveName}" as ${p.role === 'editor' ? 'an editor' : 'a viewer'}. Once you accept, you can ${can}.`,
    `Sign in (or create an account) with ${p.email} and accept it: ${p.url}`,
    `The invitation works for ${INVITE_TTL_DAYS} days. If you were not expecting it, ignore this email.`,
  ]);
  return { subject, html, text };
}

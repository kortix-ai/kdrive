import { esc, renderFrame, renderText } from './layout';
import type { Rendered } from './verify';

/** Notice after a password change or reset, with the way back if it was not the owner. */
export function renderPasswordChanged(p: {
  email: string;
  resetUrl: string;
  via: 'change' | 'reset';
  when: Date;
  /** Agent credentials ended along with the sessions (omitted or zero: none were). */
  agents?: { tokens: number; apps: number };
}): Rendered {
  const subject = 'Your KDRIVE password was changed';
  const when = p.when.toUTCString();
  const how = p.via === 'reset' ? 'with a reset link' : 'from your account settings';
  const agentLine = agentsRevokedLine(p.agents);
  const html = renderFrame({
    subject,
    preheader: `Changed ${how} on ${when}.`,
    eyebrow: 'Security notice',
    title: 'Your password was changed',
    body: [
      `The password for ${esc(p.email)} was changed ${how} on ${esc(when)}.`,
      'If this was you, there is nothing to do. If it was not, reset your password now: it signs out every other session.',
      ...(agentLine ? [esc(agentLine)] : []),
    ],
    cta: { label: 'Reset password', url: p.resetUrl },
    footer: [`Sent to ${esc(p.email)} because account security changed.`],
  });
  const text = renderText([
    subject,
    '',
    `The password for ${p.email} was changed ${how} on ${when}.`,
    'If this was you, there is nothing to do. If it was not, reset your password now:',
    '',
    p.resetUrl,
    ...(agentLine ? ['', agentLine] : []),
  ]);
  return { subject, html, text };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "Agent access ended too: …", or null when nothing was revoked. */
export function agentsRevokedLine(a: { tokens: number; apps: number } | undefined): string | null {
  if (!a || (!a.tokens && !a.apps)) return null;
  const parts = [a.tokens ? plural(a.tokens, 'agent token') : '', a.apps ? plural(a.apps, 'connected app') : ''].filter(Boolean);
  return `Agent access ended too: ${parts.join(' and ')} no longer work. Reconnect the ones you trust from Settings.`;
}

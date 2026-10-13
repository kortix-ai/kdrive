import { formatBytes, type Plan } from '@volumes/shared';
import { esc, renderFrame, renderText, strong } from './layout';
import type { Rendered } from './verify';

/** To the person who asked: an admin granted their storage request. */
export function renderStorageGranted(p: { email: string; plan: Plan; quotaBytes: number; url: string }): Rendered {
  const size = formatBytes(p.quotaBytes);
  const subject = `Your KDRIVE storage is now ${size}`;
  const html = renderFrame({
    subject,
    preheader: `Your request for ${p.plan.name} was granted.`,
    eyebrow: 'Storage',
    title: `You have ${esc(size)}`,
    body: [
      `Your request for ${strong(p.plan.name)} was granted: your drives can now hold ${strong(size)} together.`,
      'Nothing else changes. Every version you kept is still there.',
    ],
    cta: { label: 'Open KDRIVE', url: p.url },
    footer: [`Sent to ${esc(p.email)} because you requested more storage on KDRIVE.`],
  });
  const text = renderText([
    subject,
    '',
    `Your request for ${p.plan.name} was granted: your drives can now hold ${size} together.`,
    `Open your drive: ${p.url}`,
  ]);
  return { subject, html, text };
}

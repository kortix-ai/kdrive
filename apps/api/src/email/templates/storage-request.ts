import { formatBytes, type Plan } from '@volumes/shared';
import { esc, renderFrame, renderText, strong } from './layout';
import type { Rendered } from './verify';

/** To each admin: someone asked for a paid plan's storage. */
export function renderStorageRequest(p: {
  email: string;
  requester: { email: string; name: string | null };
  plan: Plan;
  note: string | null;
  quotaBytes: number;
  url: string;
}): Rendered {
  const who = p.requester.name ? `${p.requester.name} (${p.requester.email})` : p.requester.email;
  const size = formatBytes(p.plan.storageBytes);
  const subject = `${p.requester.name ?? p.requester.email} requested ${p.plan.name} on KDRIVE`;
  const html = renderFrame({
    subject,
    preheader: `${size} instead of ${formatBytes(p.quotaBytes)}. Grant or dismiss it from Admin.`,
    eyebrow: 'Storage request',
    title: `${esc(p.plan.name)} for ${esc(p.requester.email)}`,
    body: [
      `${strong(who)} asked for ${strong(`${p.plan.name} (${size})`)}. Their quota is ${esc(formatBytes(p.quotaBytes))} today.`,
      p.note ? `Their note: “${esc(p.note)}”` : 'They left no note.',
      'Granting raises their quota to the plan’s size and emails them; dismissing changes nothing.',
    ],
    cta: { label: 'Open storage requests', url: p.url },
    footer: [`Sent to ${esc(p.email)} because this address is a KDRIVE admin.`],
  });
  const text = renderText([
    subject,
    '',
    `${who} asked for ${p.plan.name} (${size}). Their quota is ${formatBytes(p.quotaBytes)} today.`,
    p.note ? `Their note: "${p.note}"` : 'They left no note.',
    `Grant or dismiss it: ${p.url}`,
  ]);
  return { subject, html, text };
}

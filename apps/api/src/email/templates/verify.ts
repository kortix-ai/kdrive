import { esc, lifetime, renderFrame, renderText, strong } from './layout';

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

/** Confirm an address: sent on sign-up, on "resend" and to the new address of an email change. */
export function renderVerifyEmail(p: { url: string; email: string; expiresInSeconds: number; change?: boolean }): Rendered {
  const life = lifetime(p.expiresInSeconds);
  const subject = p.change ? 'Confirm your new KDRIVE email' : 'Verify your email for KDRIVE';
  const lead = p.change
    ? `Confirm ${strong(p.email)} as the new email for your KDRIVE account.`
    : `Confirm ${strong(p.email)} so we know this address reaches you.`;
  const html = renderFrame({
    subject,
    preheader: `Confirm ${p.email}. The link expires in ${life}.`,
    eyebrow: 'Email verification',
    title: p.change ? 'Confirm your new email' : 'Verify your email',
    body: [lead],
    cta: { label: p.change ? 'Confirm new email' : 'Verify email', url: p.url },
    footer: [`Sent to ${esc(p.email)} &middot; This link expires in ${life}.`, 'If you did not ask for this, you can ignore this email.'],
  });
  const text = renderText([
    subject,
    '',
    p.change ? `Confirm ${p.email} as the new email for your KDRIVE account.` : `Confirm ${p.email} so we know this address reaches you.`,
    '',
    p.url,
    '',
    `This link expires in ${life}. If you did not ask for this, you can ignore this email.`,
  ]);
  return { subject, html, text };
}

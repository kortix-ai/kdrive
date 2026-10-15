import { esc, renderFrame, renderText, strong } from './layout';
import type { Rendered } from './verify';

/** A share link was limited to this address: where it is, and that opening it needs a sign-in with this address. */
export function renderLinkShared(p: {
  email: string;
  senderName: string | null;
  senderEmail: string;
  itemName: string;
  isDir: boolean;
  hasPassword: boolean;
  url: string;
  /** An upload link: they are asked to send files into the folder. */
  upload?: boolean;
}): Rendered {
  if (p.upload) return renderUploadRequest(p);
  const who = p.senderName ? `${p.senderName} (${p.senderEmail})` : p.senderEmail;
  const what = p.isDir ? 'a folder' : 'a file';
  const subject = `${p.senderName ?? p.senderEmail} shared “${p.itemName}” with you on KDRIVE`;
  const password = p.hasPassword ? `The link also has a password. Ask ${p.senderName ?? p.senderEmail} for it.` : null;
  const html = renderFrame({
    subject,
    preheader: `Sign in with ${p.email} to open it.`,
    eyebrow: p.isDir ? 'Shared folder' : 'Shared file',
    title: p.itemName,
    body: [
      `${strong(who)} shared ${what}, ${strong(p.itemName)}, with you.`,
      `The link only opens for the people it names. Sign in (or create an account) with ${esc(p.email)} to open it.`,
      ...(password ? [esc(password)] : []),
    ],
    cta: { label: p.isDir ? 'Open the folder' : 'Open the file', url: p.url },
    footer: [`Sent to ${esc(p.email)} because ${esc(p.senderEmail)} shared a link with this address. If you were not expecting it, ignore this email.`],
  });
  const text = renderText([
    subject,
    '',
    `${who} shared ${what}, "${p.itemName}", with you.`,
    `Sign in (or create an account) with ${p.email} to open it: ${p.url}`,
    password,
    'If you were not expecting it, ignore this email.',
  ]);
  return { subject, html, text };
}

/** An upload link was limited to this address: where to send files, and that it needs a sign-in with this address. */
function renderUploadRequest(p: { email: string; senderName: string | null; senderEmail: string; itemName: string; hasPassword: boolean; url: string }): Rendered {
  const who = p.senderName ? `${p.senderName} (${p.senderEmail})` : p.senderEmail;
  const subject = `${p.senderName ?? p.senderEmail} asked you to send files to “${p.itemName}” on KDRIVE`;
  const password = p.hasPassword ? `The link also has a password. Ask ${p.senderName ?? p.senderEmail} for it.` : null;
  const html = renderFrame({
    subject,
    preheader: `Sign in with ${p.email} to send them.`,
    eyebrow: 'Upload link',
    title: p.itemName,
    body: [
      `${strong(who)} asked you to send files to the folder ${strong(p.itemName)}. You will not see what is already in it.`,
      `The link only opens for the people it names. Sign in (or create an account) with ${esc(p.email)} to use it.`,
      ...(password ? [esc(password)] : []),
    ],
    cta: { label: 'Send files', url: p.url },
    footer: [`Sent to ${esc(p.email)} because ${esc(p.senderEmail)} shared a link with this address. If you were not expecting it, ignore this email.`],
  });
  const text = renderText([
    subject,
    '',
    `${who} asked you to send files to the folder "${p.itemName}".`,
    `Sign in (or create an account) with ${p.email} to use the link: ${p.url}`,
    password,
    'If you were not expecting it, ignore this email.',
  ]);
  return { subject, html, text };
}

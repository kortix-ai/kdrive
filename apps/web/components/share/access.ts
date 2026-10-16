import { LINK_EMAILS_MAX, LINK_PASSWORD_MIN, type ShareLink, type UpdateLinkRequest } from '@volumes/shared';

/** The access part of the share form, as the user edits it. */
export interface AccessDraft {
  passwordOn: boolean;
  /** A new password. Empty while the link already has one = keep it. */
  password: string;
  allowDownload: boolean;
  peopleOn: boolean;
  emails: string[];
}

export const OPEN_ACCESS: AccessDraft = { passwordOn: false, password: '', allowDownload: true, peopleOn: false, emails: [] };

export function draftFromLink(link: Pick<ShareLink, 'hasPassword' | 'allowDownload' | 'allowedEmails'>): AccessDraft {
  return {
    passwordOn: link.hasPassword,
    password: '',
    allowDownload: link.allowDownload,
    peopleOn: link.allowedEmails.length > 0,
    emails: [...link.allowedEmails],
  };
}

type AccessRequest = Pick<UpdateLinkRequest, 'password' | 'allowDownload' | 'allowedEmails'>;

/**
 * The request fields for a draft. `hadPassword`: the link being edited has one
 * (an empty field keeps it; turning the switch off removes it).
 * Throws an Error with user-facing text when the draft is incomplete.
 */
export function accessRequest(d: AccessDraft, hadPassword = false): AccessRequest {
  const out: AccessRequest = { allowDownload: d.allowDownload, allowedEmails: d.peopleOn ? d.emails : [] };
  if (d.passwordOn) {
    if (d.password) {
      if (d.password.length < LINK_PASSWORD_MIN) throw new Error(`Use at least ${LINK_PASSWORD_MIN} characters for the password.`);
      out.password = d.password;
    } else if (!hadPassword) throw new Error('Type a password, or turn the password off.');
  } else if (hadPassword) out.password = null;
  if (d.peopleOn && d.emails.length === 0) throw new Error('Add at least one email address, or let anyone with the link open it.');
  return out;
}

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/**
 * Splits typed or pasted text into addresses (commas, semicolons, spaces or
 * new lines between them), lower-cased. `invalid` keeps what does not look
 * like an address, so the field can leave it for the user to fix.
 */
export function parseEmails(text: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const t = raw.trim().replace(/^<|>$/g, '').toLowerCase();
    if (!t) continue;
    (EMAIL.test(t) ? valid : invalid).push(t);
  }
  return { valid, invalid };
}

/** Adds addresses to a list: no duplicates, at most LINK_EMAILS_MAX. */
export function addEmails(list: string[], more: string[]): string[] {
  const out = [...list];
  for (const e of more) if (!out.includes(e) && out.length < LINK_EMAILS_MAX) out.push(e);
  return out;
}

/** Small badges for a link's access: "Password", "No download", "3 people". */
export function accessBadges(link: Pick<ShareLink, 'hasPassword' | 'allowDownload' | 'allowedEmails'>): ('password' | 'view-only' | 'people')[] {
  const out: ('password' | 'view-only' | 'people')[] = [];
  if (link.allowedEmails.length) out.push('people');
  if (link.hasPassword) out.push('password');
  if (!link.allowDownload) out.push('view-only');
  return out;
}

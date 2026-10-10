// What better-auth calls to send account mail. Every send goes out in the
// background (sendInBackground), so an address with an account and one without
// answer in the same time, and a slow provider never holds a request open.
import { decodeJwt } from 'jose';
import { sendInBackground } from '../email/client';
import { renderChangeEmailConfirm } from '../email/templates/change-email';
import { renderPasswordChanged } from '../email/templates/password-changed';
import { renderResetPassword } from '../email/templates/reset';
import { renderVerifyEmail } from '../email/templates/verify';
import { renderAccountExists, renderWelcome } from '../email/templates/welcome';
import { limits, tryTakeRateLimitKey } from '../middleware/rate-limit';
import { appUrl, emailActionLink } from './policy';

/** Verification links live a day: people click them out of the inbox the next morning. */
export const EMAIL_VERIFY_TTL_SECONDS = 60 * 60 * 24;
/** Reset links live an hour and work once. */
export const RESET_TTL_SECONDS = 60 * 60;

type U = { id: string; email: string; name?: string | null };

/** True when a verify-email token is part of an email change (it carries `updateTo`). */
export function isEmailChangeToken(token: string | null | undefined): boolean {
  if (!token) return false;
  try {
    return typeof decodeJwt(token).updateTo === 'string';
  } catch {
    return false;
  }
}

// better-auth hands each sender its own API URL; the mail carries a page link instead (see emailActionLink).
export function sendVerification({ user, token }: { user: U; url: string; token: string }): void {
  const change = isEmailChangeToken(token);
  const link = emailActionLink(change ? 'confirm' : 'verify', token);
  const r = renderVerifyEmail({ url: link, email: user.email, expiresInSeconds: EMAIL_VERIFY_TTL_SECONDS, change });
  sendInBackground({ to: user.email, ...r, category: change ? 'email-change-verify' : 'email-verify', links: [link] });
}

export function sendChangeEmailConfirmation({ user, newEmail, token }: { user: U; newEmail: string; url: string; token: string }): void {
  const link = emailActionLink('approve', token);
  const r = renderChangeEmailConfirm({ url: link, email: user.email, newEmail, expiresInSeconds: EMAIL_VERIFY_TTL_SECONDS });
  sendInBackground({ to: user.email, ...r, category: 'email-change-confirm', links: [link] });
}

export function sendResetPassword({ user, url }: { user: U; url: string }): void {
  const r = renderResetPassword({ url, email: user.email, expiresInSeconds: RESET_TTL_SECONDS });
  sendInBackground({ to: user.email, ...r, category: 'password-reset', links: [url] });
}

export function sendPasswordChanged(user: U, via: 'change' | 'reset', agents?: { tokens: number; apps: number }): void {
  const resetUrl = appUrl(`/forgot-password?email=${encodeURIComponent(user.email)}`);
  const r = renderPasswordChanged({ email: user.email, resetUrl, via, when: new Date(), agents });
  sendInBackground({ to: user.email, ...r, category: 'password-changed' });
}

export function sendWelcome(user: U): void {
  const r = renderWelcome({ email: user.email, name: user.name ?? null, appUrl: appUrl('/drive') });
  sendInBackground({ to: user.email, ...r, category: 'welcome' });
}

/**
 * Sent when someone signs up with an address that already has an account. At most one
 * per address per hour: sign-up answers the same either way, so a repeat is skipped
 * silently instead of letting anyone mail a registered address on demand.
 */
export function sendAccountExists(user: U): void {
  if (!tryTakeRateLimitKey(limits.accountExistsMail, user.email.toLowerCase())) return;
  const q = `?email=${encodeURIComponent(user.email)}`;
  const r = renderAccountExists({ email: user.email, signInUrl: appUrl(`/signin${q}`), resetUrl: appUrl(`/forgot-password${q}`) });
  sendInBackground({ to: user.email, ...r, category: 'account-exists' });
}

import { APIError } from 'better-auth/api';
import { env, isAdminEmail } from '../env';

/** The one refusal for every gated sign-up, whatever the reason and whether or not the address exists. */
export const SIGNUP_RESTRICTED = 'Sign-ups are invite-only right now. Ask the KDRIVE team for access.';

/**
 * May this address create an account? Read at call time (tests and operators
 * can change the mode without rebuilding the auth instance).
 *  - open: anyone.
 *  - invite-only: admins plus VOLUMES_SIGNUP_ALLOWLIST (exact addresses or `@domain`).
 *  - closed: admins only (how the first admin of a closed install gets in).
 */
export function signupAllowed(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (env.signupMode === 'open' || isAdminEmail(e)) return true;
  if (env.signupMode === 'closed') return false;
  const domain = `@${e.split('@')[1] ?? ''}`;
  return env.signupAllowlist.includes(e) || env.signupAllowlist.includes(domain);
}

export function assertSignupAllowed(email: string): void {
  if (!signupAllowed(email)) throw new APIError('FORBIDDEN', { message: SIGNUP_RESTRICTED, code: 'SIGNUP_RESTRICTED' });
}

/** What an emailed account link asks the user to confirm on /verify-email. */
export type EmailLinkStep = 'verify' | 'approve' | 'confirm';

/**
 * The link an account email carries: a page on the app, never the API call itself.
 * Mail gateways and link scanners fetch every URL in a message, so a link that
 * changed state on GET would verify (or approve an email change) without the
 * user. The page shows what the link will do and calls the API only when the
 * user presses its button.
 */
export function emailActionLink(step: EmailLinkStep, token: string): string {
  return `${env.BETTER_AUTH_URL}/verify-email?${new URLSearchParams({ step, token })}`;
}

/** Absolute app URL for a path. */
export const appUrl = (path: string) => `${env.BETTER_AUTH_URL}${path}`;

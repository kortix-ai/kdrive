import { APIError } from 'better-auth/api';
import { env } from '../env';
import { isAdminEmail } from '../services/admins';

/** The one refusal for every gated sign-up, whatever the reason and whether or not the address exists. */
export const SIGNUP_RESTRICTED = 'Sign-ups are invite-only right now. Ask the KDRIVE team for access.';

/**
 * May this address create an account? Read at call time (tests and operators
 * can change the mode without rebuilding the auth instance).
 *  - open: anyone.
 *  - invite-only: admins (VOLUMES_ADMIN_EMAILS and the `admins` table) plus VOLUMES_SIGNUP_ALLOWLIST
 *    (exact addresses or `@domain`).
 *  - closed: admins only (how the founder of a closed install gets in: list them in VOLUMES_ADMIN_EMAILS).
 */
export async function signupAllowed(email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (env.signupMode === 'open' || (await isAdminEmail(e))) return true;
  if (env.signupMode === 'closed') return false;
  const domain = `@${e.split('@')[1] ?? ''}`;
  return env.signupAllowlist.includes(e) || env.signupAllowlist.includes(domain);
}

/**
 * A provider sign-in (Google, GitHub) creates its account inside better-auth's OAuth callback,
 * which catches a refusal and sends the browser back to the page's errorCallbackURL with the
 * error's message, spaces turned into underscores, as `?error=`. There the message is the code,
 * so the sign-in page reads `?error=SIGNUP_RESTRICTED` and shows the same refusal as an email
 * sign-up. Everywhere else (a JSON answer) the message is the readable sentence.
 */
export function isOAuthCallbackPath(path: string | undefined): boolean {
  return !!path && /^\/(?:oauth2\/)?callback\//.test(path);
}

export async function assertSignupAllowed(email: string, ctx?: { path?: string } | null): Promise<void> {
  if (await signupAllowed(email)) return;
  const message = isOAuthCallbackPath(ctx?.path) ? 'SIGNUP_RESTRICTED' : SIGNUP_RESTRICTED;
  throw new APIError('FORBIDDEN', { message, code: 'SIGNUP_RESTRICTED' });
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

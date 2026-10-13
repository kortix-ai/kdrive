'use client';

import { CircleAlert, CircleCheck } from 'lucide-react';
import { isApiError } from '@/lib/api/client';

const AUTH_PAGE = /^\/(signin|signup|forgot-password|reset-password|verify-email)(?:\/|$)/;

/**
 * Only same-origin app paths are honoured as `?next=`. Decided by parsing, the way the
 * browser will: `/\t/evil.com` and `/.//evil.com` look relative but resolve to another
 * host. Auth pages are never a target, except an email link's confirm step, which is
 * where "sign in to confirm your new email" has to come back to.
 */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(raw)) return '/drive';
  let u: URL;
  try {
    u = new URL(raw, 'http://app.invalid');
  } catch {
    return '/drive';
  }
  const out = `${u.pathname}${u.search}${u.hash}`;
  if (u.origin !== 'http://app.invalid' || out.startsWith('//')) return '/drive';
  if (AUTH_PAGE.test(u.pathname)) {
    const confirmStep = u.pathname === '/verify-email' && u.searchParams.get('step') === 'confirm' && !!u.searchParams.get('token');
    if (!confirmStep) return '/drive';
  }
  return out;
}

/** Plain copy for the `?error=` code better-auth appends when a provider sign-in fails. */
export function oauthErrorCopy(code: string | null): { message: string; reset: boolean } | null {
  if (!code) return null;
  if (code === 'account_not_linked') {
    return {
      message: 'This email already has a password account. Sign in with your password or reset it, then connect the provider in Settings.',
      reset: true,
    };
  }
  if (code === 'SIGNUP_RESTRICTED') return { message: authErrorCopy({ code }, ''), reset: false };
  if (code === 'access_denied') return { message: 'Sign-in was cancelled.', reset: false };
  return { message: 'Sign-in failed. Try again.', reset: false };
}

const PROVIDER_NAMES: Record<string, string> = { github: 'GitHub' };

/** A provider's display label, derived from its configured id (e.g. "acme" → "Acme"). */
export function providerLabel(id: string): string {
  return PROVIDER_NAMES[id] ?? (id ? id.charAt(0).toUpperCase() + id.slice(1) : id);
}

/**
 * The provider button's label. On /signup it says what the page is for ("Sign up with Google");
 * on /signin "Continue with", since a first provider sign-in there opens a new account too.
 */
export function providerButtonLabel(id: string, mode: 'signin' | 'signup'): string {
  return `${mode === 'signup' ? 'Sign up with' : 'Continue with'} ${providerLabel(id)}`;
}

/** Inline error row (no toasts on auth pages). */
export function ErrorRow({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-4 flex items-start gap-2 rounded-vx-sm bg-vx-danger-wash px-3 py-2 text-[13px] leading-5 text-vx-danger">
      <CircleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Inline confirmation row. */
export function NoticeRow({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="mt-4 flex items-start gap-2 rounded-vx-sm bg-vx-surface-2 px-3 py-2 text-[13px] leading-5 text-vx-text-2">
      <CircleCheck size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-vx-text-3" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** The "or" rule between providers and the email form. */
export function OrRule() {
  return (
    <div className="my-6 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[.14em] text-vx-text-3" aria-hidden>
      <span className="h-px flex-1 bg-vx-hair" />
      or
      <span className="h-px flex-1 bg-vx-hair" />
    </div>
  );
}

/** better-auth client errors: `{ status, code, message }`. */
interface AuthClientError {
  status?: number;
  code?: string;
  message?: string;
}

/** Plain copy for a failed auth call (better-auth client error or a thrown ApiError). */
export function authErrorCopy(e: unknown, fallback: string): string {
  const err = (e ?? {}) as AuthClientError;
  const status = isApiError(e) ? e.status : err.status;
  const code = isApiError(e) ? e.code : err.code;
  if (status === 429 || code === 'rate_limited') return 'Too many attempts. Wait a few minutes, then try again.';
  if (status === 0) return "Can't reach the server. Check your connection and try again.";
  switch (code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'Wrong email or password.';
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'Could not create an account with this email. If it is yours, sign in or reset your password.';
    case 'SIGNUP_RESTRICTED':
      return 'Sign-ups are invite-only right now. Use the address you were invited with, or ask the KDRIVE team for access.';
    case 'EMAIL_PASSWORD_SIGN_UP_DISABLED':
      return 'Creating an account with a password is turned off here.';
    case 'INVALID_PASSWORD':
      return 'Your current password is not right.';
    case 'CREDENTIAL_ACCOUNT_NOT_FOUND':
      return 'This account has no password yet. Use "Forgot password" to set one.';
    case 'SESSION_EXPIRED':
    case 'SESSION_NOT_FRESH':
      return 'For your security, sign in again before making this change.';
    case 'email_not_verified':
      return 'Verify your email to continue. Check your inbox for the link.';
    case 'PASSWORD_TOO_SHORT':
      return 'That password is too short.';
    case 'PASSWORD_TOO_LONG':
      return 'That password is too long.';
    case 'INVALID_EMAIL':
      return 'Enter a valid email address.';
    case 'INVALID_TOKEN':
      return 'This link is invalid or has expired. Ask for a new one.';
    default:
      return err.message || (e instanceof Error && e.message) || fallback;
  }
}

export interface Strength {
  /** 0 (too short) … 4 (strong). */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  hint: string;
}

const COMMON = /^(password|passw0rd|qwerty|letmein|welcome|admin|iloveyou|abc123|123456|111111|000000|kdrive)/i;

/**
 * A quick, honest estimate: length counts most (NIST 800-63B), variety a little, and obvious
 * patterns (a common word, one repeated character, a straight run) pull it down. The server
 * only enforces the length bounds; this is guidance, never a rule.
 */
export function passwordStrength(pw: string, min = 8): Strength {
  if (pw.length < min) return { score: 0, label: 'Too short', hint: `Use at least ${min} characters.` };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  let points = pw.length >= 16 ? 3 : pw.length >= 12 ? 2 : 1;
  if (kinds >= 3) points += 1;
  if (/\s/.test(pw.trim()) && pw.length >= 14) points += 1; // a passphrase
  if (COMMON.test(pw) || /^(.)\1+$/.test(pw) || /^(0123|1234|abcd|qwer)/i.test(pw)) points = 1;
  const score = Math.max(1, Math.min(4, points)) as 1 | 2 | 3 | 4;
  const label = ['', 'Weak', 'Fair', 'Good', 'Strong'][score]!;
  const hint =
    score >= 4 ? 'Great password.' : score === 3 ? 'Good. Longer is even better.' : 'Try a longer phrase of a few unrelated words.';
  return { score, label, hint };
}

/** Four segments under a new-password field; the label is read out with the hint. */
export function StrengthMeter({ password, min }: { password: string; min?: number }) {
  if (!password) return null;
  const s = passwordStrength(password, min);
  const tone = s.score <= 1 ? 'bg-vx-danger' : s.score === 2 ? 'bg-vx-text-3' : 'bg-vx-text-1';
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i <= s.score ? tone : 'bg-vx-hair'}`} />
        ))}
      </div>
      <p className="vx-meta mt-1.5 text-vx-text-3">
        <span className="font-medium text-vx-text-2">{s.label}.</span> {s.hint}
      </p>
    </div>
  );
}

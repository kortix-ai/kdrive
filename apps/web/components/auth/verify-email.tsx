'use client';

// Email verification in the app: the banner over the main sheet for an unverified address,
// and the full-screen hold when the server requires verification (config.requireEmailVerification).
// Both resend through better-auth with a 60 s cooldown that survives a reload of the tab.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, MailCheck, X } from 'lucide-react';
import type { MeResponse } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { signOutAndEnd } from '@/lib/session';
import { AuthCard, AuthFrame } from './auth-frame';
import { ErrorRow, NoticeRow, authErrorCopy } from './auth-bits';

export const RESEND_COOLDOWN_S = 60;
const key = (email: string) => `vx.verify-sent.${email.toLowerCase()}`;

/** Seconds until another resend is allowed (0 = now). */
export function cooldownLeft(sentAt: number | null, now: number, seconds = RESEND_COOLDOWN_S): number {
  if (!sentAt || !Number.isFinite(sentAt)) return 0;
  return Math.max(0, Math.ceil((sentAt + seconds * 1000 - now) / 1000));
}

function readSentAt(email: string): number | null {
  try {
    const v = Number(window.sessionStorage.getItem(key(email)));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Resend state for one address: send(), the seconds left, and the outcome. */
export function useResendVerification(email: string) {
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setSentAt(readSentAt(email)), [email]);
  const left = cooldownLeft(sentAt, now);
  useEffect(() => {
    if (!left) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [left]);

  const send = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await authClient().sendVerificationEmail({ email, callbackURL: '/verify-email' });
      if (res.error) throw res.error;
      const t = Date.now();
      try {
        window.sessionStorage.setItem(key(email), String(t));
      } catch {
        /* private mode: the cooldown just will not survive a reload */
      }
      setSentAt(t);
      setNow(t);
      setSent(true);
    } catch (e) {
      setError(authErrorCopy(e, 'Could not send the email. Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  }, [email]);

  return { send, busy, sent, error, left };
}

function ResendButton({ email, size = 'sm', variant = 'text' }: { email: string; size?: 'sm' | 'lg'; variant?: 'text' | 'primary' }) {
  const r = useResendVerification(email);
  return (
    <>
      <Button size={size} variant={variant} block={size === 'lg'} onClick={() => void r.send()} loading={r.busy} disabled={r.left > 0}>
        {r.left > 0 ? `Resend in ${r.left}s` : r.sent ? 'Send again' : 'Resend email'}
      </Button>
      {r.error ? <span className="sr-only" role="alert">{r.error}</span> : null}
      {r.error && size === 'lg' ? <ErrorRow>{r.error}</ErrorRow> : null}
      {r.sent && size === 'lg' ? <NoticeRow>Sent. The link works for 24 hours.</NoticeRow> : null}
    </>
  );
}

/** The thin bar over the main sheet. Dismissable for this tab. */
export function VerifyBanner({ email }: { email: string }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(window.sessionStorage.getItem('vx.verify-banner') === 'hidden');
    } catch {
      setHidden(false);
    }
  }, []);
  if (hidden) return null;
  const hide = () => {
    setHidden(true);
    try {
      window.sessionStorage.setItem('vx.verify-banner', 'hidden');
    } catch {
      /* ignore */
    }
  };
  return (
    <div role="region" aria-label="Verify your email" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-vx-hair bg-vx-surface-2 px-4 py-2">
      <MailCheck size={16} strokeWidth={1.75} className="shrink-0 text-vx-text-3" aria-hidden />
      <p className="vx-body min-w-0 flex-[1_1_220px] text-vx-text-2">
        Verify <span className="font-medium text-vx-text-1">{email}</span> so you can always get back into your account.
      </p>
      <ResendButton email={email} />
      <button type="button" onClick={hide} className="rounded-vx-sm p-1 text-vx-text-3 hover:text-vx-text-1" aria-label="Hide for now">
        <X size={16} strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );
}

/** Held: the server requires a verified address before the drive opens. */
export function VerifyHold({ me, onVerified }: { me: MeResponse; onVerified: () => void }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  // Coming back from the inbox in another tab: check again whenever this tab regains focus.
  useEffect(() => {
    window.addEventListener('focus', onVerified);
    return () => window.removeEventListener('focus', onVerified);
  }, [onVerified]);
  const out = async () => {
    setLeaving(true);
    await signOutAndEnd();
    router.replace('/signin');
  };
  return (
    <AuthFrame>
      <AuthCard className="max-w-[440px] px-[34px] pb-7 pt-[34px] max-[720px]:px-5 max-[720px]:pb-[22px] max-[720px]:pt-[26px]">
        <MailCheck size={28} strokeWidth={1.5} className="text-vx-text-2" aria-hidden />
        <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.03em] text-vx-text-1 mt-5">Check your inbox</h1>
        <p className="mt-2 text-[16px] leading-6 text-vx-text-2">
          We sent a verification link to <span className="font-medium text-vx-text-1">{me.user.email}</span>. Open it to start using KDRIVE.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <ResendButton email={me.user.email} size="lg" variant="primary" />
          <Button size="lg" variant="outline" block onClick={onVerified}>
            I have verified it
          </Button>
        </div>
        <p className="mt-6 text-[14px] leading-5 text-vx-text-3">Wrong address? Sign out and create the account again with the right one.</p>
        <Button size="sm" variant="text" className="mt-2 -ml-2" icon={<LogOut size={14} strokeWidth={1.75} aria-hidden />} onClick={() => void out()} loading={leaving}>
          Sign out
        </Button>
      </AuthCard>
    </AuthFrame>
  );
}

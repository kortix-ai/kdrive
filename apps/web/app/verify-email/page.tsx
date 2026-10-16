'use client';

// /verify-email: where every emailed account link lands. With ?step=&token= it asks the user to
// confirm (ConfirmLink: the link alone changes nothing); afterwards it shows the outcome from the
// query (see verifyState) and offers the next step: open the drive, sign in, or get a fresh link.
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CircleAlert, CircleCheck, MailCheck } from 'lucide-react';
import { OAuthShell } from '@/components/agents/consent-card';
import { ConfirmLink } from '@/components/auth/confirm-link';
import { useResendVerification } from '@/components/auth/verify-email';
import { ErrorRow, NoticeRow } from '@/components/auth/auth-bits';
import { VERIFY_COPY, linkStep, verifyState } from '@/components/auth/verify-state';
import { Button, buttonClass } from '@/components/ui/button';
import { useMeIfSignedIn } from '@/lib/api/hooks';

function Resend({ email }: { email: string }) {
  const r = useResendVerification(email);
  return (
    <>
      <Button variant="primary" size="lg" block onClick={() => void r.send()} loading={r.busy} disabled={r.left > 0}>
        {r.left > 0 ? `Resend in ${r.left}s` : 'Send a new link'}
      </Button>
      {r.sent ? <NoticeRow>Sent to {email}. The link works for 24 hours.</NoticeRow> : null}
      {r.error ? <ErrorRow>{r.error}</ErrorRow> : null}
    </>
  );
}

function Verify() {
  const params = useSearchParams();
  const pending = linkStep(params);
  return (
    <OAuthShell width={440}>
      {pending ? <ConfirmLink key={pending.token} step={pending.step} token={pending.token} /> : <Outcome params={params} />}
    </OAuthShell>
  );
}

function Outcome({ params }: { params: { get(name: string): string | null } }) {
  const state = verifyState(params);
  const copy = VERIFY_COPY[state];
  const { data: me, signedOut } = useMeIfSignedIn();
  const ok = state !== 'expired' && state !== 'invalid';
  const Icon = state === 'change-approved' ? MailCheck : ok ? CircleCheck : CircleAlert;

  return (
    <>
      <Icon size={28} strokeWidth={1.5} className={ok ? 'text-vx-text-2' : 'text-vx-danger'} aria-hidden />
      <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.03em] text-vx-text-1 mt-5">{copy.title}</h1>
      <p className="mt-2 text-[16px] leading-6 text-vx-text-2">{copy.body}</p>
      <div className="mt-7 flex flex-col gap-3">
        {ok ? (
          me ? (
            <Link href="/drive" className={buttonClass('primary', 'lg', { block: true })}>
              Open my drive
            </Link>
          ) : signedOut ? (
            <Link href="/signin" className={buttonClass('primary', 'lg', { block: true })}>
              Sign in
            </Link>
          ) : (
            <span className="skeleton block h-12 w-full !rounded-vx-md" />
          )
        ) : me && !me.user.emailVerified ? (
          <Resend email={me.user.email} />
        ) : me ? (
          <Link href="/drive" className={buttonClass('primary', 'lg', { block: true })}>
            Open my drive
          </Link>
        ) : (
          <>
            <Link href="/signin?next=/drive" className={buttonClass('primary', 'lg', { block: true })}>
              Sign in to get a new link
            </Link>
            <p className="text-center text-[13px] leading-5 text-vx-text-3">Once you are signed in, the banner at the top of your drive sends a fresh one.</p>
          </>
        )}
      </div>
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <Verify />
    </Suspense>
  );
}

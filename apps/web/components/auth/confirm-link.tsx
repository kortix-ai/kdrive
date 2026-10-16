'use client';

// The first screen of every emailed account link (/verify-email?step=…&token=…). Mail
// gateways and link scanners open every URL in a message, so the link itself changes
// nothing: the API call happens only when the user presses the button. The last step of
// an email change needs the account signed in, so a signed-out visitor is sent to sign in
// and brought back here.
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { mutate } from 'swr';
import { MailCheck } from 'lucide-react';
import { Button, buttonClass } from '@/components/ui/button';
import { useMeIfSignedIn } from '@/lib/api/hooks';
import { ErrorRow, authErrorCopy } from './auth-bits';
import { STEP_COPY, stepResultQuery, type LinkStep } from './verify-state';

export function ConfirmLink({ step, token }: { step: LinkStep; token: string }) {
  const router = useRouter();
  const { data: me, signedOut } = useMeIfSignedIn();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needSignIn, setNeedSignIn] = useState(false);
  const copy = STEP_COPY[step];
  const here = `/verify-email?${new URLSearchParams({ step, token })}`;
  const signIn = `/signin?next=${encodeURIComponent(here)}`;
  const mustSignIn = step === 'confirm' && (signedOut || needSignIn);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/auth/verify-email?${new URLSearchParams({ token })}`, { credentials: 'include', cache: 'no-store' });
      const body = (await r.json().catch(() => null)) as { code?: string } | null;
      const code = r.ok ? null : (body?.code ?? 'INVALID_TOKEN');
      if (code === 'SIGN_IN_REQUIRED') {
        setNeedSignIn(true);
        setBusy(false);
        return;
      }
      if (!code) await mutate('me');
      router.replace(`/verify-email${stepResultQuery(step, code)}`);
    } catch (e) {
      setError(authErrorCopy(e, 'Could not reach the server. Try again.'));
      setBusy(false);
    }
  };

  return (
    <>
      <MailCheck size={28} strokeWidth={1.5} className="text-vx-text-2" aria-hidden />
      <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.03em] text-vx-text-1 mt-5">{copy.title}</h1>
      <p className="mt-2 text-[16px] leading-6 text-vx-text-2">{copy.body}</p>
      {me && step !== 'verify' ? (
        <p className="vx-meta mt-2 text-vx-text-3">
          Signed in as <span className="font-medium text-vx-text-2">{me.user.email}</span>.
        </p>
      ) : null}
      <div className="mt-7 flex flex-col gap-3">
        {mustSignIn ? (
          <>
            <Link href={signIn} className={buttonClass('primary', 'lg', { block: true })}>
              Sign in to confirm
            </Link>
            <p className="text-center text-[13px] leading-5 text-vx-text-3">Sign in with your current email. You come back here afterwards.</p>
          </>
        ) : (
          <Button variant="primary" size="lg" block onClick={() => void go()} loading={busy}>
            {copy.action}
          </Button>
        )}
      </div>
      {error ? <ErrorRow>{error}</ErrorRow> : null}
    </>
  );
}

'use client';

// /forgot-password: ask for a reset link. The answer never says whether the email has an
// account. Offered only where the server can deliver the link (config.passwordReset).
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { OAuthShell } from '@/components/agents/consent-card';
import { ErrorRow, NoticeRow, authErrorCopy } from '@/components/auth/auth-bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfig } from '@/lib/api/hooks';
import { authClient } from '@/lib/auth-client';

function Forgot() {
  const params = useSearchParams();
  const { data: config } = useConfig();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authClient().requestPasswordReset({ email: email.trim(), redirectTo: `${window.location.origin}/reset-password` });
      if (res.error) throw res.error;
      setSent(true);
    } catch (err) {
      setError(authErrorCopy(err, 'Could not send a reset link.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OAuthShell width={440}>
      <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.03em] text-vx-text-1">Reset your <span>password.</span></h1>
      <p className="mt-2 text-[16px] leading-6 text-vx-text-2">Enter your account&apos;s email and we&apos;ll send you a link to choose a new password.</p>
      {config && !config.passwordReset ? (
        <ErrorRow>Password reset isn&apos;t available on this server yet.</ErrorRow>
      ) : sent ? (
        <NoticeRow>If an account uses {email.trim()}, a reset link is on its way. It works for one hour.</NoticeRow>
      ) : (
        <form onSubmit={submit} className="mt-6">
          <Input size="lg" id="email" label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <Button variant="primary" size="lg" block type="submit" className="mt-4" loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
      {error ? <ErrorRow>{error}</ErrorRow> : null}
      <p className="vx-body mt-6 text-center text-vx-text-3">
        <Link href="/signin" className="font-medium text-vx-text-1 underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </OAuthShell>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <Forgot />
    </Suspense>
  );
}

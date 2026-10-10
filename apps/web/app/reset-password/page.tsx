'use client';

// /reset-password?token=…: choose a new password. Every other session of the account ends;
// the user then signs in with the new password.
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PASSWORD_MAX, PASSWORD_MIN } from '@volumes/shared';
import { OAuthShell } from '@/components/agents/consent-card';
import { ErrorRow, NoticeRow, StrengthMeter, authErrorCopy } from '@/components/auth/auth-bits';
import { Button, buttonClass } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

function Reset() {
  const params = useSearchParams();
  const token = params.get('token');
  const linkError = params.get('error');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && confirm !== password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || mismatch) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authClient().resetPassword({ token, newPassword: password });
      if (res.error) throw res.error;
      setDone(true);
    } catch (err) {
      setError(authErrorCopy(err, 'Could not reset your password.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OAuthShell width={440}>
      <h1 className="vx-h2">Choose a new password</h1>
      {done ? (
        <>
          <NoticeRow>Your password is changed and every session is signed out. We emailed you a note about it.</NoticeRow>
          <Link href="/signin" className={buttonClass('primary', 'lg', { block: true, className: 'mt-6' })}>
            Sign in
          </Link>
        </>
      ) : !token || linkError ? (
        <>
          <ErrorRow>This reset link is invalid, already used, or has expired. Links work once, for one hour.</ErrorRow>
          <p className="vx-body mt-6 text-center text-vx-text-3">
            <Link href="/forgot-password" className="font-medium text-vx-text-1 underline-offset-4 hover:underline">
              Ask for a new link
            </Link>
          </p>
        </>
      ) : (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <Input
            size="lg"
            id="password"
            label="New password"
            type="password"
            required
            minLength={PASSWORD_MIN}
            maxLength={PASSWORD_MAX}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            hint={password ? undefined : `At least ${PASSWORD_MIN} characters.`}
          />
          <StrengthMeter password={password} min={PASSWORD_MIN} />
          <Input
            size="lg"
            id="confirm"
            label="Confirm password"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            invalid={mismatch ? "Passwords don't match." : null}
          />
          <Button variant="primary" size="lg" block type="submit" loading={busy} disabled={mismatch}>
            Change password
          </Button>
        </form>
      )}
      {error ? <ErrorRow>{error}</ErrorRow> : null}
    </OAuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <Reset />
    </Suspense>
  );
}

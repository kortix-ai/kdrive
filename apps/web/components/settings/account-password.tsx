'use client';

// Settings > Account > Password: change it (current + new + confirm, other sessions signed out
// by default) when the account has one; otherwise point at "forgot password", which sets one.
import { useState } from 'react';
import Link from 'next/link';
import { PASSWORD_MAX, PASSWORD_MIN } from '@volumes/shared';
import { ErrorRow, NoticeRow, StrengthMeter, authErrorCopy } from '@/components/auth/auth-bits';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

export function AccountPassword({ email, hasPassword, canReset, onChanged }: { email: string; hasPassword: boolean; canReset: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [others, setOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && confirm !== next;

  const reset = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authClient().changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: others });
      if (res.error) throw res.error;
      reset();
      setOpen(false);
      setNotice(passwordChangedNotice(others));
      onChanged();
    } catch (err) {
      setError(authErrorCopy(err, 'Could not change your password.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[14px] font-medium leading-5 text-vx-text-2">Password</span>
        <span className="vx-body text-vx-text-3">{hasPassword ? 'Set' : 'Not set: you sign in with a connected account'}</span>
        <span className="flex-1" />
        {hasPassword && !open ? (
          <Button size="sm" variant="outline" onClick={() => (setOpen(true), setNotice(null), setError(null))}>
            Change password
          </Button>
        ) : null}
        {!hasPassword && canReset ? (
          <Link href={`/forgot-password?email=${encodeURIComponent(email)}`} className="text-[14px] font-medium leading-5 text-vx-text-1 underline decoration-vx-hair-strong underline-offset-[3px] hover:decoration-vx-text-1">
            Set a password by email
          </Link>
        ) : null}
      </div>
      {open ? (
        <form onSubmit={submit} className="flex max-w-[420px] flex-col gap-4" aria-label="Change password">
          <Input id="current-password" label="Current password" type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          <div>
            <Input
              id="new-password"
              label="New password"
              type="password"
              required
              minLength={PASSWORD_MIN}
              maxLength={PASSWORD_MAX}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              hint={next ? undefined : `At least ${PASSWORD_MIN} characters.`}
            />
            <StrengthMeter password={next} min={PASSWORD_MIN} />
          </div>
          <Input
            id="confirm-password"
            label="Confirm new password"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            invalid={mismatch ? "Passwords don't match." : null}
          />
          <label className="flex items-center gap-2 text-[13px] text-vx-text-2">
            <Checkbox checked={others} onChange={setOthers} label="Sign out other sessions" />
            Sign out every other session
          </label>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={busy} disabled={mismatch}>
              Change password
            </Button>
            <Button variant="text" onClick={() => (setOpen(false), reset(), setError(null))} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {notice ? <NoticeRow>{notice}</NoticeRow> : null}
      {error ? <ErrorRow>{error}</ErrorRow> : null}
    </div>
  );
}

/** After a change: "sign out other sessions" also disconnects agent credentials (the server revokes them). */
export function passwordChangedNotice(others: boolean): string {
  return others ? 'Password changed. Every other session is signed out, and agent tokens and connected apps were disconnected.' : 'Password changed.';
}

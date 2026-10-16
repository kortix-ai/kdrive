'use client';

// Settings > Account > Email: the address, whether it is verified (with resend), and the
// change-email form. A change takes two steps (the current inbox approves, the new inbox
// confirms) and needs a verified address: an unproven address never moves to a new one.
import { useState } from 'react';
import type { MeResponse } from '@volumes/shared';
import { ErrorRow, NoticeRow, authErrorCopy } from '@/components/auth/auth-bits';
import { useResendVerification } from '@/components/auth/verify-email';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

export function changeEmailNotice(oldEmail: string, newEmail: string): string {
  return `Approve the change from the link we sent to ${oldEmail}, then confirm it from ${newEmail}. Your email stays the same until both are done.`;
}

/** Why an unverified account has no "Change email" button. */
export const VERIFY_BEFORE_CHANGE = 'Verify this address before changing it. Wrong address? Delete the account and create it again with the right one.';

export function AccountEmail({ me, canMail }: { me: MeResponse; canMail: boolean }) {
  const verified = me.user.emailVerified !== false;
  const resend = useResendVerification(me.user.email);
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = next.trim();
    if (addr.toLowerCase() === me.user.email.toLowerCase()) return setError('That is already your email.');
    setBusy(true);
    setError(null);
    try {
      const res = await authClient().changeEmail({ newEmail: addr, callbackURL: '/verify-email' });
      if (res.error) throw res.error;
      setNotice(changeEmailNotice(me.user.email, addr));
      setOpen(false);
      setNext('');
    } catch (err) {
      setError(authErrorCopy(err, 'Could not start the email change.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[14px] font-medium leading-5 text-vx-text-2">Email</span>
        <span className="vx-body min-w-0 truncate text-vx-text-1">{me.user.email}</span>
        {verified ? <Badge>Verified</Badge> : <Badge tone="dashed">Not verified</Badge>}
        <span className="flex-1" />
        {!verified && canMail ? (
          <Button size="sm" variant="text" onClick={() => void resend.send()} loading={resend.busy} disabled={resend.left > 0}>
            {resend.left > 0 ? `Resend in ${resend.left}s` : 'Resend verification'}
          </Button>
        ) : null}
        {canMail && verified && !open ? (
          <Button size="sm" variant="outline" onClick={() => (setOpen(true), setNotice(null), setError(null))}>
            Change email
          </Button>
        ) : null}
      </div>
      {canMail && !verified ? <p className="vx-meta text-vx-text-3">{VERIFY_BEFORE_CHANGE}</p> : null}
      {resend.sent ? <NoticeRow>Verification email sent to {me.user.email}.</NoticeRow> : null}
      {resend.error ? <ErrorRow>{resend.error}</ErrorRow> : null}
      {open ? (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3" aria-label="Change email">
          <Input
            id="new-email"
            label="New email"
            type="email"
            required
            maxLength={320}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="email"
            className="flex-[1_1_240px]"
          />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={busy}>
              Send link
            </Button>
            <Button variant="text" onClick={() => (setOpen(false), setError(null))} disabled={busy}>
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

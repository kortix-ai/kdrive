'use client';

// Settings > Account: email (verify, change), password (change, or set one by email) and
// sessions ("sign out other sessions"). Connected sign-in accounts live in Profile.
import { useState } from 'react';
import useSWR from 'swr';
import type { MeResponse } from '@volumes/shared';
import { ErrorRow, NoticeRow, authErrorCopy } from '@/components/auth/auth-bits';
import { Button } from '@/components/ui/button';
import { useConfig } from '@/lib/api/hooks';
import { authClient } from '@/lib/auth-client';
import { AccountEmail } from './account-email';
import { AccountPassword } from './account-password';
import { loadAccounts } from './profile-section';
import { Section } from './section';

async function loadSessions(): Promise<number> {
  const res = await authClient().listSessions();
  if (res.error) throw new Error(res.error.message || 'Could not load sessions.');
  return (res.data ?? []).length;
}

/** "1 session (this one)" / "3 sessions: this one and 2 others". */
export function sessionsCopy(n: number): string {
  if (n <= 1) return 'Signed in on this device only.';
  const others = n - 1;
  return `Signed in here and on ${others} other ${others === 1 ? 'session' : 'sessions'}.`;
}

function Sessions() {
  const sessions = useSWR('auth-sessions', loadSessions, { revalidateOnFocus: false, shouldRetryOnError: false });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const out = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await authClient().revokeOtherSessions();
      if (res.error) throw res.error;
      setNotice(SESSIONS_REVOKED_NOTICE);
      await sessions.mutate();
    } catch (e) {
      setError(authErrorCopy(e, 'Could not sign out the other sessions.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[14px] font-medium leading-5 text-vx-text-2">Sessions</span>
        {sessions.data !== undefined ? (
          <span className="vx-body text-vx-text-3">{sessionsCopy(sessions.data)}</span>
        ) : sessions.error ? (
          <span className="vx-body text-vx-danger">Couldn&apos;t load sessions.</span>
        ) : (
          <span className="skeleton skel-line inline-block w-40" />
        )}
        <span className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => void out()} loading={busy} disabled={(sessions.data ?? 0) <= 1}>
          Sign out other sessions
        </Button>
      </div>
      {notice ? <NoticeRow>{notice}</NoticeRow> : null}
      {error ? <ErrorRow>{error}</ErrorRow> : null}
    </div>
  );
}

export function AccountSection({ me }: { me: MeResponse }) {
  const { data: config } = useConfig();
  const accounts = useSWR('auth-accounts', loadAccounts, { revalidateOnFocus: false, shouldRetryOnError: false });
  const sessions = useSWR('auth-sessions', loadSessions, { revalidateOnFocus: false, shouldRetryOnError: false });
  const hasPassword = !!accounts.data?.some((a) => a.providerId === 'credential');
  return (
    <Section id="account" label="Account" description="Your sign-in email, password and the places you are signed in.">
      <div className="flex flex-col gap-5">
        <AccountEmail me={me} canMail={!!config?.emailVerification} />
        <div className="border-t border-vx-hair-soft pt-4">
          {accounts.data ? (
            <AccountPassword
              email={me.user.email}
              hasPassword={hasPassword}
              canReset={!!config?.passwordReset}
              onChanged={() => void sessions.mutate()}
            />
          ) : (
            <span className="skeleton skel-line inline-block w-48" />
          )}
        </div>
        <div className="border-t border-vx-hair-soft pt-4">
          <Sessions />
        </div>
      </div>
    </Section>
  );
}

/** Browser sessions end; agent credentials are separate and are listed under Agents. */
export const SESSIONS_REVOKED_NOTICE =
  'Every other session is signed out. Agent tokens and connected apps keep working: review them under Agents and revoke any you do not recognise.';

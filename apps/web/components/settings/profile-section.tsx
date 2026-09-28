'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { MeResponse } from '@volumes/shared';
import { Badge } from '@/components/share/badge';
import { Button } from '@/components/ui/button';
import { useConfig } from '@/lib/api/hooks';
import { authClient } from '@/lib/auth-client';
import { formatDate } from '@/lib/format';
import { Avatar, Section } from './section';

type Account = { id: string; providerId: string; createdAt: string | Date };

const PROVIDER_LABEL: Record<string, string> = { google: 'Google', github: 'GitHub', credential: 'Password', 'dev-login': 'Dev account', dev: 'Dev account' };

export function providerLabel(id: string): string {
  return PROVIDER_LABEL[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

async function loadAccounts(): Promise<Account[]> {
  const res = await authClient().listAccounts();
  if (res.error) throw new Error(res.error.message || 'Could not load connected accounts.');
  return (res.data ?? []) as Account[];
}

/** PROFILE: avatar, name, email, connected sign-in accounts (+ connect the other enabled providers). */
export function ProfileSection({ me }: { me: MeResponse }) {
  const { data: config } = useConfig();
  const accounts = useSWR('auth-accounts', loadAccounts, { revalidateOnFocus: false, shouldRetryOnError: false });
  const [linking, setLinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = me.user.name || me.user.email;
  const linked = new Set((accounts.data ?? []).map((a) => a.providerId));
  const connectable = (config?.providers ?? []).filter((p) => !linked.has(p));

  const link = async (provider: 'google' | 'github') => {
    setLinking(provider);
    setError(null);
    try {
      const res = await authClient().linkSocial({ provider, callbackURL: `${window.location.origin}/settings` });
      if (res?.error) throw new Error(res.error.message || 'Could not connect the account.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect the account.');
      setLinking(null);
    }
  };

  return (
    <Section id="profile" label="Profile">
      <div className="flex items-center gap-3">
        <Avatar name={name} image={me.user.image} />
        <div className="min-w-0 flex-1">
          <div className="vx-name truncate text-vx-text-1">{me.user.name || 'No name'}</div>
          <div className="vx-meta truncate text-vx-text-3">{me.user.email}</div>
        </div>
        {me.isAdmin ? <Badge tone="accent">Admin</Badge> : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="vx-label mr-1">Signed in with</span>
        {accounts.error ? (
          <span className="text-[12px] text-vx-danger">Couldn&apos;t load connected accounts.</span>
        ) : !accounts.data ? (
          <span className="skeleton skel-line inline-block w-32" />
        ) : accounts.data.length === 0 ? (
          <span className="vx-meta text-vx-text-4">No connected accounts</span>
        ) : (
          accounts.data.map((a) => (
            <Badge key={a.id} title={`Connected ${formatDate(a.createdAt)}`}>
              {providerLabel(a.providerId)}
            </Badge>
          ))
        )}
        {accounts.data
          ? connectable.map((p) => (
              <Button key={p} size="sm" variant="ghost" loading={linking === p} disabled={!!linking} onClick={() => void link(p)}>
                + Connect {providerLabel(p)}
              </Button>
            ))
          : null}
      </div>
      {error ? <p className="mt-2 border-l-2 border-vx-danger pl-2 text-[12px] text-vx-danger">{error}</p> : null}
    </Section>
  );
}

export default ProfileSection;

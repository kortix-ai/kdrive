'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { KeyRound, Plus } from 'lucide-react';
import type { MeResponse } from '@volumes/shared';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfig } from '@/lib/api/hooks';
import { authClient } from '@/lib/auth-client';
import { formatDate } from '@/lib/format';
import { Section, SectionError } from './section';

type Account = { id: string; providerId: string; createdAt: string | Date };

const PROVIDER_LABEL: Record<string, string> = { credential: 'Password', 'dev-login': 'Dev account', dev: 'Dev account' };

/** A sign-in method's label, derived from its configured id (`acme` → `Acme`, `single-sign-on` → `Single sign on`). */
export function providerLabel(id: string): string {
  if (PROVIDER_LABEL[id]) return PROVIDER_LABEL[id];
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function loadAccounts(): Promise<Account[]> {
  const res = await authClient().listAccounts();
  if (res.error) throw new Error(res.error.message || 'Could not load connected accounts.');
  return (res.data ?? []) as Account[];
}

/** Profile: avatar, name, email, connected sign-in accounts (+ connect the other enabled providers). */
export function ProfileSection({ me }: { me: MeResponse }) {
  const { data: config } = useConfig();
  const accounts = useSWR('auth-accounts', loadAccounts, { revalidateOnFocus: false, shouldRetryOnError: false });
  const [linking, setLinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = me.user.name || me.user.email;
  const linked = new Set((accounts.data ?? []).map((a) => a.providerId));
  const connectable = (config?.providers ?? []).filter((p) => !linked.has(p));

  const link = async (provider: NonNullable<typeof config>['providers'][number]) => {
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
      <div className="flex items-center gap-4">
        <Avatar name={name} image={me.user.image} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="vx-title truncate">{me.user.name || 'No name'}</span>
            {me.isAdmin ? <Badge tone="accent">Admin</Badge> : null}
          </div>
          <div className="vx-meta mt-0.5 truncate text-vx-text-3">{me.user.email}</div>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-vx-hair-soft pt-4">
        <span className="mr-1 text-[13px] font-medium leading-5 text-vx-text-2">Signed in with</span>
        {accounts.error ? (
          <span className="text-[13px] text-vx-danger">Couldn&apos;t load connected accounts.</span>
        ) : !accounts.data ? (
          <span className="skeleton skel-line inline-block w-32" />
        ) : accounts.data.length === 0 ? (
          <span className="text-[13px] leading-5 text-vx-text-3">No connected accounts</span>
        ) : (
          accounts.data.map((a) => (
            <Badge key={a.id} title={`Connected ${formatDate(a.createdAt)}`} icon={<KeyRound strokeWidth={2} aria-hidden />}>
              {providerLabel(a.providerId)}
            </Badge>
          ))
        )}
        {accounts.data
          ? connectable.map((p) => (
              <Button key={p} size="sm" variant="text" icon={<Plus size={16} strokeWidth={1.75} aria-hidden />} loading={linking === p} disabled={!!linking} onClick={() => void link(p)}>
                Connect {providerLabel(p)}
              </Button>
            ))
          : null}
      </div>
      {error ? (
        <div className="mt-3">
          <SectionError>{error}</SectionError>
        </div>
      ) : null}
    </Section>
  );
}

export default ProfileSection;

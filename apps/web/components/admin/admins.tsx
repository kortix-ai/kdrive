'use client';

// Admin → Admins: who administers this server, by address. An address can be added before anyone signs
// up with it; admin rights need the address confirmed on the account. The last admin cannot be removed.
import { useState } from 'react';
import useSWR from 'swr';
import { Lock, Plus } from 'lucide-react';
import type { AdminEntry } from '@volumes/shared';
import { formatWhen } from '@/components/preview/names';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/endpoints';
import { isoTitle } from '@/lib/format';
import { useVx } from '@/lib/store';
import { LoadError, Loading } from './parts';
import { ADMINS_KEY, afterAdminChange } from './user-detail';

/** A plausible address (the server has the last word). */
export function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export function Admins({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  const { data, error, mutate } = useSWR(ADMINS_KEY, () => api.admin.admins(), { revalidateOnFocus: false, shouldRetryOnError: false });
  const myEmail = useVx((s) => s.me?.user.email.toLowerCase());
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AdminEntry | null>(null);

  const add = async () => {
    const e = email.trim().toLowerCase();
    if (!looksLikeEmail(e) || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      await api.admin.addAdmin(e);
      setEmail('');
      await mutate();
      await afterAdminChange(e);
      useVx.getState().toast({ kind: 'success', message: `${e} is now an admin.` });
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not add the admin.');
    } finally {
      setAdding(false);
    }
  };

  if (error && !data) return <LoadError what="admins" onRetry={() => void mutate()} />;
  if (!data) return <Loading lines={[70, 60]} />;
  const last = data.admins.length <= 1;
  const fromConfig = data.admins.filter((a) => a.source === 'env').length;

  return (
    <div className="pt-5">
      <form
        className="flex max-w-[560px] items-start gap-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          void add();
        }}
      >
        <Input
          size="sm"
          type="email"
          placeholder="name@example.com"
          aria-label="Email of the new admin"
          value={email}
          onChange={(ev) => {
            setEmail(ev.target.value);
            setAddError(null);
          }}
          invalid={addError}
          className="flex-1"
        />
        <Button type="submit" size="sm" variant="primary" icon={<Plus size={14} strokeWidth={1.75} aria-hidden />} loading={adding} disabled={!looksLikeEmail(email)}>
          Add admin
        </Button>
      </form>
      <p className="vx-micro mt-2 max-w-[560px] text-vx-text-3">
        Admins see every account and the audit log, change quotas, answer storage requests and get those requests by email. Rights start once the
        address is confirmed on its account.
      </p>

      <ul className="mt-6 divide-y divide-vx-hair-soft border-y border-vx-hair-soft" aria-label="Admins">
        {data.admins.map((a) => {
          const you = a.email === myEmail;
          return (
            <li key={a.email} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 pl-1">
              <Avatar name={a.user?.name || a.email} size={28} />
              <div className="min-w-[220px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {a.user ? (
                    <button
                      type="button"
                      onClick={() => onOpenUser(a.user!.id)}
                      className="truncate rounded-vx-xs text-left text-[14px] font-medium leading-5 text-vx-text-1 hover:underline hover:underline-offset-[3px]"
                    >
                      {a.email}
                    </button>
                  ) : (
                    <span className="truncate text-[14px] font-medium leading-5 text-vx-text-1">{a.email}</span>
                  )}
                  {you ? <Badge>You</Badge> : null}
                  {a.source === 'env' ? (
                    <Badge tone="accent" title="Set in VOLUMES_ADMIN_EMAILS on the server. Remove it there.">
                      <Lock size={11} strokeWidth={2} aria-hidden className="mr-1 inline" />
                      From server config
                    </Badge>
                  ) : null}
                  {!a.user ? (
                    <Badge tone="dashed" title="Nobody has signed up with this address yet">
                      No account yet
                    </Badge>
                  ) : !a.user.emailVerified ? (
                    <Badge tone="dashed" title="Admin rights start once this address is confirmed">
                      Unverified
                    </Badge>
                  ) : null}
                </div>
                <div className="vx-meta mt-0.5 text-vx-text-3">
                  {a.source === 'env' ? (
                    'VOLUMES_ADMIN_EMAILS'
                  ) : (
                    <>
                      {a.addedBy ? `added by ${a.addedBy}` : 'first admin'} · <span title={isoTitle(a.createdAt)}>{formatWhen(a.createdAt)}</span>
                    </>
                  )}
                </div>
              </div>
              {a.source === 'env' ? (
                <span className="vx-meta inline-flex items-center gap-1 pr-2 text-vx-text-3" title="Remove it from VOLUMES_ADMIN_EMAILS on the server">
                  <Lock size={12} strokeWidth={1.75} aria-hidden /> Locked
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="danger-text"
                  disabled={last && !fromConfig}
                  title={last && !fromConfig ? 'The last admin cannot be removed. Add another admin first.' : undefined}
                  onClick={() => setRemoving(a)}
                >
                  Remove
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={!!removing}
        danger
        title={removing?.email === myEmail ? 'Remove yourself as admin?' : 'Remove this admin?'}
        body={
          removing?.email === myEmail
            ? 'You lose access to this page right away. Another admin can add you back.'
            : `${removing?.email ?? ''} will no longer see the admin panel or get storage-request emails.`
        }
        confirmLabel="Remove admin"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await api.admin.removeAdmin(removing.email);
          await mutate();
          useVx.getState().toast({ kind: 'success', message: `${removing.email} is no longer an admin.` });
          await afterAdminChange(removing.email);
        }}
      />
    </div>
  );
}

export default Admins;

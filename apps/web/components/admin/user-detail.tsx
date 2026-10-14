'use client';

// Admin → Users → one person: their storage against their quota (with the quota editor), every drive
// they own (size, how many people it is shared with), every drive shared with them (role, owner),
// admin rights, and links into the audit log for them or for one of their drives.
import { useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { ArrowLeft, ScrollText, ShieldCheck, ShieldOff } from 'lucide-react';
import { formatBytes, meterLevel, type MeResponse } from '@volumes/shared';
import { formatWhen } from '@/components/preview/names';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/icon-button';
import { Meter } from '@/components/ui/meter';
import { isApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { isoTitle } from '@/lib/format';
import { useVx } from '@/lib/store';
import { LoadError, Loading } from './parts';
import { QuotaEditor } from './quota-editor';
import { refreshAdminLists } from './users-tab';
import { usagePercent, UserBadges } from './users-table';

export const ADMINS_KEY = 'admin-admins';

/** After an admin change: the admin list, every users view and (when it was you) /api/me. */
export async function afterAdminChange(email: string): Promise<void> {
  void globalMutate(ADMINS_KEY);
  refreshAdminLists();
  const me = useVx.getState().me;
  if (me && me.user.email.toLowerCase() === email.toLowerCase()) {
    const fresh = await globalMutate<MeResponse>('me');
    if (fresh) useVx.getState().setMe(fresh);
  }
}

const th = 'vx-colhead h-9 border-b border-vx-hair px-3 text-left font-medium first:pl-3 last:pr-3';
const td = 'h-11 border-b border-vx-hair-soft px-3 first:pl-3 last:pr-3';

export function UserDetail({
  userId,
  onBack,
  onOpenUser,
  onAudit,
}: {
  userId: string;
  onBack: () => void;
  onOpenUser: (id: string) => void;
  onAudit: (f: { userId?: string; workspaceId?: string }) => void;
}) {
  const { data, error, mutate } = useSWR(['admin-user', userId], () => api.admin.user(userId), { revalidateOnFocus: false, shouldRetryOnError: false });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const myEmail = useVx((s) => s.me?.user.email);

  const back = (
    <Button size="sm" variant="ghost" icon={<ArrowLeft size={14} strokeWidth={1.75} aria-hidden />} onClick={onBack} className="-ml-2 mt-3">
      All users
    </Button>
  );
  if (isApiError(error) && error.status === 404) {
    return (
      <div>
        {back}
        <p className="vx-body mt-4 text-vx-text-3">This account no longer exists.</p>
      </div>
    );
  }
  if (error && !data) return <div>{back}<LoadError what="this user" onRetry={() => void mutate()} /></div>;
  if (!data) return <div>{back}<Loading /></div>;

  const u = data.user;
  const level = meterLevel(u.usedBytes, u.quotaBytes);
  const makeAdmin = async () => {
    setBusy(true);
    try {
      await api.admin.addAdmin(u.email);
      await mutate();
      await afterAdminChange(u.email);
      useVx.getState().toast({
        kind: 'success',
        message: u.emailVerified ? `${u.email} is now an admin.` : `${u.email} is on the admin list. Admin rights start once they confirm their email.`,
      });
    } catch (e) {
      useVx.getState().toast({ kind: 'error', message: e instanceof Error ? e.message : 'Could not add the admin.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {back}
      <div className="mt-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <Avatar name={u.name || u.email} size={40} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="vx-h2 truncate">{u.email}</h2>
              <UserBadges u={u} />
            </div>
            <p className="vx-meta mt-1 text-vx-text-3">
              {u.name ? `${u.name} · ` : ''}
              <span title={isoTitle(u.createdAt)}>joined {formatWhen(u.createdAt)}</span> ·{' '}
              <span title={u.lastSignInAt ? isoTitle(u.lastSignInAt) : undefined}>
                {u.lastSignInAt ? `last sign-in ${formatWhen(u.lastSignInAt)}` : 'never signed in'}
              </span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" icon={<ScrollText size={14} strokeWidth={1.75} aria-hidden />} onClick={() => onAudit({ userId: u.id })}>
            Audit events
          </Button>
          {u.isAdmin || data.isListedAdmin ? (
            <Button size="sm" variant="danger-text" icon={<ShieldOff size={14} strokeWidth={1.75} aria-hidden />} onClick={() => setConfirmRemove(true)}>
              Remove admin
            </Button>
          ) : (
            <Button size="sm" variant="outline" icon={<ShieldCheck size={14} strokeWidth={1.75} aria-hidden />} loading={busy} onClick={() => void makeAdmin()}>
              Make admin
            </Button>
          )}
        </div>
      </div>

      <section aria-label="Storage" className="mt-6 rounded-vx-md border border-vx-hair bg-vx-bg-2 px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="vx-colhead block">Storage</span>
            <span className="mt-1.5 block text-[15px] leading-6 text-vx-text-1">
              <span className={cx('font-semibold tabular-nums', level === 'red' ? 'text-vx-danger' : level === 'amber' ? 'text-vx-warn' : null)}>
                {formatBytes(u.usedBytes)}
              </span>{' '}
              <span className="text-vx-text-3">of {formatBytes(u.quotaBytes)}</span>
              <span className="vx-meta ml-2 text-vx-text-3">{usagePercent(u.usedBytes, u.quotaBytes)}</span>
            </span>
          </div>
          {editing ? null : (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Change quota
            </Button>
          )}
        </div>
        <Meter className="mt-3" value={u.quotaBytes > 0 ? u.usedBytes / u.quotaBytes : 1} level={level} height={6} />
        {editing ? (
          <div className="mt-3">
            <QuotaEditor
              user={u}
              capBytes={data.workspaceCapBytes}
              onDone={(updated, warning) => {
                setEditing(false);
                if (!updated) return;
                void mutate((cur) => (cur ? { ...cur, user: updated } : cur), { revalidate: false });
                refreshAdminLists();
                useVx.getState().toast({ kind: warning ? 'info' : 'success', message: warning ?? `Quota for ${u.email} is now ${formatBytes(updated.quotaBytes)}.` });
              }}
            />
          </div>
        ) : null}
      </section>

      <h3 className="vx-title mt-8">Drives they own</h3>
      <p className="vx-micro mt-1 text-vx-text-3">These count against their quota, whoever writes into them.</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left">
          <thead>
            <tr className="[&>th]:bg-vx-bg-2">
              <th className={th}>Drive</th>
              <th className={cx(th, 'text-right')}>Size</th>
              <th className={cx(th, 'text-right')}>Shared with</th>
              <th className={cx(th, 'text-right')}>Created</th>
              <th className={th} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {data.drives.map((d) => (
              <tr key={d.id} className="transition-colors duration-[120ms] hover:bg-vx-raise">
                <td className={td}>
                  <span className="text-[14px] font-medium leading-5 text-vx-text-1">{d.name}</span>
                  {d.isDefault ? <Badge className="ml-2">Default</Badge> : null}
                </td>
                <td className={cx(td, 'vx-meta-row text-right text-vx-text-2')}>{formatBytes(d.usedBytes)}</td>
                <td className={cx(td, 'vx-meta-row text-right text-vx-text-3')}>
                  {d.memberCount ? `${d.memberCount} ${d.memberCount === 1 ? 'person' : 'people'}` : '—'}
                </td>
                <td className={cx(td, 'vx-meta-row whitespace-nowrap text-right text-vx-text-3')} title={isoTitle(d.createdAt)}>
                  {formatWhen(d.createdAt)}
                </td>
                <td className={cx(td, 'w-10 text-right')}>
                  <IconButton size="sm" label={`Audit events in ${d.name}`} onClick={() => onAudit({ workspaceId: d.id })}>
                    <ScrollText size={14} strokeWidth={1.75} />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.drives.length === 0 ? <p className="vx-body py-4 text-vx-text-3">No drives yet. One is created when they first open KDRIVE.</p> : null}
      </div>

      <h3 className="vx-title mt-8">Shared with them</h3>
      <p className="vx-micro mt-1 text-vx-text-3">Drives other people invited them to. Their size counts against the owner.</p>
      {data.sharedWith.length === 0 ? (
        <p className="vx-body mt-3 text-vx-text-3">Nobody has shared a drive with them.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="[&>th]:bg-vx-bg-2">
                <th className={th}>Drive</th>
                <th className={th}>Owner</th>
                <th className={th}>Role</th>
                <th className={cx(th, 'text-right')}>Size</th>
                <th className={cx(th, 'text-right')}>Joined</th>
              </tr>
            </thead>
            <tbody>
              {data.sharedWith.map((d) => (
                <tr key={d.id} className="transition-colors duration-[120ms] hover:bg-vx-raise">
                  <td className={cx(td, 'text-[14px] font-medium leading-5 text-vx-text-1')}>{d.name}</td>
                  <td className={td}>
                    <button
                      type="button"
                      onClick={() => onOpenUser(d.owner.id)}
                      className="vx-meta-row rounded-vx-xs text-vx-text-2 hover:text-vx-text-1 hover:underline hover:underline-offset-[3px]"
                    >
                      {d.owner.email}
                    </button>
                  </td>
                  <td className={td}>
                    <Badge>{d.role === 'editor' ? 'Editor' : 'Viewer'}</Badge>
                  </td>
                  <td className={cx(td, 'vx-meta-row text-right text-vx-text-2')}>{formatBytes(d.usedBytes)}</td>
                  <td className={cx(td, 'vx-meta-row whitespace-nowrap text-right text-vx-text-3')} title={isoTitle(d.joinedAt)}>
                    {formatWhen(d.joinedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirmRemove}
        danger
        title="Remove admin rights?"
        body={
          myEmail?.toLowerCase() === u.email.toLowerCase()
            ? 'You are removing yourself: you lose access to this page right away.'
            : `${u.email} will no longer see the admin panel or get storage-request emails.`
        }
        confirmLabel="Remove admin"
        onClose={() => setConfirmRemove(false)}
        onConfirm={async () => {
          await api.admin.removeAdmin(u.email);
          await mutate();
          await afterAdminChange(u.email);
          useVx.getState().toast({ kind: 'success', message: `${u.email} is no longer an admin.` });
        }}
      />
    </div>
  );
}

export default UserDetail;

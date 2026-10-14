'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { formatBytes, meterLevel, type AdminUser } from '@volumes/shared';
import { formatWhen } from '@/components/preview/names';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Meter } from '@/components/ui/meter';
import { cx } from '@/components/ui/cx';
import { isoTitle } from '@/lib/format';
import { QuotaEditor } from './quota-editor';
import { SubscriptionBadge } from './storage-requests';

export type UserSortKey = 'email' | 'workspaces' | 'used' | 'quota' | 'lastSignIn' | 'created';

export function sortUsers(users: AdminUser[], key: UserSortKey, dir: 1 | -1): AdminUser[] {
  const v = (u: AdminUser): number | string => {
    switch (key) {
      case 'email':
        return u.email.toLowerCase();
      case 'workspaces':
        return u.workspaceCount;
      case 'used':
        return u.usedBytes;
      case 'quota':
        return u.quotaBytes;
      case 'lastSignIn':
        return u.lastSignInAt ? new Date(u.lastSignInAt).getTime() : 0;
      case 'created':
        return new Date(u.createdAt).getTime();
    }
  };
  return [...users].sort((a, b) => {
    const x = v(a);
    const y = v(b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}

/** 64 px inline usage meter. */
function InlineMeter({ used, quota }: { used: number; quota: number }) {
  const level = meterLevel(used, quota);
  const ratio = quota > 0 ? used / quota : 1;
  return (
    <span className="inline-block w-16 align-middle" title={`${Math.round(Math.min(1, ratio) * 100)}%`}>
      <Meter value={ratio} level={level} height={4} />
    </span>
  );
}

/** Users table: email, workspaces, used, quota (click to edit inline), meter, last sign-in, created. */
export function UsersTable({ users, capBytes, onUpdated }: { users: AdminUser[]; capBytes?: number; onUpdated: (u: AdminUser, warning?: string) => void }) {
  const [sort, setSort] = useState<{ key: UserSortKey; dir: 1 | -1 }>({ key: 'used', dir: -1 });
  const [editing, setEditing] = useState<string | null>(null);
  const rows = useMemo(() => sortUsers(users, sort.key, sort.dir), [users, sort]);

  const head = (k: UserSortKey, label: string, right?: boolean) => {
    const active = sort.key === k;
    return (
      <th key={k} className={cx('h-9 border-b border-vx-hair px-3 font-medium', right && 'text-right')} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button
          type="button"
          onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : k === 'email' ? 1 : -1 }))}
          className={cx(
            'vx-colhead inline-flex items-center gap-1 rounded-vx-xs transition-colors duration-[120ms] hover:!text-vx-text-1',
            active && '!text-vx-text-1',
          )}
        >
          {label}
          {active ? sort.dir === 1 ? <ArrowUp size={12} strokeWidth={2} aria-hidden /> : <ArrowDown size={12} strokeWidth={2} aria-hidden /> : null}
        </button>
      </th>
    );
  };

  return (
    <>
      <PhoneUsers rows={rows} editing={editing} setEditing={setEditing} capBytes={capBytes} onUpdated={onUpdated} />
      <div className="overflow-x-auto max-[720px]:hidden">
        <table className="w-full min-w-[880px] border-separate border-spacing-0 text-left">
          <thead>
            <tr className="[&>th]:bg-vx-bg-2 [&>th:first-child]:pl-3 [&>th:last-child]:pr-3">
              {head('email', 'User')}
              {head('workspaces', 'Drives', true)}
              {head('used', 'Used', true)}
              {head('quota', 'Quota', true)}
              <th className="h-9 border-b border-vx-hair px-3" aria-label="Usage" />
              {head('lastSignIn', 'Last sign-in', true)}
              {head('created', 'Created', true)}
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const level = meterLevel(u.usedBytes, u.quotaBytes);
              return (
                <tr
                  key={u.id}
                  className="align-middle transition-colors duration-[120ms] hover:bg-vx-raise [&>td:first-child]:pl-3 [&>td:last-child]:pr-3 [&>td]:border-b [&>td]:border-vx-hair-soft"
                >
                  <td className="h-12 px-3 py-1.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={u.name || u.email} size={24} />
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-medium leading-5 text-vx-text-1" title={u.email}>
                          {u.email}
                        </div>
                        {u.name ? <div className="truncate text-[12px] leading-4 text-vx-text-3">{u.name}</div> : null}
                      </div>
                      {u.isAdmin ? <Badge tone="accent">Admin</Badge> : null}
                      <SubscriptionBadge s={u.subscription} />
                    </div>
                  </td>
                  <td className="vx-meta-row px-3 text-right text-vx-text-2">{u.workspaceCount}</td>
                  <td className={cx('vx-meta-row px-3 text-right', level === 'red' ? 'font-medium text-vx-danger' : level === 'amber' ? 'font-medium text-vx-warn' : 'text-vx-text-2')}>
                    {formatBytes(u.usedBytes)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {editing === u.id ? (
                      <div className="flex justify-end">
                        <QuotaEditor
                          user={u}
                          capBytes={capBytes}
                          onDone={(updated, warning) => {
                            setEditing(null);
                            if (updated) onUpdated(updated, warning);
                          }}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditing(u.id)}
                        title="Change quota"
                        className="vx-meta-row rounded-vx-sm px-2 py-1 text-vx-text-1 underline decoration-vx-hair-dash decoration-dashed underline-offset-4 transition-colors duration-[120ms] hover:bg-vx-raise hover:decoration-vx-text-3"
                      >
                        {formatBytes(u.quotaBytes)}
                      </button>
                    )}
                  </td>
                  <td className="px-3">
                    <InlineMeter used={u.usedBytes} quota={u.quotaBytes} />
                  </td>
                  <td className="vx-meta-row whitespace-nowrap px-3 text-right text-vx-text-3" title={u.lastSignInAt ? isoTitle(u.lastSignInAt) : undefined}>
                    {u.lastSignInAt ? formatWhen(u.lastSignInAt) : '—'}
                  </td>
                  <td className="vx-meta-row whitespace-nowrap px-3 text-right text-vx-text-3" title={isoTitle(u.createdAt)}>
                    {formatWhen(u.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * Phones: one two-line card per user instead of a table that hides most columns off-screen.
 * Email (+ Admin), then Mono "Used 260 KB of 10 GB · 1 min ago" over a 4 px meter; the quota opens the editor.
 */
function PhoneUsers({
  rows,
  editing,
  setEditing,
  capBytes,
  onUpdated,
}: {
  rows: AdminUser[];
  editing: string | null;
  setEditing: (id: string | null) => void;
  capBytes?: number;
  onUpdated: (u: AdminUser, warning?: string) => void;
}) {
  return (
    <ul className="hidden max-[720px]:block" aria-label="Users">
      {rows.map((u) => {
        const level = meterLevel(u.usedBytes, u.quotaBytes);
        return (
          <li key={u.id} className="flex flex-col gap-1.5 border-b border-vx-hair-soft py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar name={u.name || u.email} size={24} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium leading-5 text-vx-text-1" title={u.email}>
                {u.email}
              </span>
              {u.isAdmin ? <Badge tone="accent">Admin</Badge> : null}
              <SubscriptionBadge s={u.subscription} />
            </div>
            <div className="flex min-w-0 items-center gap-1 pl-[34px] font-mono text-[12px] leading-5 text-vx-text-3">
              <span className={cx('whitespace-nowrap', level === 'red' ? 'text-vx-danger' : level === 'amber' ? 'text-vx-warn' : 'text-vx-text-2')}>
                Used {formatBytes(u.usedBytes)}
              </span>
              <span>of</span>
              {editing === u.id ? null : (
                <button
                  type="button"
                  onClick={() => setEditing(u.id)}
                  title="Change quota"
                  className="whitespace-nowrap rounded-vx-xs text-vx-text-1 underline decoration-vx-hair-dash decoration-dashed underline-offset-4"
                >
                  {formatBytes(u.quotaBytes)}
                </button>
              )}
              <span className="min-w-0 truncate" title={u.lastSignInAt ? isoTitle(u.lastSignInAt) : undefined}>
                · {u.lastSignInAt ? formatWhen(u.lastSignInAt) : 'never signed in'}
              </span>
            </div>
            {editing === u.id ? (
              <div className="pl-[34px]">
                <QuotaEditor
                  user={u}
                  capBytes={capBytes}
                  onDone={(updated, warning) => {
                    setEditing(null);
                    if (updated) onUpdated(updated, warning);
                  }}
                />
              </div>
            ) : null}
            <div className="pl-[34px]">
              <Meter value={u.quotaBytes > 0 ? u.usedBytes / u.quotaBytes : 1} level={level} height={4} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default UsersTable;

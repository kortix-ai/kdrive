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
      <Meter value={ratio} level={level} height={6} />
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
      <th key={k} className={cx('h-10 px-3 font-medium', right && 'text-right')} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button
          type="button"
          onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : k === 'email' ? 1 : -1 }))}
          className={cx(
            'inline-flex items-center gap-1 rounded-vx-xs text-[13px] font-medium leading-5 transition-colors duration-[120ms] hover:text-vx-text-1',
            active ? 'text-vx-text-1' : 'text-vx-text-3',
          )}
        >
          {label}
          {active ? sort.dir === 1 ? <ArrowUp size={16} strokeWidth={1.75} aria-hidden /> : <ArrowDown size={16} strokeWidth={1.75} aria-hidden /> : null}
        </button>
      </th>
    );
  };

  return (
    <div className="-mx-2 overflow-x-auto px-2">
      <table className="w-full min-w-[880px] border-separate border-spacing-0 text-left">
        <thead>
          <tr className="[&>th]:bg-vx-surface-2 [&>th:first-child]:rounded-l-vx-sm [&>th:last-child]:rounded-r-vx-sm">
            {head('email', 'User')}
            {head('workspaces', 'Workspaces', true)}
            {head('used', 'Used', true)}
            {head('quota', 'Quota', true)}
            <th className="h-10 px-3" aria-label="Usage" />
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
                className="align-middle transition-colors duration-[120ms] hover:bg-vx-hover [&>td:first-child]:rounded-l-vx-sm [&>td:last-child]:rounded-r-vx-sm [&>td]:border-b [&>td]:border-vx-hair-soft"
              >
                <td className="h-[52px] px-3 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={u.name || u.email} size={32} ring={false} />
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-medium leading-5 text-vx-text-1" title={u.email}>
                        {u.email}
                      </div>
                      {u.name ? <div className="vx-meta truncate text-vx-text-3">{u.name}</div> : null}
                    </div>
                    {u.isAdmin ? <Badge tone="accent">Admin</Badge> : null}
                  </div>
                </td>
                <td className="vx-meta-row px-3 text-right text-vx-text-2">{u.workspaceCount}</td>
                <td className={cx('vx-meta-row px-3 text-right', level === 'red' ? 'font-semibold text-vx-del-fg' : level === 'amber' ? 'font-semibold text-vx-text-1' : 'text-vx-text-2')}>
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
                      className="vx-meta-row rounded-vx-sm px-2 py-1 text-vx-text-1 underline decoration-vx-hair-strong decoration-dashed underline-offset-4 transition-colors duration-[120ms] hover:bg-vx-surface-3 hover:decoration-vx-text-3"
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
  );
}

export default UsersTable;

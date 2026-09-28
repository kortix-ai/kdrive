'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { formatBytes, meterLevel, type AdminUser } from '@volumes/shared';
import { Avatar } from '@/components/settings/section';
import { Badge } from '@/components/share/badge';
import { cx } from '@/components/ui/cx';
import { formatDate, formatRelative, isoTitle } from '@/lib/format';
import { QuotaEditor } from './quota-editor';

export type UserSortKey = 'email' | 'workspaces' | 'used' | 'quota' | 'lastSignIn' | 'created';

const LEVEL_COLOR = { ok: 'var(--pt-300)', amber: 'var(--vx-past)', red: 'var(--vx-danger)' } as const;

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
  const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 100;
  return (
    <span className="inline-block h-1 w-16 bg-vx-hair align-middle" title={`${Math.round(pct)} %`}>
      <span className="block h-full" style={{ width: `${pct}%`, background: LEVEL_COLOR[level] }} />
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
      <th key={k} className={cx('h-8 px-3 font-medium', right && 'text-right')} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button
          type="button"
          onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : k === 'email' ? 1 : -1 }))}
          className={cx('vx-label inline-flex items-center gap-1 hover:text-vx-text-1', active && 'text-vx-text-1')}
        >
          {label}
          {active ? sort.dir === 1 ? <ArrowUp size={10} /> : <ArrowDown size={10} /> : null}
        </button>
      </th>
    );
  };

  return (
    <div className="overflow-x-auto border border-vx-hair">
      <table className="w-full min-w-[860px] border-collapse text-left">
        <thead className="bg-vx-surface-2">
          <tr className="border-b border-vx-hair">
            {head('email', 'User')}
            {head('workspaces', 'Workspaces', true)}
            {head('used', 'Used', true)}
            {head('quota', 'Quota', true)}
            <th className="h-8 px-3" aria-label="Usage" />
            {head('lastSignIn', 'Last sign-in', true)}
            {head('created', 'Created', true)}
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => {
            const level = meterLevel(u.usedBytes, u.quotaBytes);
            return (
              <tr key={u.id} className="border-b border-vx-hair-soft align-middle last:border-b-0 hover:bg-vx-surface-2">
                <td className="h-9 px-3 py-1.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={u.name || u.email} size={24} />
                    <div className="min-w-0">
                      <div className="vx-name truncate text-vx-text-1" title={u.email}>
                        {u.email}
                      </div>
                      {u.name ? <div className="vx-micro truncate text-vx-text-4">{u.name}</div> : null}
                    </div>
                    {u.isAdmin ? <Badge tone="accent">Admin</Badge> : null}
                  </div>
                </td>
                <td className="vx-meta px-3 text-right text-vx-text-2">{u.workspaceCount}</td>
                <td className="vx-meta px-3 text-right" style={{ color: level === 'ok' ? 'var(--vx-text-2)' : LEVEL_COLOR[level] }}>
                  {formatBytes(u.usedBytes)}
                </td>
                <td className="px-3 py-1.5 text-right">
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
                      className="vx-meta border border-transparent px-1.5 py-0.5 text-vx-text-1 hover:border-vx-hair-strong"
                    >
                      {formatBytes(u.quotaBytes)}
                    </button>
                  )}
                </td>
                <td className="px-3">
                  <InlineMeter used={u.usedBytes} quota={u.quotaBytes} />
                </td>
                <td className="vx-meta px-3 text-right text-vx-text-3" title={u.lastSignInAt ? isoTitle(u.lastSignInAt) : undefined}>
                  {u.lastSignInAt ? formatRelative(u.lastSignInAt) : '—'}
                </td>
                <td className="vx-meta px-3 text-right text-vx-text-3" title={isoTitle(u.createdAt)}>
                  {formatDate(u.createdAt)}
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

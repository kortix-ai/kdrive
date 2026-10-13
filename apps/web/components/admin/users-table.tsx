'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { formatBytes, meterLevel, type AdminUser, type AdminUserSort } from '@volumes/shared';
import { formatWhen } from '@/components/preview/names';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Meter } from '@/components/ui/meter';
import { cx } from '@/components/ui/cx';
import { isoTitle } from '@/lib/format';
import { QuotaEditor } from './quota-editor';
import { SubscriptionBadge } from './storage-requests';

export type UserSortKey = AdminUserSort;
export type UserSort = { key: UserSortKey; dir: 'asc' | 'desc' };

/** Clicking a column: the same column flips, a new one starts descending (email ascending). */
export function nextSort(cur: UserSort, key: UserSortKey): UserSort {
  if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'email' ? 'asc' : 'desc' };
}

/** "42%", "<1%" for a sliver, "0%" for nothing (quota 0 reads as full). */
export function usagePercent(used: number, quota: number): string {
  if (quota <= 0) return '100%';
  const pct = (used / quota) * 100;
  if (used > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

/** 64 px inline usage meter with the percentage beside it. */
export function InlineMeter({ used, quota }: { used: number; quota: number }) {
  const level = meterLevel(used, quota);
  const ratio = quota > 0 ? used / quota : 1;
  return (
    <span className="inline-flex items-center gap-2 align-middle">
      <span className="inline-block w-16">
        <Meter value={ratio} level={level} height={4} />
      </span>
      <span className="vx-meta w-9 text-right tabular-nums text-vx-text-3">{usagePercent(used, quota)}</span>
    </span>
  );
}

/** Email + name with the Admin, plan and unverified badges (shared by the table, the phone list and the detail). */
export function UserBadges({ u }: { u: AdminUser }) {
  return (
    <>
      {u.isAdmin ? <Badge tone="accent">Admin</Badge> : null}
      <SubscriptionBadge s={u.subscription} />
      {u.emailVerified ? null : (
        <Badge tone="dashed" title="This address has not been confirmed">
          Unverified
        </Badge>
      )}
    </>
  );
}

/**
 * Users table: email, own drives, drives shared with them, used, quota (click to edit inline), meter,
 * last sign-in, created. Sorted on the server (`sort` / `onSort`); a row opens the user's detail.
 */
export function UsersTable({
  users,
  sort,
  onSort,
  onOpen,
  capBytes,
  onUpdated,
}: {
  users: AdminUser[];
  sort: UserSort;
  onSort: (s: UserSort) => void;
  onOpen: (u: AdminUser) => void;
  capBytes?: number;
  onUpdated: (u: AdminUser, warning?: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const rows = users;

  const head = (k: UserSortKey, label: string, right?: boolean) => {
    const active = sort.key === k;
    return (
      <th key={k} className={cx('h-9 border-b border-vx-hair px-3 font-medium', right && 'text-right')} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button
          type="button"
          onClick={() => onSort(nextSort(sort, k))}
          className={cx(
            'vx-colhead inline-flex items-center gap-1 rounded-vx-xs transition-colors duration-[120ms] hover:!text-vx-text-1',
            active && '!text-vx-text-1',
          )}
        >
          {label}
          {active ? sort.dir === 'asc' ? <ArrowUp size={12} strokeWidth={2} aria-hidden /> : <ArrowDown size={12} strokeWidth={2} aria-hidden /> : null}
        </button>
      </th>
    );
  };

  return (
    <>
      <PhoneUsers rows={rows} editing={editing} setEditing={setEditing} capBytes={capBytes} onUpdated={onUpdated} onOpen={onOpen} />
      <div className="overflow-x-auto max-[720px]:hidden">
        <table className="w-full min-w-[960px] border-separate border-spacing-0 text-left">
          <thead>
            <tr className="[&>th]:bg-vx-bg-2 [&>th:first-child]:pl-3 [&>th:last-child]:pr-3">
              {head('email', 'User')}
              {head('drives', 'Drives', true)}
              <th className="vx-colhead h-9 border-b border-vx-hair px-3 text-right font-medium" title="Drives other people shared with them">
                Shared
              </th>
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
                  onClick={() => onOpen(u)}
                  className="cursor-pointer align-middle transition-colors duration-[120ms] hover:bg-vx-raise [&>td:first-child]:pl-3 [&>td:last-child]:pr-3 [&>td]:border-b [&>td]:border-vx-hair-soft"
                >
                  <td className="h-12 px-3 py-1.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={u.name || u.email} size={24} />
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpen(u);
                          }}
                          className="block max-w-[260px] truncate rounded-vx-xs text-left text-[14px] font-medium leading-5 text-vx-text-1 hover:underline hover:decoration-vx-hair-strong hover:underline-offset-[3px]"
                          title={`Open ${u.email}`}
                        >
                          {u.email}
                        </button>
                        {u.name ? <div className="truncate text-[12px] leading-4 text-vx-text-3">{u.name}</div> : null}
                      </div>
                      <UserBadges u={u} />
                    </div>
                  </td>
                  <td className="vx-meta-row px-3 text-right text-vx-text-2">{u.workspaceCount}</td>
                  <td className="vx-meta-row px-3 text-right text-vx-text-3">{u.sharedWithCount || '—'}</td>
                  <td className={cx('vx-meta-row px-3 text-right', level === 'red' ? 'font-medium text-vx-danger' : level === 'amber' ? 'font-medium text-vx-warn' : 'text-vx-text-2')}>
                    {formatBytes(u.usedBytes)}
                  </td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
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
  onOpen,
}: {
  rows: AdminUser[];
  editing: string | null;
  setEditing: (id: string | null) => void;
  capBytes?: number;
  onUpdated: (u: AdminUser, warning?: string) => void;
  onOpen: (u: AdminUser) => void;
}) {
  return (
    <ul className="hidden max-[720px]:block" aria-label="Users">
      {rows.map((u) => {
        const level = meterLevel(u.usedBytes, u.quotaBytes);
        return (
          <li key={u.id} className="flex flex-col gap-1.5 border-b border-vx-hair-soft py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar name={u.name || u.email} size={24} />
              <button type="button" onClick={() => onOpen(u)} className="min-w-0 flex-1 truncate text-left text-[15px] font-medium leading-5 text-vx-text-1" title={u.email}>
                {u.email}
              </button>
              <UserBadges u={u} />
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

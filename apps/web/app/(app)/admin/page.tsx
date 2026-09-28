'use client';

// Admin (DESIGN-v2 §6.19): users (usage, inline quota editor) and the audit log. Admins only; a 403 view otherwise.
import { useEffect, useMemo, useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { Search } from 'lucide-react';
import { formatBytes, meterLevel, type AdminUser } from '@volumes/shared';
import { AuditTable } from '@/components/admin/audit-table';
import { UsersTable } from '@/components/admin/users-table';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Tabs } from '@/components/ui/tabs';
import { isApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { useVx } from '@/lib/store';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Forbidden() {
  return (
    <EmptyState
      className="h-full"
      title="Admins only."
      body="This page manages every account on this server. Your account is not on the admin list."
    />
  );
}

function UsersTab({ query }: { query: string }) {
  const { data, error, isLoading, mutate } = useSWR(['admin-users', query], () => api.admin.users({ q: query || undefined }), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    keepPreviousData: true,
  });

  const onUpdated = (u: AdminUser, warning?: string) => {
    void mutate((cur) => (cur ? { ...cur, users: cur.users.map((x) => (x.id === u.id ? u : x)) } : cur), { revalidate: false });
    if (warning) useVx.getState().toast({ kind: 'info', message: warning });
    if (query) void globalMutate(['admin-users', '']);
  };

  if (isApiError(error) && error.status === 403) return <Forbidden />;

  return (
    <div aria-busy={isLoading || undefined}>
      {error && !data ? (
        <div className="flex items-center gap-2 rounded-vx-md bg-vx-surface-2 px-4 py-3">
          <span className="text-[13px] text-vx-del-fg">Couldn&apos;t load users.</span>
          <Button size="sm" variant="text" onClick={() => void mutate()}>
            Retry
          </Button>
        </div>
      ) : !data ? (
        <div className="px-1 py-2">
          {[90, 80, 85, 70].map((w, i) => (
            <span key={i} className="skeleton skel-line" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : data.users.length === 0 ? (
        <EmptyState art={false} title={query ? `No users match “${query}”.` : 'No users yet.'} className="py-10" />
      ) : (
        <UsersTable users={data.users} capBytes={data.workspaceCapBytes} onUpdated={onUpdated} />
      )}
      <p className="vx-meta mt-4 text-vx-text-3">Quotas go up to 50 GB. Usage is each workspace&apos;s current size; history is not counted.</p>
    </div>
  );
}

function Totals() {
  const { data } = useSWR(['admin-users', ''], () => api.admin.users({}), { revalidateOnFocus: false, shouldRetryOnError: false });
  const totals = useMemo(() => {
    if (!data) return null;
    const stored = data.users.reduce((n, u) => n + u.usedBytes, 0);
    const high = data.users.filter((u) => meterLevel(u.usedBytes, u.quotaBytes) !== 'ok').length;
    return { users: data.users.length, stored, high };
  }, [data]);
  if (!totals) return <span className="skeleton skel-line inline-block w-56" />;
  return (
    <span className="vx-meta-row text-vx-text-3">
      {totals.users} {totals.users === 1 ? 'user' : 'users'} · {formatBytes(totals.stored)} stored ·{' '}
      <span className={totals.high ? 'font-semibold text-vx-text-1' : undefined}>{totals.high}</span> over 80%
    </span>
  );
}

export default function AdminPage() {
  const me = useVx((s) => s.me);
  const [tab, setTab] = useState<'users' | 'audit'>('users');
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 250);
  if (!me) return null;
  if (!me.isAdmin) return <Forbidden />;
  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 pb-12 pt-6 max-[720px]:px-4">
      <div className="flex flex-col gap-1">
        <h1 className="vx-h1">Admin</h1>
        <Totals />
      </div>
      <div className="mb-4 mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-vx-hair-soft">
        <Tabs
          className="-mb-px border-b-0"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'users', label: 'Users' },
            { id: 'audit', label: 'Audit' },
          ]}
        />
        {tab === 'users' ? (
          <div className="mb-2 w-full max-w-[320px] max-[720px]:max-w-none">
            <Input
              size="sm"
              leading={<Search size={16} strokeWidth={1.75} />}
              placeholder="Search by email or name"
              aria-label="Search users"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        ) : null}
      </div>
      {tab === 'users' ? <UsersTab query={query} /> : <AuditTable />}
    </div>
  );
}

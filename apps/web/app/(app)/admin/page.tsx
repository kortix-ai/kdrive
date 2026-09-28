'use client';

// Admin (DESIGN.md 6.18): users (usage, inline quota editor) and the audit log. Admins only; a 403 view otherwise.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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
      actions={
        <Link
          href="/drive"
          className="inline-flex h-8 items-center border border-vx-hair px-3 font-mono text-[12px] text-vx-text-2 hover:border-vx-hair-strong hover:text-vx-text-1"
        >
          Go to My Drive
        </Link>
      }
    />
  );
}

function UsersTab() {
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 250);
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
    <div>
      <div className="mb-3 flex items-center gap-3">
        <Input
          leading={<Search size={14} />}
          placeholder="Search by email or name"
          aria-label="Search users"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-[320px]"
        />
        {isLoading && data ? <span className="vx-meta text-vx-text-4">searching…</span> : null}
      </div>
      {error && !data ? (
        <div className="flex items-center gap-2 border border-vx-hair p-4">
          <span className="text-[12px] text-vx-danger">Couldn&apos;t load users.</span>
          <Button size="sm" variant="ghost" onClick={() => void mutate()}>
            Retry
          </Button>
        </div>
      ) : !data ? (
        <div className="border border-vx-hair p-4">
          {[90, 80, 85, 70].map((w, i) => (
            <span key={i} className="skeleton skel-line" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : data.users.length === 0 ? (
        <p className="vx-body border border-vx-hair p-6 text-center text-vx-text-3">{query ? `No users match “${query}”.` : 'No users yet.'}</p>
      ) : (
        <UsersTable users={data.users} capBytes={data.workspaceCapBytes} onUpdated={onUpdated} />
      )}
      <p className="vx-micro mt-3 text-vx-text-4">Quotas go up to 50 GiB. Usage is each workspace&apos;s current size; history is not counted.</p>
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
    <span className="vx-meta text-vx-text-3">
      {totals.users} <span className="vx-unit">users</span> · {formatBytes(totals.stored)} <span className="vx-unit">stored</span> ·{' '}
      <span style={{ color: totals.high ? 'var(--vx-past)' : undefined }}>{totals.high}</span> <span className="vx-unit">over 80 %</span>
    </span>
  );
}

export default function AdminPage() {
  const me = useVx((s) => s.me);
  const [tab, setTab] = useState<'users' | 'audit'>('users');
  if (!me) return null;
  if (!me.isAdmin) return <Forbidden />;
  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-8">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="vx-h1">Admin</h1>
        <Totals />
      </div>
      <Tabs
        className="mb-5 mt-5"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'users', label: 'Users' },
          { id: 'audit', label: 'Audit' },
        ]}
      />
      {tab === 'users' ? <UsersTab /> : <AuditTable />}
    </div>
  );
}

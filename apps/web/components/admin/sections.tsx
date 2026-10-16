'use client';

// The admin console's sections that wrap the existing panels: each is one route under /admin with
// its own page head. Moving between users, their detail and the audit log is plain navigation.
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { Segmented } from '@/components/ui/segmented';
import { Tabs } from '@/components/ui/tabs';
import { Admins } from './admins';
import { auditFilterSearch, auditHref } from './admin-route';
import { useAuditFilterRoute } from './use-audit-filter';
import { AuditTable } from './audit-table';
import { Billing } from './billing';
import { Domains } from './domains';
import { ServerLog } from './server-log';
import { StorageRequests, useOpenStorageRequests } from './storage-requests';
import { UserDetail } from './user-detail';
import { UsersTab } from './users-tab';

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const userHref = (id: string) => `/admin/users/${encodeURIComponent(id)}`;

/** The search field the list sections share. */
export function SearchField({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder: string }) {
  return (
    <div className="w-full max-w-[280px] max-[720px]:max-w-none">
      <Input size="sm" leading={<Search size={16} strokeWidth={1.75} />} placeholder={placeholder} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function UsersSection() {
  const router = useRouter();
  const params = useSearchParams();
  const view = params?.get('view') === 'domains' ? 'domains' : 'all';
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 250);
  return (
    <Page>
      <PageHeader eyebrow="Admin" title="Users" lead="Everyone with an account: storage, quotas, drives and admin rights." />
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented<'all' | 'domains'>
          size="sm"
          label="View"
          value={view}
          onChange={(v) => router.replace(v === 'domains' ? '/admin/users?view=domains' : '/admin/users')}
          options={[
            { value: 'all', label: 'All users' },
            { value: 'domains', label: 'By domain' },
          ]}
        />
        {view === 'all' ? <SearchField value={q} onChange={setQ} label="Search users" placeholder="Search by email or name" /> : null}
      </div>
      <div className="mt-3">
        {view === 'domains' ? (
          <Domains onOpenUser={(id) => router.push(userHref(id))} />
        ) : (
          <UsersTab query={query} onOpen={(u) => router.push(userHref(u.id))} />
        )}
      </div>
    </Page>
  );
}

export function UserSection({ userId }: { userId: string }) {
  const router = useRouter();
  return (
    <Page>
      <p className="vx-eyebrow">Admin · Users</p>
      <UserDetail
        userId={userId}
        onBack={() => router.push('/admin/users')}
        onOpenUser={(id) => router.push(userHref(id))}
        onAudit={(f) => router.push(auditHref(f))}
      />
    </Page>
  );
}

export function RequestsSection() {
  const { data } = useOpenStorageRequests();
  const n = data?.requests.length ?? 0;
  return (
    <Page>
      <PageHeader eyebrow="Admin" title="Storage requests" lead={n ? `${n} waiting for an answer. Grant one to raise that person's quota.` : 'People asking for more storage.'} />
      <StorageRequests />
    </Page>
  );
}

export function BillingSection() {
  return (
    <Page>
      <PageHeader eyebrow="Admin" title="Billing" lead="Paid plans through Stripe: one key and the plan prices; KDRIVE sets up the rest." />
      <Billing />
    </Page>
  );
}

export function AdminsSection() {
  const router = useRouter();
  return (
    <Page>
      <PageHeader
        eyebrow="Admin"
        title="Admins"
        lead="Admins from the server config (VOLUMES_ADMIN_EMAILS) are locked here. The ones added below can be removed."
      />
      <Admins onOpenUser={(id) => router.push(userHref(id))} />
    </Page>
  );
}

type LogView = 'audit' | 'server';

export function LogsSection() {
  const params = useSearchParams();
  const [view, setView] = useState<LogView>(params?.get('view') === 'server' ? 'server' : 'audit');
  const [filter, setFilter] = useAuditFilterRoute();
  const switchTo = (v: LogView) => {
    setView(v);
    const url = v === 'server' ? '/admin/logs?view=server' : `/admin/logs${auditFilterSearch(filter)}`;
    window.history.replaceState(window.history.state, '', url);
  };
  return (
    <Page>
      <PageHeader eyebrow="Admin" title="Logs" lead="Every account's events, and the server's own recent warnings and errors." />
      <Tabs<LogView>
        className="mt-5"
        value={view}
        onChange={switchTo}
        items={[
          { id: 'audit', label: 'Audit log' },
          { id: 'server', label: 'Server log' },
        ]}
      />
      {view === 'audit' ? <AuditTable filter={filter} onFilter={setFilter} /> : <ServerLog />}
    </Page>
  );
}

'use client';

// Admin (UNIFY-SPEC §14.4): the server's control room, admins only (a 403 view otherwise).
//  - Overview: totals, storage across every drive against all quotas, recent sign-ups, top users
//  - Users: searchable, sortable, paged; a row opens the user (drives, shared drives, quota, admin rights)
//  - Domains: usage grouped by the domain of each address
//  - Requests: storage requests (grant or dismiss)
//  - Billing: Stripe (one key and the plan prices; KDRIVE sets up the webhook and Stripe Prices)
//  - Audit: every user's events with filters and CSV export
//  - Admins: who administers the server
// The tab, the open user and the audit filters live in the URL (`?tab=requests` is the request email's link).
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { AdminUser } from '@volumes/shared';
import { Admins } from '@/components/admin/admins';
import { EMPTY_AUDIT, useAdminRoute, type AdminRoute, type AdminTab } from '@/components/admin/admin-route';
import { AuditTable } from '@/components/admin/audit-table';
import { Billing } from '@/components/admin/billing';
import { Domains } from '@/components/admin/domains';
import { Overview } from '@/components/admin/overview';
import { StorageRequests, useOpenStorageRequests } from '@/components/admin/storage-requests';
import { UserDetail } from '@/components/admin/user-detail';
import { UsersTab } from '@/components/admin/users-tab';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { Tabs } from '@/components/ui/tabs';
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
      art="admins"
      title="Admins only."
      body="This page manages every account on this server. Your account is not on the admin list."
    />
  );
}

export default function AdminPage() {
  const me = useVx((s) => s.me);
  const [route, go] = useAdminRoute();
  const { data: open } = useOpenStorageRequests(!!me?.isAdmin);
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 250);
  if (!me) return null;
  if (!me.isAdmin) return <Forbidden />;

  const tab = (t: AdminTab) => go({ ...route, tab: t, user: null });
  const openUser = (id: string) => go({ ...route, tab: 'users', user: id });
  const toAudit = (f: Partial<AdminRoute['audit']>) => go({ ...route, tab: 'audit', user: null, audit: { ...EMPTY_AUDIT, ...f } });

  return (
    <Page>
      <PageHeader eyebrow="Server" title="Admin" lead="Everyone on this server: storage, requests, billing, the audit log and who administers it." />
      <div className="mt-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-vx-hair">
        <Tabs
          className="-mb-px overflow-x-auto border-b-0"
          value={route.tab}
          onChange={tab}
          items={[
            { id: 'overview', label: 'Overview' },
            { id: 'users', label: 'Users' },
            { id: 'domains', label: 'Domains' },
            { id: 'requests', label: 'Requests', count: open?.requests.length || undefined },
            { id: 'billing', label: 'Billing' },
            { id: 'audit', label: 'Audit' },
            { id: 'admins', label: 'Admins' },
          ]}
        />
        {route.tab === 'users' && !route.user ? (
          <div className="mb-1.5 w-full max-w-[280px] max-[720px]:max-w-none">
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
      {route.tab === 'overview' ? (
        <Overview onOpenUser={(u: AdminUser) => openUser(u.id)} onTab={tab} />
      ) : route.tab === 'users' ? (
        route.user ? (
          <UserDetail
            userId={route.user}
            onBack={() => go({ ...route, user: null })}
            onOpenUser={openUser}
            onAudit={(f) => toAudit(f)}
          />
        ) : (
          <UsersTab query={query} onOpen={(u) => openUser(u.id)} />
        )
      ) : route.tab === 'domains' ? (
        <Domains onOpenUser={openUser} />
      ) : route.tab === 'requests' ? (
        <StorageRequests />
      ) : route.tab === 'billing' ? (
        <Billing />
      ) : route.tab === 'audit' ? (
        <AuditTable filter={route.audit} onFilter={(audit) => go({ ...route, audit }, 'replace')} />
      ) : (
        <Admins onOpenUser={openUser} />
      )}
    </Page>
  );
}

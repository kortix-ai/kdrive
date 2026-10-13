'use client';

// Admin → Users: everyone on the server, searched, sorted and paged on the server (usage sorts need
// every drive's size, which only the API has). A row opens the user's detail.
import { useEffect, useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { formatBytes, MAX_QUOTA_BYTES, type AdminUser } from '@volumes/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { api } from '@/lib/api/endpoints';
import { useVx } from '@/lib/store';
import { LoadError, Loading, Pager } from './parts';
import { UsersTable, type UserSort } from './users-table';

export const USERS_PAGE = 50;

/** Every cached users page and overview (after a quota or admin change). */
export function refreshAdminLists(): void {
  void globalMutate((k) => Array.isArray(k) && (k[0] === 'admin-users' || k[0] === 'admin-overview' || k[0] === 'admin-user'));
}

export function UsersTab({ query, onOpen }: { query: string; onOpen: (u: AdminUser) => void }) {
  const [sort, setSort] = useState<UserSort>({ key: 'used', dir: 'desc' });
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [query, sort]);
  const { data, error, isLoading, mutate } = useSWR(
    ['admin-users', query, sort.key, sort.dir, page],
    () => api.admin.users({ q: query || undefined, sort: sort.key, dir: sort.dir, page, limit: USERS_PAGE }),
    { revalidateOnFocus: false, shouldRetryOnError: false, keepPreviousData: true },
  );

  const onUpdated = (u: AdminUser, warning?: string) => {
    void mutate((cur) => (cur ? { ...cur, users: cur.users.map((x) => (x.id === u.id ? u : x)) } : cur), { revalidate: false });
    if (warning) useVx.getState().toast({ kind: 'info', message: warning });
    refreshAdminLists();
  };

  return (
    <div aria-busy={isLoading || undefined}>
      {error && !data ? (
        <LoadError what="users" onRetry={() => void mutate()} />
      ) : !data ? (
        <Loading />
      ) : data.users.length === 0 ? (
        <EmptyState art={false} title={query ? `No users match “${query}”.` : 'No users yet.'} className="py-10" />
      ) : (
        <>
          <UsersTable users={data.users} sort={sort} onSort={setSort} onOpen={onOpen} capBytes={data.workspaceCapBytes} onUpdated={onUpdated} />
          <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
        </>
      )}
      <p className="vx-micro mt-4 text-vx-text-3">
        Quotas go up to {formatBytes(MAX_QUOTA_BYTES)}. Used is the current size of the drives each person owns; history and drives shared with them
        are not counted.
      </p>
    </div>
  );
}

export default UsersTab;

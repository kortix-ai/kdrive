'use client';

// Admin → Drives: every live drive on the server with its owner, how many people it is shared
// with, its files and size (read from storage for the page shown) and when it was made. Searched
// by drive name or owner, sorted and paged on the server. The owner opens their detail; the
// scroll icon opens the drive's audit events.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { ArrowDown, ArrowUp, ScrollText } from 'lucide-react';
import { formatBytes } from '@volumes/shared';
import { formatWhen } from '@/components/preview/names';
import { Badge } from '@/components/ui/badge';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Page, PageHeader } from '@/components/ui/page';
import { api } from '@/lib/api/endpoints';
import { isoTitle } from '@/lib/format';
import { auditHref } from './admin-route';
import { LoadError, Loading, Pager } from './parts';
import { SearchField, useDebounced } from './sections';

export const DRIVES_PAGE = 50;

type DriveSort = { key: 'created' | 'name'; dir: 'asc' | 'desc' };

/** A new column starts newest-first (names A→Z); the same column flips. */
export function nextDriveSort(cur: DriveSort, key: DriveSort['key']): DriveSort {
  if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'name' ? 'asc' : 'desc' };
}

const th = 'vx-colhead h-9 border-b border-vx-hair px-3 text-left font-medium';
const td = 'h-11 border-b border-vx-hair-soft px-3';

export function Drives() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 250);
  const [sort, setSort] = useState<DriveSort>({ key: 'created', dir: 'desc' });
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [query, sort]);
  const { data, error, isLoading, mutate } = useSWR(
    ['admin-drives', query, sort.key, sort.dir, page],
    () => api.admin.drives({ q: query || undefined, sort: sort.key, dir: sort.dir, page, limit: DRIVES_PAGE }),
    { revalidateOnFocus: false, shouldRetryOnError: false, keepPreviousData: true },
  );

  const sortHead = (key: DriveSort['key'], label: string, className?: string) => {
    const on = sort.key === key;
    const Arrow = sort.dir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <th className={cx('h-9 border-b border-vx-hair px-3 font-medium', className)} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button
          type="button"
          onClick={() => setSort(nextDriveSort(sort, key))}
          className={cx('vx-colhead inline-flex items-center gap-1 rounded-vx-xs transition-colors duration-[120ms] hover:!text-vx-text-1', on && '!text-vx-text-1')}
        >
          {label}
          {on ? <Arrow size={12} strokeWidth={2} aria-hidden /> : null}
        </button>
      </th>
    );
  };

  return (
    <Page>
      <PageHeader eyebrow="Admin" title="Drives" lead="Every drive on this server, who owns it and how much it holds." />
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <SearchField value={q} onChange={setQ} label="Search drives" placeholder="Search by drive or owner" />
        {data ? (
          <span className="vx-meta text-vx-text-3">
            {data.total} {data.total === 1 ? 'drive' : 'drives'}
          </span>
        ) : null}
      </div>
      <div className="mt-3" aria-busy={isLoading || undefined}>
        {error && !data ? (
          <LoadError what="drives" onRetry={() => void mutate()} />
        ) : !data ? (
          <Loading />
        ) : data.drives.length === 0 ? (
          <EmptyState art={false} title={query ? `No drives match “${query}”.` : 'No drives yet.'} className="py-10" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr className="[&>th]:bg-vx-bg-2">
                    {sortHead('name', 'Drive')}
                    <th className={th}>Owner</th>
                    <th className={cx(th, 'text-right')}>Shared with</th>
                    <th className={cx(th, 'text-right')}>Files</th>
                    <th className={cx(th, 'text-right')}>Size</th>
                    {sortHead('created', 'Created', 'text-right')}
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
                      <td className={td}>
                        <button
                          type="button"
                          onClick={() => router.push(`/admin/users/${encodeURIComponent(d.owner.id)}`)}
                          className="vx-meta-row max-w-[260px] truncate rounded-vx-xs text-left text-vx-text-2 hover:text-vx-text-1 hover:underline hover:underline-offset-[3px]"
                          title={d.owner.name ?? undefined}
                        >
                          {d.owner.email}
                        </button>
                      </td>
                      <td className={cx(td, 'vx-meta-row text-right text-vx-text-3')}>
                        {d.memberCount ? `${d.memberCount} ${d.memberCount === 1 ? 'person' : 'people'}` : '—'}
                      </td>
                      <td className={cx(td, 'vx-meta-row text-right text-vx-text-2')}>{d.fileCount === null ? '—' : d.fileCount.toLocaleString('en')}</td>
                      <td className={cx(td, 'vx-meta-row text-right text-vx-text-2')}>{formatBytes(d.usedBytes)}</td>
                      <td className={cx(td, 'vx-meta-row whitespace-nowrap text-right text-vx-text-3')} title={isoTitle(d.createdAt)}>
                        {formatWhen(d.createdAt)}
                      </td>
                      <td className={cx(td, 'w-10 text-right')}>
                        <IconButton size="sm" label={`Audit events in ${d.name}`} onClick={() => router.push(auditHref({ workspaceId: d.id }))}>
                          <ScrollText size={14} strokeWidth={1.75} />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </div>
    </Page>
  );
}

export default Drives;

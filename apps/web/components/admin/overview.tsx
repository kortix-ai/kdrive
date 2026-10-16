'use client';

// Admin → Overview: the server at a glance. People, drives (and how many are shared), storage used
// across every drive against all the quota handed out, open storage requests, recent sign-ups and
// the five people storing the most.
import useSWR from 'swr';
import { formatBytes, meterLevel, type AdminUser } from '@volumes/shared';
import { formatWhen } from '@/components/preview/names';
import { Avatar } from '@/components/ui/avatar';
import { Meter } from '@/components/ui/meter';
import { api } from '@/lib/api/endpoints';
import { isoTitle } from '@/lib/format';
import { LoadError, Loading, StatTile } from './parts';
import { InlineMeter, usagePercent, UserBadges } from './users-table';

export function Overview({ onOpenUser, onTab }: { onOpenUser: (u: AdminUser) => void; onTab: (t: 'users' | 'requests' | 'domains') => void }) {
  const { data, error, mutate } = useSWR(['admin-overview'], () => api.admin.overview(), { revalidateOnFocus: false, shouldRetryOnError: false });
  if (error && !data) return <LoadError what="the overview" onRetry={() => void mutate()} />;
  if (!data) return <Loading />;

  const level = meterLevel(data.usedBytes, data.quotaBytes);
  return (
    <div className="pt-5">
      <div className="grid grid-cols-4 gap-px overflow-hidden rounded-vx-md border border-vx-hair bg-vx-hair max-[900px]:grid-cols-2">
        <StatTile label="Users" value={data.users} sub="everyone with an account" onClick={() => onTab('users')} />
        <StatTile label="Drives" value={data.drives} sub={`${data.sharedDrives} shared with other people`} />
        <StatTile label="Open requests" value={data.openRequests} sub={data.openRequests ? 'waiting for an answer' : 'nothing waiting'} onClick={() => onTab('requests')} />
        <StatTile label="Sign-ups" value={data.signups7d} sub={`last 7 days · ${data.signups30d} in 30 days`} />
        <StatTile
          className="col-span-4 max-[900px]:col-span-2"
          label="Storage used"
          value={
            <>
              {formatBytes(data.usedBytes)} <span className="text-[15px] font-normal tracking-normal text-vx-text-3">of {formatBytes(data.quotaBytes)} granted</span>
            </>
          }
          sub={`${usagePercent(data.usedBytes, data.quotaBytes)} of all quotas · the current size of every live drive`}
          onClick={() => onTab('domains')}
        >
          <Meter className="mt-3" value={data.quotaBytes > 0 ? data.usedBytes / data.quotaBytes : 0} level={level} height={6} />
        </StatTile>
      </div>

      <div className="mt-8 flex items-baseline justify-between gap-4">
        <h2 className="vx-title">Top users by storage</h2>
        <span className="vx-meta text-vx-text-3" title={isoTitle(data.usageAt)}>
          sizes read {formatWhen(data.usageAt)}
        </span>
      </div>
      {data.topUsers.length === 0 ? (
        <p className="vx-body mt-3 text-vx-text-3">No users yet.</p>
      ) : (
        <ol className="mt-3 divide-y divide-vx-hair-soft border-y border-vx-hair-soft">
          {data.topUsers.map((u, i) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => onOpenUser(u)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-[120ms] hover:bg-vx-raise"
              >
                <span className="vx-meta w-4 text-vx-text-3">{i + 1}</span>
                <Avatar name={u.name || u.email} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[14px] font-medium leading-5 text-vx-text-1">{u.email}</span>
                    <UserBadges u={u} />
                  </span>
                  <span className="vx-meta block text-vx-text-3">
                    {u.workspaceCount} {u.workspaceCount === 1 ? 'drive' : 'drives'}
                  </span>
                </span>
                <span className="vx-meta-row whitespace-nowrap text-vx-text-2">
                  {formatBytes(u.usedBytes)} <span className="text-vx-text-3 max-[720px]:hidden">of {formatBytes(u.quotaBytes)}</span>
                </span>
                <span className="max-[720px]:hidden">
                  <InlineMeter used={u.usedBytes} quota={u.quotaBytes} />
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default Overview;

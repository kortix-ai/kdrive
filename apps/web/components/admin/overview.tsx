'use client';

// Admin → Overview: the server at a glance. People, drives (and how many are shared), storage used
// across every drive against all the quota handed out, sign-ups (and a 30-day chart), open storage
// requests, active subscriptions when billing is on, and the five people storing the most.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { formatBytes, meterLevel } from '@volumes/shared';
import { formatWhen } from '@/components/preview/names';
import { Avatar } from '@/components/ui/avatar';
import { Meter } from '@/components/ui/meter';
import { Page, PageHeader } from '@/components/ui/page';
import { api } from '@/lib/api/endpoints';
import { isoTitle } from '@/lib/format';
import { LoadError, Loading, StatTile } from './parts';
import { InlineMeter, usagePercent, UserBadges } from './users-table';

/** "15 Oct" for a YYYY-MM-DD day. */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** A round top for the y axis (at least 1): 0→1, 3→3, 7→8, 13→15, 42→50. */
export function niceMax(n: number): number {
  if (n <= 5) return Math.max(1, n);
  const step = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * step >= n) return m * step;
  return 10 * step;
}

/** Sign-ups per day: one bar per day (rounded top on the baseline grid), hover for the count. */
export function SignupChart({ days }: { days: { date: string; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!days.length) return null;
  const W = 600;
  const H = 140;
  const max = niceMax(Math.max(...days.map((d) => d.count)));
  const slot = W / days.length;
  const bar = Math.max(2, slot - 2); // 2 px gap between bars
  const total = days.reduce((a, d) => a + d.count, 0);
  const shown = hover === null ? null : days[hover];
  return (
    <figure className="rounded-vx-md border border-vx-hair bg-vx-bg-2 px-4 pb-3 pt-3.5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="vx-colhead">Sign-ups per day · last 30 days</span>
        <span className="vx-meta text-vx-text-2" aria-live="polite">
          {shown ? `${dayLabel(shown.date)}: ${shown.count} ${shown.count === 1 ? 'sign-up' : 'sign-ups'}` : `${total} in total`}
        </span>
      </figcaption>
      <div className="relative mt-3 pl-7">
        <span className="vx-micro absolute left-0 top-0 text-vx-text-4 tabular-nums">{max}</span>
        <span className="vx-micro absolute bottom-0 left-0 text-vx-text-4 tabular-nums">0</span>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[140px] w-full" role="img" aria-label={`Sign-ups per day, ${total} in the last 30 days`} onMouseLeave={() => setHover(null)}>
          <line x1={0} x2={W} y1={0.5} y2={0.5} className="stroke-vx-hair-soft" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="stroke-vx-hair-soft" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} className="stroke-vx-hair" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {days.map((d, i) => {
            const h = d.count ? Math.max(3, (d.count / max) * (H - 2)) : 0;
            const x = i * slot + (slot - bar) / 2;
            const r = Math.min(4, bar / 2, h);
            return (
              <g key={d.date} onMouseEnter={() => setHover(i)}>
                {/* The hit target is the whole column, bigger than the bar. */}
                <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
                {h > 0 ? (
                  <path
                    d={`M${x},${H} V${H - h + r} Q${x},${H - h} ${x + r},${H - h} H${x + bar - r} Q${x + bar},${H - h} ${x + bar},${H - h + r} V${H} Z`}
                    className={hover === null || hover === i ? 'fill-vx-accent' : 'fill-vx-accent opacity-50'}
                  >
                    <title>{`${dayLabel(d.date)}: ${d.count}`}</title>
                  </path>
                ) : null}
              </g>
            );
          })}
        </svg>
        <div className="vx-micro mt-1.5 flex justify-between text-vx-text-4" aria-hidden>
          <span>{dayLabel(days[0].date)}</span>
          <span>{dayLabel(days[Math.floor(days.length / 2)].date)}</span>
          <span>{dayLabel(days[days.length - 1].date)}</span>
        </div>
      </div>
      <table className="sr-only">
        <caption>Sign-ups per day</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <th scope="row">{d.date}</th>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function Overview() {
  const router = useRouter();
  const { data, error, mutate } = useSWR(['admin-overview'], () => api.admin.overview(), { revalidateOnFocus: false, shouldRetryOnError: false });
  const header = <PageHeader eyebrow="Admin" title="Overview" lead="Everyone on this server at a glance." />;
  if (error && !data) return <Page>{header}<LoadError what="the overview" onRetry={() => void mutate()} /></Page>;
  if (!data) return <Page>{header}<Loading /></Page>;

  const level = meterLevel(data.usedBytes, data.quotaBytes);
  const billing = data.activeSubscriptions !== null;
  return (
    <Page>
      {header}
      <div className="mt-6 grid grid-cols-4 gap-px overflow-hidden rounded-vx-md border border-vx-hair bg-vx-hair max-[900px]:grid-cols-2">
        <StatTile label="Users" value={data.users} sub="everyone with an account" onClick={() => router.push('/admin/users')} />
        <StatTile label="Drives" value={data.drives} sub={`${data.sharedDrives} shared with other people`} onClick={() => router.push('/admin/drives')} />
        <StatTile
          label="Sign-ups"
          value={data.signups7d}
          sub={`last 7 days · ${data.signups30d} in 30 days`}
          onClick={() => router.push('/admin/logs?kind=auth.sign_up')}
        />
        <StatTile
          label="Open requests"
          value={data.openRequests}
          sub={data.openRequests ? 'waiting for an answer' : 'nothing waiting'}
          onClick={() => router.push('/admin/requests')}
        />
        <StatTile
          className={billing ? 'col-span-3 max-[900px]:col-span-2' : 'col-span-4 max-[900px]:col-span-2'}
          label="Storage used"
          value={
            <>
              {formatBytes(data.usedBytes)} <span className="text-[15px] font-normal tracking-normal text-vx-text-3">of {formatBytes(data.quotaBytes)} allocated</span>
            </>
          }
          sub={`${usagePercent(data.usedBytes, data.quotaBytes)} of all quotas · the current size of every live drive`}
          onClick={() => router.push('/admin/users?view=domains')}
        >
          <Meter className="mt-3" value={data.quotaBytes > 0 ? data.usedBytes / data.quotaBytes : 0} level={level} height={6} />
        </StatTile>
        {billing ? (
          <StatTile
            className="max-[900px]:col-span-2"
            label="Subscriptions"
            value={data.activeSubscriptions ?? 0}
            sub="active, trialing or past due"
            onClick={() => router.push('/admin/billing')}
          />
        ) : null}
      </div>

      <div className="mt-6">
        <SignupChart days={data.signupsByDay} />
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
                onClick={() => router.push(`/admin/users/${encodeURIComponent(u.id)}`)}
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
    </Page>
  );
}

export default Overview;

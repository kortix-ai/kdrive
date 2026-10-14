'use client';

import Link from 'next/link';
import { ArrowRight, ChevronRight, PieChart } from 'lucide-react';
import { RETENTION_COPY, formatBytes, meterLevel, type UsageResponse } from '@volumes/shared';
import { buttonClass } from '@/components/ui/button';
import { useUsage } from '@/lib/api/hooks';
import { useVx } from '@/lib/store';
import { cx } from '@/components/ui/cx';
import { Meter } from '@/components/ui/meter';
import { Section, SectionError } from './section';

export function percent(used: number, quota: number): number {
  if (quota <= 0) return used > 0 ? 100 : 0;
  return Math.round((used / quota) * 1000) / 10;
}

/** Opens Settings → Storage: by kind of file, largest files, history, and who is using shared drives. */
function DetailsLink() {
  return (
    <Link href="/settings/storage" className={buttonClass('outline', 'md', { withIcon: true })}>
      <PieChart size={16} strokeWidth={1.75} aria-hidden />
      Details
      <ChevronRight size={14} strokeWidth={1.75} aria-hidden className="-mr-1 text-vx-text-3" />
    </Link>
  );
}

/** Storage: a 6 px meter, used of quota, per-workspace bars, retention and history notes, and a link to the details. */
export function StorageSection({ fallback }: { fallback?: UsageResponse }) {
  useVx((s) => s.refreshKey);
  const current = useVx((s) => s.workspaceId);
  const { data: live, error } = useUsage();
  const data = live ?? fallback;
  if (!data) {
    return (
      <Section id="storage" label="Storage" aside={<DetailsLink />}>
        {error ? <SectionError>Couldn&apos;t load storage usage.</SectionError> : <span className="skeleton block h-16 w-full" />}
      </Section>
    );
  }
  const level = meterLevel(data.usedBytes, data.quotaBytes);
  const pct = percent(data.usedBytes, data.quotaBytes);
  const over = data.usedBytes - data.quotaBytes;
  return (
    <Section id="storage" label="Storage" description={RETENTION_COPY} aside={<DetailsLink />}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="vx-meta-row text-vx-text-3">
          <span className="font-medium text-vx-text-1">{formatBytes(data.usedBytes)}</span> of {formatBytes(data.quotaBytes)} used
        </span>
        <span className={cx('vx-meta', level === 'red' ? 'font-medium text-vx-danger' : level === 'amber' ? 'text-vx-warn' : 'text-vx-text-3')}>{pct}%</span>
      </div>
      <div role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={data.quotaBytes} aria-valuenow={data.usedBytes} className="mt-2">
        <Meter value={data.quotaBytes > 0 ? data.usedBytes / data.quotaBytes : 1} level={level} height={6} />
      </div>
      {over > 0 ? (
        <div className="mt-3">
          <SectionError>Over your quota by {formatBytes(over)}. New uploads are refused until you free some space.</SectionError>
        </div>
      ) : level !== 'ok' ? (
        <p className="vx-meta mt-2 text-vx-text-2">{formatBytes(data.quotaBytes - data.usedBytes)} left</p>
      ) : null}

      {data.byWorkspace.length > 0 ? (
        <ul className="mt-5 flex flex-col gap-3" aria-label="Storage by drive">
          {data.byWorkspace.map((w) => (
            <li key={w.workspaceId} className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)_80px] items-center gap-3 max-[480px]:grid-cols-[minmax(0,1fr)_72px]">
              <span className="truncate text-[14px] font-medium leading-5 text-vx-text-1" title={w.name}>
                {w.name}
                {w.workspaceId === current ? <span className="vx-meta ml-1.5 font-normal text-vx-text-3">current</span> : null}
              </span>
              <span className="block h-1 overflow-hidden rounded-vx-xs bg-vx-accent-wash max-[480px]:order-last max-[480px]:col-span-2">
                {/* Each bar is that workspace's share of the quota (the meter above), with a 2 px sliver for any data at all. */}
                <span
                  className="block h-full rounded-vx-xs bg-vx-accent"
                  style={{ width: w.bytes > 0 ? `max(2px, ${Math.min(100, data.quotaBytes > 0 ? (w.bytes / data.quotaBytes) * 100 : 100)}%)` : 0 }}
                />
              </span>
              <span className="vx-meta-row text-right text-vx-text-3">{formatBytes(w.bytes)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-5 flex flex-col gap-1.5 border-t border-vx-hair-soft pt-4">
        <p className="vx-micro text-vx-text-3">
          Your quota counts each drive&apos;s current size. Earlier versions and checkpoints reuse unchanged data and are not counted. The history
          behind a drive can hold up to four times its size; if that fills up, remove a checkpoint or wait for older versions to age out.
        </p>
        <Link href="/pricing" className="vx-micro inline-flex w-fit items-center gap-1 text-vx-text-2 underline-offset-4 hover:text-vx-text-1 hover:underline">
          Need more space? See plans
          <ArrowRight size={12} strokeWidth={1.75} aria-hidden />
        </Link>
      </div>
    </Section>
  );
}

export default StorageSection;

'use client';

// Sidebar storage block (DESIGN-v2 §5, §6.0): Cloud + "Storage", a 4 px rounded meter
// (accent; --vx-warn ≥ 80 %; danger ≥ 95 %), "3.2 GB of 10 GB used", "Over by …" past
// the quota. Hover or focus shows the split per workspace. Refreshes after every
// mutation (store.refresh → swr revalidate) and keeps the last reading while it refetches.
import { useRef, useState } from 'react';
import { Cloud } from 'lucide-react';
import { RETENTION_COPY, formatBytes, meterLevel, type UsageResponse } from '@volumes/shared';
import { Meter } from '@/components/ui/meter';
import { useUsage } from '@/lib/api/hooks';
import { useVx } from '@/lib/store';

function Split({ data }: { data: UsageResponse }) {
  const total = Math.max(1, data.byWorkspace.reduce((n, w) => n + w.bytes, 0));
  return (
    <div role="tooltip" className="vx-pop absolute bottom-full left-0 right-0 z-50 mb-2 rounded-vx-md border border-vx-hair bg-vx-float p-3 shadow-vx-3">
      <div className="mb-2 text-[13px] font-semibold text-vx-text-1">By workspace</div>
      {data.byWorkspace.length ? (
        <ul className="space-y-2">
          {data.byWorkspace.map((w) => (
            <li key={w.workspaceId} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] text-vx-text-2">{w.name}</span>
              <span className="vx-meta text-vx-text-3">{formatBytes(w.bytes)}</span>
              <Meter value={w.bytes / total} className="!w-10" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="vx-meta text-vx-text-3">Nothing stored yet.</p>
      )}
      <p className="vx-micro mt-3 text-vx-text-3">{RETENTION_COPY}</p>
      <p className="vx-micro mt-1 text-vx-text-3">Ask an admin for more space.</p>
    </div>
  );
}

export default function StorageMeter() {
  useVx((s) => s.refreshKey);
  const { data: fresh, error } = useUsage();
  const last = useRef<UsageResponse | undefined>(undefined);
  if (fresh) last.current = fresh;
  const data = fresh ?? last.current;
  const [hover, setHover] = useState(false);

  const used = data?.usedBytes ?? 0;
  const quota = data?.quotaBytes ?? 0;
  const ratio = quota > 0 ? used / quota : 0;
  const level = data ? meterLevel(used, quota) : 'ok';
  const over = used > quota && quota > 0 ? used - quota : 0;

  return (
    <div
      className="relative rounded-vx-sm outline-offset-4"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      tabIndex={data ? 0 : -1}
      aria-describedby={hover && data ? 'vx-storage-split' : undefined}
    >
      <div className="flex items-center gap-3 text-vx-text-2">
        <Cloud size={18} strokeWidth={1.75} aria-hidden />
        <span className="text-[14px] font-medium">Storage</span>
      </div>
      <Meter className="mt-3" value={ratio} level={level} loading={!data && !error} />
      <div
        className="vx-meta mt-2 text-vx-text-3"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={quota || 1}
        aria-valuenow={Math.min(used, quota || used)}
        aria-label="Storage used"
        aria-valuetext={data ? `${formatBytes(used)} of ${formatBytes(quota)} used` : 'Loading'}
      >
        {!data ? (
          error ? (
            <span>Usage unavailable</span>
          ) : (
            <span className="skeleton skel-line inline-block w-28 align-middle" />
          )
        ) : (
          <>
            {formatBytes(used)} of {formatBytes(quota)} used
            {over ? <span className="block font-medium text-vx-danger">Over by {formatBytes(over)}</span> : null}
          </>
        )}
      </div>
      {hover && data ? (
        <div id="vx-storage-split">
          <Split data={data} />
        </div>
      ) : null}
    </div>
  );
}

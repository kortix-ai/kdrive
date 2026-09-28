'use client';

// Rail storage meter (DESIGN §5, §7): 40 segmented cells, `used / quota · %`,
// amber ≥ 80 %, red ≥ 95 %, "over by" past 100 %. Hover shows the split per
// workspace. Refreshes after every mutation (store.refresh → swr revalidate)
// and keeps the last reading on screen while it refetches.
import { useRef, useState } from 'react';
import { RETENTION_COPY, formatBytes, meterLevel, type UsageResponse } from '@volumes/shared';
import { useUsage } from '@/lib/api/hooks';
import { useVx } from '@/lib/store';

const CELLS = 40;

function Split({ data }: { data: UsageResponse }) {
  const total = Math.max(1, data.byWorkspace.reduce((n, w) => n + w.bytes, 0));
  return (
    <div
      role="tooltip"
      className="dlg-pop absolute bottom-full left-3 right-3 z-50 mb-2 border border-vx-hair-strong bg-vx-float p-3 shadow-[0_16px_40px_-16px_rgba(0,0,0,.7)]"
    >
      <div className="vx-label mb-2">By workspace</div>
      {data.byWorkspace.length ? (
        <ul className="space-y-1.5">
          {data.byWorkspace.map((w) => (
            <li key={w.workspaceId} className="flex items-center gap-2">
              <span className="vx-name min-w-0 flex-1 truncate text-vx-text-2">{w.name}</span>
              <span className="vx-meta text-vx-text-3">{formatBytes(w.bytes)}</span>
              <span className="h-[3px] w-10 bg-vx-hair" aria-hidden>
                <span className="block h-full bg-[var(--pt-300)]" style={{ width: `${Math.round((w.bytes / total) * 100)}%` }} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="vx-meta text-vx-text-4">Nothing stored yet.</p>
      )}
      <p className="vx-meta mt-2 text-vx-text-4">Ask an admin for more space.</p>
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
  const on = Math.min(CELLS, Math.round(Math.min(1, ratio) * CELLS));
  const color = level === 'red' ? 'var(--vx-danger)' : level === 'amber' ? 'var(--vx-past)' : 'var(--pt-300)';
  const over = used > quota && quota > 0 ? used - quota : 0;
  const pct = Math.floor(ratio * 100);

  return (
    <div
      className="relative px-4 py-3"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      tabIndex={data ? 0 : -1}
      aria-describedby={hover && data ? 'vx-storage-split' : undefined}
    >
      <div className="vx-label mb-2 flex items-center justify-between">
        <span>Storage</span>
        {level !== 'ok' && data ? (
          <span className="vx-micro normal-case tracking-normal" style={{ color }}>
            {level === 'red' ? (over ? 'over quota' : 'almost full') : 'filling up'}
          </span>
        ) : null}
      </div>
      <div className="flex h-[3px] gap-px" aria-hidden>
        {Array.from({ length: CELLS }, (_, i) => (
          <span key={i} className="flex-1 transition-colors duration-[120ms]" style={{ background: i < on ? color : 'var(--vx-hair)' }} />
        ))}
      </div>
      <div
        className="vx-meta mt-2 text-vx-text-2"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={quota || 1}
        aria-valuenow={Math.min(used, quota || used)}
        aria-label="Storage used"
        aria-valuetext={data ? `${formatBytes(used)} of ${formatBytes(quota)} used` : 'Loading'}
      >
        {!data ? (
          error ? (
            <span className="text-vx-text-4">Usage unavailable</span>
          ) : (
            <span className="skeleton skel-line inline-block w-28 align-middle" />
          )
        ) : (
          <>
            {formatBytes(used)} <span className="vx-unit">/ {formatBytes(quota)}</span>
            <span className="vx-unit"> · </span>
            <span style={level === 'ok' ? undefined : { color }}>{pct} %</span>
            {over ? (
              <span className="block text-vx-danger">over by {formatBytes(over)}</span>
            ) : null}
          </>
        )}
      </div>
      <p className="vx-micro mt-2 text-vx-text-4">{RETENTION_COPY}</p>
      {hover && data ? (
        <div id="vx-storage-split">
          <Split data={data} />
        </div>
      ) : null}
    </div>
  );
}

'use client';

// STUB (FOUNDATION, functional baseline). Owner: WEB-drive. Replace freely; keep the default export and no props.
import { RETENTION_COPY, formatBytes, meterLevel } from '@volumes/shared';
import { useUsage } from '@/lib/api/hooks';
import { useVx } from '@/lib/store';

const CELLS = 40;

export default function StorageMeter() {
  useVx((s) => s.refreshKey);
  const { data, isLoading } = useUsage();
  const used = data?.usedBytes ?? 0;
  const quota = data?.quotaBytes ?? 1;
  const ratio = Math.min(1, used / quota);
  const level = data ? meterLevel(used, quota) : 'ok';
  const on = Math.round(ratio * CELLS);
  const color = level === 'red' ? 'var(--vx-danger)' : level === 'amber' ? 'var(--vx-past)' : 'var(--pt-300)';
  const title = data?.byWorkspace.map((w) => `${w.name}: ${formatBytes(w.bytes)}`).join('\n');
  return (
    <div className="px-4 py-3" title={title}>
      <div className="vx-label mb-2">Storage</div>
      <div className="flex h-[3px] gap-px" aria-hidden>
        {Array.from({ length: CELLS }, (_, i) => (
          <span key={i} className="flex-1" style={{ background: i < on ? color : 'var(--vx-hair)' }} />
        ))}
      </div>
      <div className="vx-meta mt-2 text-vx-text-2" role="meter" aria-valuemin={0} aria-valuemax={quota} aria-valuenow={used} aria-label="Storage used">
        {isLoading || !data ? (
          <span className="skeleton skel-line inline-block w-28" />
        ) : (
          <>
            {formatBytes(used)} <span className="vx-unit">/ {formatBytes(quota)}</span> · {Math.round(ratio * 100)} %
          </>
        )}
      </div>
      <p className="vx-micro mt-2 text-vx-text-4">{RETENTION_COPY}</p>
    </div>
  );
}

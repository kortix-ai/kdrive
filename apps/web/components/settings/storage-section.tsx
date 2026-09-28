'use client';

import { RETENTION_COPY, formatBytes, meterLevel, type UsageResponse } from '@volumes/shared';
import { useUsage } from '@/lib/api/hooks';
import { useVx } from '@/lib/store';
import { Section } from './section';

const LEVEL_COLOR = { ok: 'var(--pt-300)', amber: 'var(--vx-past)', red: 'var(--vx-danger)' } as const;
/** Tonal greys for the per-workspace split (no hue: colour is meaning). */
const TONES = ['var(--pt-300)', 'var(--pt-500)', 'var(--pt-400)', 'var(--pt-600)', 'var(--pt-200)', 'var(--pt-700)'];

export function percent(used: number, quota: number): number {
  if (quota <= 0) return used > 0 ? 100 : 0;
  return Math.round((used / quota) * 1000) / 10;
}

/** STORAGE: 6 px meter, used of quota, per-workspace bars, retention and history notes. */
export function StorageSection({ fallback }: { fallback?: UsageResponse }) {
  useVx((s) => s.refreshKey);
  const { data: live, error } = useUsage();
  const data = live ?? fallback;
  if (!data) {
    return (
      <Section id="storage" label="Storage">
        {error ? <p className="text-[12px] text-vx-danger">Couldn&apos;t load storage usage.</p> : <span className="skeleton block h-16 w-full" />}
      </Section>
    );
  }
  const level = meterLevel(data.usedBytes, data.quotaBytes);
  const pct = percent(data.usedBytes, data.quotaBytes);
  const over = data.usedBytes - data.quotaBytes;
  const total = Math.max(1, data.usedBytes);
  return (
    <Section id="storage" label="Storage">
      <div className="vx-meta flex items-baseline justify-between text-vx-text-2">
        <span>
          Used <span className="text-vx-text-1">{formatBytes(data.usedBytes)}</span> <span className="vx-unit">of</span> {formatBytes(data.quotaBytes)}
        </span>
        <span style={{ color: level === 'ok' ? undefined : LEVEL_COLOR[level] }}>{pct} %</span>
      </div>
      <div
        className="mt-2 h-1.5 w-full bg-vx-hair"
        role="meter"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={data.quotaBytes}
        aria-valuenow={data.usedBytes}
      >
        <div className="h-full transition-[width] duration-[200ms]" style={{ width: `${Math.min(100, pct)}%`, background: LEVEL_COLOR[level] }} />
      </div>
      {over > 0 ? (
        <p className="mt-2 border-l-2 border-vx-danger pl-2 text-[12px] text-vx-danger">Over your quota by {formatBytes(over)}. New uploads are refused until you free some space.</p>
      ) : level !== 'ok' ? (
        <p className="vx-micro mt-2" style={{ color: LEVEL_COLOR[level] }}>
          {formatBytes(data.quotaBytes - data.usedBytes)} left.
        </p>
      ) : null}

      {data.byWorkspace.length > 0 ? (
        <ul className="mt-5 flex flex-col gap-2.5">
          {data.byWorkspace.map((w, i) => (
            <li key={w.workspaceId} className="grid grid-cols-[minmax(0,160px)_1fr_88px] items-center gap-3">
              <span className="vx-name truncate text-vx-text-2" title={w.name}>
                {w.name}
              </span>
              <span className="h-1 bg-vx-hair-soft">
                <span className="block h-full" style={{ width: `${(w.bytes / total) * 100}%`, background: TONES[i % TONES.length] }} />
              </span>
              <span className="vx-meta text-right text-vx-text-3">{formatBytes(w.bytes)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-5 flex flex-col gap-1.5">
        <p className="vx-body text-vx-text-3">{RETENTION_COPY}</p>
        <p className="vx-micro text-vx-text-4">
          Your quota counts each workspace&apos;s current size. Earlier versions and checkpoints reuse unchanged data and are not counted. The history
          behind a workspace can hold up to four times its size; if that fills up, remove a checkpoint or wait for older versions to age out.
        </p>
        <p className="vx-micro text-vx-text-4">Ask an admin for more space.</p>
      </div>
    </Section>
  );
}

export default StorageSection;

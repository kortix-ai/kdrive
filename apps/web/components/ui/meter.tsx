import { cx } from './cx';

export type MeterLevel = 'ok' | 'amber' | 'red';

/**
 * Thin rounded meter (DESIGN-v2 §5 Storage meter): a pill track in --vx-meter-track with an
 * accent fill; amber level → --vx-warn, red → --vx-danger. `height` 4 (sidebar) or 6 (tray,
 * settings, dialogs). Purely visual: give the surrounding text the numbers.
 */
export function Meter({
  value,
  level = 'ok',
  height = 4,
  className,
  loading,
}: {
  /** 0..1 (clamped) */
  value: number;
  level?: MeterLevel;
  height?: 4 | 6;
  className?: string;
  loading?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const fill = level === 'red' ? 'bg-vx-danger' : level === 'amber' ? 'bg-vx-warn' : 'bg-vx-accent';
  return (
    <span aria-hidden className={cx('block w-full overflow-hidden rounded-full bg-vx-meter-track', loading && 'skeleton', className)} style={{ height }}>
      {loading ? null : <span className={cx('vx-progress block h-full rounded-full transition-[width] duration-[200ms] ease-vx', fill)} style={{ width: `${pct}%` }} />}
    </span>
  );
}

export default Meter;

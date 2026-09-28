// Mono readouts shared by the versioning UI: bytes with a dim unit, signed deltas, short commit ids, times.

import { formatBytes, shortId } from '@volumes/shared';
import { cx } from '@/components/ui/cx';
import { formatDate, formatRelative, isoTitle } from '@/lib/format';
import { formatDelta, splitUnit } from '@/lib/versioning/timeline';

/** "4.2 MiB" with the unit in text-4 after a thin space. */
export function Bytes({ n, className }: { n: number | null | undefined; className?: string }) {
  if (n === null || n === undefined || !Number.isFinite(n)) return <span className={cx('tabular-nums', className)}>—</span>;
  const { value, unit } = splitUnit(formatBytes(n));
  return (
    <span className={cx('tabular-nums', className)}>
      {value}
      {unit ? (
        <>
          {' '}
          <span className="vx-unit">{unit}</span>
        </>
      ) : null}
    </span>
  );
}

/** Signed size delta: "+" in --vx-ok, "−" text-3, "±0 B" text-4. */
export function Delta({ n, className }: { n: number; className?: string }) {
  const tone = n > 0 ? 'text-vx-ok' : n < 0 ? 'text-vx-text-3' : 'text-vx-text-4';
  const { value, unit } = splitUnit(formatDelta(n));
  return (
    <span className={cx('tabular-nums', tone, className)}>
      {value}
      {' '}
      <span className={n === 0 ? undefined : 'vx-unit'}>{unit}</span>
    </span>
  );
}

/** "@a41f9c2" */
export function CommitId({ id, className }: { id: string | null | undefined; className?: string }) {
  if (!id) return null;
  return (
    <span className={cx('tabular-nums', className)} title={id}>
      {shortId(id)}
    </span>
  );
}

/** Relative under 7 days, else "14 Sep 16:40"; full ISO in the title. */
export function When({ at, absolute, className }: { at: string | number | Date; absolute?: boolean; className?: string }) {
  return (
    <time className={cx('tabular-nums', className)} dateTime={isoTitle(at)} title={isoTitle(at)}>
      {absolute ? formatDate(at) : formatRelative(at)}
    </time>
  );
}

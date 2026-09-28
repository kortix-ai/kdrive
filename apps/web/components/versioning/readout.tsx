// Readouts shared by the versioning UI: sizes, signed deltas, short commit ids, times.

import { formatBytes, shortId } from '@volumes/shared';
import { cx } from '@/components/ui/cx';
import { formatDate, formatRelative, isoTitle } from '@/lib/format';
import { formatDelta, friendlyWhen, splitUnit } from '@/lib/versioning/timeline';

/** "4.2 MB" (tabular numbers; units are not dimmed). */
export function Bytes({ n, className }: { n: number | null | undefined; className?: string }) {
  if (n === null || n === undefined || !Number.isFinite(n)) return <span className={cx('tabular-nums', className)}>—</span>;
  const { value, unit } = splitUnit(formatBytes(n));
  return (
    <span className={cx('whitespace-nowrap tabular-nums', className)}>
      {value}
      {unit ? ` ${unit}` : null}
    </span>
  );
}

/** Signed size delta: "+" in add-fg (green), "−" text-3, "±0 B" text-4. */
export function Delta({ n, className }: { n: number; className?: string }) {
  const tone = n > 0 ? 'text-vx-add-fg' : n < 0 ? 'text-vx-text-3' : 'text-vx-text-4';
  const { value, unit } = splitUnit(formatDelta(n));
  return (
    <span className={cx('whitespace-nowrap tabular-nums', tone, className)}>
      {value} {unit}
    </span>
  );
}

/** "@a41f9c2" in mono (commit ids are one of the few mono things). */
export function CommitId({ id, className }: { id: string | null | undefined; className?: string }) {
  if (!id) return null;
  return (
    <span className={cx('whitespace-nowrap font-mono text-[0.95em]', className)} title={id}>
      {shortId(id)}
    </span>
  );
}

/**
 * A time with the full ISO in the title. Default: compact relative ("4m", "2h", "Tue 16:40");
 * `friendly`: "4 min ago", "Yesterday, 18:02"; `absolute`: "14 Sep 16:40".
 */
export function When({ at, absolute, friendly, className }: { at: string | number | Date; absolute?: boolean; friendly?: boolean; className?: string }) {
  return (
    <time className={cx('whitespace-nowrap tabular-nums', className)} dateTime={isoTitle(at)} title={isoTitle(at)}>
      {absolute ? formatDate(at) : friendly ? friendlyWhen(new Date(at)) : formatRelative(at)}
    </time>
  );
}

import { format, formatDistanceToNowStrict, isSameYear } from 'date-fns';

export { formatBytes, meterLevel, shortId } from '@volumes/shared';

const toDate = (d: string | number | Date) => (d instanceof Date ? d : new Date(d));

/** "14 Sep 16:40" (year only when not the current one). */
export function formatDate(d: string | number | Date): string {
  const date = toDate(d);
  return isSameYear(date, new Date()) ? format(date, 'd MMM HH:mm') : format(date, 'd MMM yyyy HH:mm');
}

/** Relative under 7 days ("now", "4m", "2h", "Tue 16:40"), else formatDate. */
export function formatRelative(d: string | number | Date, now: Date = new Date()): string {
  const date = toDate(d);
  const diff = now.getTime() - date.getTime();
  if (diff < 45_000 && diff > -60_000) return 'now';
  if (diff < 60 * 60_000 && diff > 0) return `${Math.round(diff / 60_000)}m`;
  if (diff < 24 * 60 * 60_000 && diff > 0) return `${Math.round(diff / 3_600_000)}h`;
  if (diff < 7 * 24 * 60 * 60_000 && diff > 0) return format(date, 'EEE HH:mm');
  return formatDate(date);
}

/** "14 Sep, 16:40" (the time-travel banner). */
export function formatTimeTravelLabel(d: string | number | Date): string {
  const date = toDate(d);
  return isSameYear(date, new Date()) ? format(date, 'd MMM, HH:mm') : format(date, 'd MMM yyyy, HH:mm');
}

export function formatAgo(d: string | number | Date): string {
  return formatDistanceToNowStrict(toDate(d), { addSuffix: true });
}

/** ISO string for `title` attributes. */
export function isoTitle(d: string | number | Date): string {
  return toDate(d).toISOString();
}

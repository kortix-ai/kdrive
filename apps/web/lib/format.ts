import { format, formatDistanceToNowStrict, isSameDay, isSameYear, subDays } from 'date-fns';

export { formatBytes, meterLevel, shortId } from '@volumes/shared';

const toDate = (d: string | number | Date) => (d instanceof Date ? d : new Date(d));

/** "14 Sep 16:40" (year only when not the current one). */
export function formatDate(d: string | number | Date): string {
  const date = toDate(d);
  return isSameYear(date, new Date()) ? format(date, 'd MMM HH:mm') : format(date, 'd MMM yyyy HH:mm');
}

/**
 * Friendly relative time for rows and search (DESIGN-v2 §3): "Just now", "4 min ago", "2 hours ago",
 * "Today 09:12", "Yesterday, 18:02", "Tue 16:40", then "14 Sep" ("14 Sep 2025" in another year).
 */
export function formatRelative(d: string | number | Date, now: Date = new Date()): string {
  const date = toDate(d);
  const diff = now.getTime() - date.getTime();
  if (diff < 45_000 && diff > -60_000) return 'Just now';
  if (diff > 0 && diff < 60 * 60_000) return `${Math.max(1, Math.round(diff / 60_000))} min ago`;
  if (diff > 0 && diff < 6 * 3_600_000) {
    const h = Math.round(diff / 3_600_000);
    return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  }
  if (isSameDay(date, now)) return `Today ${format(date, 'HH:mm')}`;
  if (isSameDay(date, subDays(now, 1))) return `Yesterday, ${format(date, 'HH:mm')}`;
  if (diff > 0 && diff < 7 * 24 * 3_600_000) return format(date, 'EEE HH:mm');
  return isSameYear(date, now) ? format(date, 'd MMM') : format(date, 'd MMM yyyy');
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

const EARLIER = ' to an earlier version';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Summaries written before times moved client-side: "… to 28 Sep 2026, 05:57 UTC". */
const LEGACY_UTC = /(\d{1,2}) ([A-Z][a-z]{2}) (\d{4}), (\d{2}):(\d{2}) UTC/g;

/**
 * An action's summary with any time in the VIEWER's clock: restores say
 * "Restored plan.md to 28 Sep, 11:26" from `restoredTo`, never a UTC time next
 * to the local ones around it.
 */
export function actionText(summary: string, restoredTo?: string | null): string {
  if (restoredTo && summary.endsWith(EARLIER)) return `${summary.slice(0, -EARLIER.length)} to ${formatTimeTravelLabel(restoredTo)}`;
  return summary.replace(LEGACY_UTC, (m, d: string, mon: string, y: string, h: string, min: string) => {
    const mi = MONTHS.indexOf(mon);
    if (mi < 0) return m;
    return formatTimeTravelLabel(new Date(Date.UTC(Number(y), mi, Number(d), Number(h), Number(min))));
  });
}

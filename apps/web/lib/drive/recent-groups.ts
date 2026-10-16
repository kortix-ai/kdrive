import { isSameDay, startOfWeek, subDays } from 'date-fns';

export type RecentBand = 'today' | 'yesterday' | 'week' | 'earlier';

export const RECENT_BAND_LABEL: Record<RecentBand, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  earlier: 'Earlier',
};

/** Today, Yesterday, This week (since Monday, in local time), else Earlier. */
export function recentBand(at: Date | string, now: Date = new Date()): RecentBand {
  const d = typeof at === 'string' ? new Date(at) : at;
  if (isSameDay(d, now)) return 'today';
  if (isSameDay(d, subDays(now, 1))) return 'yesterday';
  if (d >= startOfWeek(now, { weekStartsOn: 1 })) return 'week';
  return 'earlier';
}

/** Items (newest first) in their bands, in band order; empty bands are left out. */
export function groupRecent<T extends { at: string }>(items: readonly T[], now: Date = new Date()): { band: RecentBand; label: string; items: T[] }[] {
  const order: RecentBand[] = ['today', 'yesterday', 'week', 'earlier'];
  const by = new Map<RecentBand, T[]>();
  for (const it of items) {
    const b = recentBand(it.at, now);
    const list = by.get(b) ?? [];
    list.push(it);
    by.set(b, list);
  }
  return order.filter((b) => by.has(b)).map((b) => ({ band: b, label: RECENT_BAND_LABEL[b], items: by.get(b)! }));
}

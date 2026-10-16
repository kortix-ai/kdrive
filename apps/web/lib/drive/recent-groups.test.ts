import { describe, expect, test } from 'bun:test';
import { groupRecent, recentBand } from './recent-groups';

describe('recent bands', () => {
  // Thursday 15 Oct 2026, 10:00 local: the week began on Monday the 12th.
  const now = new Date(2026, 9, 15, 10, 0);

  test('today, yesterday, this week since Monday, earlier', () => {
    expect(recentBand(new Date(2026, 9, 15, 0, 1), now)).toBe('today');
    expect(recentBand(new Date(2026, 9, 14, 23, 59), now)).toBe('yesterday');
    expect(recentBand(new Date(2026, 9, 12, 0, 0), now)).toBe('week');
    expect(recentBand(new Date(2026, 9, 11, 23, 59), now)).toBe('earlier');
  });

  test('a Monday has no "this week" before yesterday', () => {
    const monday = new Date(2026, 9, 12, 9, 0);
    expect(recentBand(new Date(2026, 9, 11, 9, 0), monday)).toBe('yesterday');
    expect(recentBand(new Date(2026, 9, 10, 9, 0), monday)).toBe('earlier');
  });

  test('groups keep band order and drop empty bands', () => {
    const at = (d: Date) => ({ at: d.toISOString() });
    const groups = groupRecent([at(new Date(2026, 9, 15, 9)), at(new Date(2026, 9, 1)), at(new Date(2026, 9, 15, 8))], now);
    expect(groups.map((g) => `${g.label}:${g.items.length}`)).toEqual(['Today:2', 'Earlier:1']);
  });
});

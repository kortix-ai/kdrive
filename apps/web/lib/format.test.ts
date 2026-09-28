import { describe, expect, test } from 'bun:test';
import { actionText, formatRelative, formatTimeTravelLabel } from './format';

describe('actionText', () => {
  test('a restore names its version in the viewer\'s own clock', () => {
    const at = '2026-09-28T05:57:00.000Z';
    expect(actionText('Restored plan.md to an earlier version', at)).toBe(`Restored plan.md to ${formatTimeTravelLabel(at)}`);
    expect(actionText('Undid: Restored plan.md to an earlier version', null)).toBe('Undid: Restored plan.md to an earlier version');
    expect(actionText('Uploaded a.txt')).toBe('Uploaded a.txt');
  });

  test('older summaries with a UTC time are shown in local time', () => {
    const local = formatTimeTravelLabel(new Date(Date.UTC(2026, 8, 28, 5, 57)));
    expect(actionText('Restored hello-copy.txt to 28 Sep 2026, 05:57 UTC')).toBe(`Restored hello-copy.txt to ${local}`);
    expect(actionText('Undid: Restored plan.md to 28 Sep 2026, 05:57 UTC')).not.toContain('UTC');
  });
});

describe('formatRelative', () => {
  const now = new Date(2026, 8, 28, 13, 0);
  test('friendly forms by age', () => {
    expect(formatRelative(new Date(2026, 8, 28, 12, 59, 40), now)).toBe('Just now');
    expect(formatRelative(new Date(2026, 8, 28, 12, 56), now)).toBe('4 min ago');
    expect(formatRelative(new Date(2026, 8, 28, 11, 0), now)).toBe('2 hours ago');
    expect(formatRelative(new Date(2026, 8, 28, 5, 12), now)).toBe('Today 05:12');
    expect(formatRelative(new Date(2026, 8, 27, 18, 2), now)).toBe('Yesterday, 18:02');
    expect(formatRelative(new Date(2026, 8, 22, 16, 40), now)).toBe('Tue 16:40');
    expect(formatRelative(new Date(2026, 8, 14, 16, 40), now)).toBe('14 Sep');
    expect(formatRelative(new Date(2025, 11, 8, 8, 57), now)).toBe('8 Dec 2025');
  });
});

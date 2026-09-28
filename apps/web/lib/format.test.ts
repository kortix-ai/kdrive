import { describe, expect, test } from 'bun:test';
import { actionText, formatTimeTravelLabel } from './format';

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

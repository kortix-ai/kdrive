import { describe, expect, test } from 'bun:test';
import { monthGrid, roundUpToSlot } from './date-time-picker';

describe('date-time picker', () => {
  test('roundUpToSlot moves to the next 30-minute slot', () => {
    expect(roundUpToSlot(new Date(2026, 9, 20, 10, 2))).toEqual(new Date(2026, 9, 20, 10, 30));
    expect(roundUpToSlot(new Date(2026, 9, 20, 10, 31))).toEqual(new Date(2026, 9, 20, 11, 0));
    expect(roundUpToSlot(new Date(2026, 9, 20, 23, 45))).toEqual(new Date(2026, 9, 21, 0, 0));
  });

  test('roundUpToSlot keeps an exact slot and rounds up seconds', () => {
    expect(roundUpToSlot(new Date(2026, 9, 20, 10, 30))).toEqual(new Date(2026, 9, 20, 10, 30));
    expect(roundUpToSlot(new Date(2026, 9, 20, 10, 30, 5))).toEqual(new Date(2026, 9, 20, 11, 0));
  });

  test('monthGrid is six Monday-first weeks covering the month', () => {
    const days = monthGrid(new Date(2026, 9, 13));
    expect(days).toHaveLength(42);
    expect(days[0]).toEqual(new Date(2026, 8, 28)); // Mon 28 Sep
    expect(days.every((d, i) => i % 7 !== 0 || d.getDay() === 1)).toBe(true);
    expect(days.some((d) => d.getMonth() === 9 && d.getDate() === 31)).toBe(true);
  });
});

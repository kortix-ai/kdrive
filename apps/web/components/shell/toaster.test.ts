import { describe, expect, test } from 'bun:test';
import { toastBottom } from './toaster';

describe('toast placement', () => {
  test('12 px above the Time Strip on /drive, 16 px from the bottom elsewhere', () => {
    expect(toastBottom('/drive')).toBe('calc(var(--vx-strip-h) + 12px)');
    expect(toastBottom('/drive/Photos')).toBe('calc(var(--vx-strip-h) + 12px)');
    expect(toastBottom('/settings')).toBe('16px');
    expect(toastBottom('/drivers')).toBe('16px');
  });
});

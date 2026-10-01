import { describe, expect, test } from 'bun:test';
import { THEME_PREFS, nextThemePref, oppositeTheme, parseThemePref, resolveTheme } from './theme';
import { THEME_BOOT_SCRIPT } from './theme-boot';

describe('theme preference', () => {
  test('missing or unknown values mean dark', () => {
    expect(parseThemePref(null)).toBe('dark');
    expect(parseThemePref(undefined)).toBe('dark');
    expect(parseThemePref('')).toBe('dark');
    expect(parseThemePref('sepia')).toBe('dark');
    expect(parseThemePref('light')).toBe('light');
    expect(parseThemePref('system')).toBe('system');
  });

  test('light only for an explicit light choice or System on a light device', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
  });

  test('order is Dark, Light, System', () => {
    expect([...THEME_PREFS]).toEqual(['dark', 'light', 'system']);
    expect(nextThemePref('dark')).toBe('light');
    expect(nextThemePref('light')).toBe('system');
    expect(nextThemePref('system')).toBe('dark');
  });

  test('the toggle stores the explicit opposite of what is painted', () => {
    expect(oppositeTheme('dark')).toBe('light');
    expect(oppositeTheme('light')).toBe('dark');
  });
});

describe('pre-paint boot script', () => {
  function run(stored: string | null, osLight: boolean, throwing = false) {
    const attrs: Record<string, string> = {};
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    const style: Record<string, string> = {};
    const doc = {
      documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v), classList: { add() {}, remove() {} }, style },
      querySelectorAll: () => [],
      addEventListener: () => {},
    };
    const win = {
      matchMedia: (q: string) => ({ matches: q.includes('light') ? osLight : !osLight, addEventListener: () => {} }),
      addEventListener: (k: string, f: (e: unknown) => void) => (listeners[k] ??= []).push(f),
      dispatchEvent: () => true,
    };
    const storage = {
      getItem: () => {
        if (throwing) throw new Error('blocked');
        return stored;
      },
    };
    new Function('document', 'window', 'localStorage', 'requestAnimationFrame', 'CustomEvent', THEME_BOOT_SCRIPT)(
      doc,
      win,
      storage,
      (f: () => void) => f(),
      class {},
    );
    return { theme: attrs['data-vx-theme'], scheme: style.colorScheme, listeners };
  }

  test('no stored value paints dark, even on a light device', () => {
    expect(run(null, true).theme).toBe('dark');
  });
  test('a stored choice wins', () => {
    expect(run('light', false).theme).toBe('light');
    expect(run('dark', true).theme).toBe('dark');
    expect(run('system', true).theme).toBe('light');
    expect(run('system', false).theme).toBe('dark');
  });
  test('blocked storage falls back to dark', () => {
    expect(run('light', true, true).theme).toBe('dark');
  });
  test('sets color-scheme and listens for other tabs', () => {
    const r = run('light', false);
    expect(r.scheme).toBe('light');
    expect(r.listeners.storage?.length).toBe(1);
  });
});

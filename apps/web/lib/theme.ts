'use client';

// Theme preference (DESIGN-v2 §2.1): light (default) · dark · system.
// The pre-paint script in lib/theme-boot.ts applies it before first paint;
// this module changes it at runtime and tells listeners through the
// `vx-theme` window event (detail = the new preference).

export type ThemePref = 'light' | 'dark' | 'system';
/** Kept as the preference type for existing callers. */
export type Theme = ThemePref;
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'vx-theme';
export const THEME_EVENT = 'vx-theme';
export const THEME_PREFS: readonly ThemePref[] = ['light', 'dark', 'system'];

export function parseThemePref(v: string | null | undefined): ThemePref {
  return v === 'dark' || v === 'system' ? v : 'light';
}

/** The stored preference; no value (or no storage) means light. */
export function getThemePref(): ThemePref {
  try {
    return parseThemePref(localStorage.getItem(KEY));
  } catch {
    return 'light';
  }
}

/** Alias of getThemePref, for existing callers. */
export const getTheme = getThemePref;

function systemIsDark(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function resolveTheme(pref: ThemePref, osDark = systemIsDark()): ResolvedTheme {
  if (pref === 'dark') return 'dark';
  if (pref === 'system' && osDark) return 'dark';
  return 'light';
}

/** What is painted right now. */
export function getResolvedTheme(): ResolvedTheme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.vxTheme === 'dark' ? 'dark' : 'light';
}

export function setThemePref(p: ThemePref): void {
  try {
    if (p === 'light') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  if (typeof document !== 'undefined') document.documentElement.dataset.vxTheme = resolveTheme(p);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: p }));
}

/** Alias of setThemePref, for existing callers. */
export const setTheme = setThemePref;

/** Light → Dark → System → Light (the top-bar cycle button). */
export function nextThemePref(p: ThemePref): ThemePref {
  return p === 'light' ? 'dark' : p === 'dark' ? 'system' : 'light';
}

export const THEME_LABEL: Record<ThemePref, string> = { light: 'Light', dark: 'Dark', system: 'System' };

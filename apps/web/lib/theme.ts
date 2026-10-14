// Theme preference (UNIFY-SPEC §1): dark (default) · light · system.
// One preference for the landing and the app: localStorage['vx-theme'], resolved onto
// <html data-vx-theme="dark|light">. The pre-paint script in lib/theme-boot.ts applies it
// before first paint and keeps other tabs in sync; this module changes it at runtime and
// tells listeners through the `vx-theme` window event (detail = the new preference).

export type ThemePref = 'dark' | 'light' | 'system';
/** Kept as the preference type for existing callers. */
export type Theme = ThemePref;
export type ResolvedTheme = 'dark' | 'light';

export const THEME_KEY = 'vx-theme';
export const THEME_EVENT = 'vx-theme';
export const THEME_PREFS: readonly ThemePref[] = ['dark', 'light', 'system'];
/** The painted ground per theme, mirrored into <meta name="theme-color">. */
export const THEME_COLOR: Record<ResolvedTheme, string> = { dark: '#0a0a0b', light: '#f4f4f6' };

/** Missing or unknown values mean dark. */
export function parseThemePref(v: string | null | undefined): ThemePref {
  return v === 'light' || v === 'system' ? v : 'dark';
}

/** The stored preference; no value (or no storage) means dark. */
export function getThemePref(): ThemePref {
  try {
    return parseThemePref(localStorage.getItem(THEME_KEY));
  } catch {
    return 'dark';
  }
}

/** The public landing (/ and /pricing) opens light when nothing is stored; the app stays dark. */
export function isLandingPath(pathname: string): boolean {
  return /^\/(pricing\/?)?$/.test(pathname);
}

/** True when the visitor has stored a choice (any value, including the default). */
export function hasStoredThemePref(): boolean {
  try {
    return localStorage.getItem(THEME_KEY) !== null;
  } catch {
    return true;
  }
}

/** Alias of getThemePref, for existing callers. */
export const getTheme = getThemePref;

function systemIsLight(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: light)').matches;
  } catch {
    return false;
  }
}

/** Light only for an explicit light choice, or for System on a light device. */
export function resolveTheme(pref: ThemePref, osLight = systemIsLight()): ResolvedTheme {
  if (pref === 'light') return 'light';
  if (pref === 'system' && osLight) return 'light';
  return 'dark';
}

/** What is painted right now. */
export function getResolvedTheme(): ResolvedTheme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.vxTheme === 'light' ? 'light' : 'dark';
}

/**
 * Paints a resolved theme: the attribute, color-scheme and the theme-color meta. Transitions are
 * suppressed for two frames so hundreds of elements never recolour on staggered timings.
 */
export function applyTheme(t: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const d = document.documentElement;
  d.classList.add('vx-theme-switching');
  d.dataset.vxTheme = t;
  d.style.colorScheme = t;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', THEME_COLOR[t]));
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f: () => void) => setTimeout(f, 16);
  raf(() => raf(() => d.classList.remove('vx-theme-switching')));
}

/** Stores the choice explicitly (the default is stored too), paints it and tells listeners. */
export function setThemePref(p: ThemePref): void {
  try {
    localStorage.setItem(THEME_KEY, p);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  applyTheme(resolveTheme(p));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: p }));
}

/** Alias of setThemePref, for existing callers. */
export const setTheme = setThemePref;

/**
 * Switches with a short cross-fade where the browser supports view transitions and motion is
 * allowed; otherwise instantly.
 */
export function switchThemePref(p: ThemePref): void {
  const doc = typeof document !== 'undefined' ? (document as Document & { startViewTransition?: (cb: () => void) => unknown }) : null;
  let reduce = false;
  try {
    reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    /* no matchMedia */
  }
  if (doc?.startViewTransition && !reduce) {
    try {
      doc.startViewTransition(() => setThemePref(p));
      return;
    } catch {
      /* fall through */
    }
  }
  setThemePref(p);
}

/** The explicit opposite of what is painted (the sun/moon toggle). */
export function oppositeTheme(t: ResolvedTheme): ThemePref {
  return t === 'dark' ? 'light' : 'dark';
}

/** Dark → Light → System → Dark (kept for callers that cycle). */
export function nextThemePref(p: ThemePref): ThemePref {
  return p === 'dark' ? 'light' : p === 'light' ? 'system' : 'dark';
}

export const THEME_LABEL: Record<ThemePref, string> = { dark: 'Dark', light: 'Light', system: 'System' };

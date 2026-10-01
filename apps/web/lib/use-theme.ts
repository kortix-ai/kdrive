'use client';

import { useEffect, useState } from 'react';
import { THEME_EVENT, getResolvedTheme, getThemePref, setThemePref, type ResolvedTheme, type ThemePref } from './theme';

/**
 * The current theme preference, kept in sync across the page (settings, top bar, sign-in, landing nav).
 * Other tabs reach this through the boot script's storage listener, which re-dispatches the `vx-theme` event.
 */
export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const [pref, set] = useState<ThemePref>('dark');
  useEffect(() => {
    set(getThemePref());
    const on = () => set(getThemePref());
    window.addEventListener(THEME_EVENT, on);
    return () => window.removeEventListener(THEME_EVENT, on);
  }, []);
  return [pref, setThemePref];
}

/** The theme painted right now (dark until mounted, matching the server render). */
export function useResolvedTheme(): ResolvedTheme {
  const [t, set] = useState<ResolvedTheme>('dark');
  useEffect(() => {
    set(getResolvedTheme());
    const on = () => set(getResolvedTheme());
    window.addEventListener(THEME_EVENT, on);
    return () => window.removeEventListener(THEME_EVENT, on);
  }, []);
  return t;
}

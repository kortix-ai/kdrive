'use client';

import { useEffect, useState } from 'react';
import { THEME_EVENT, getThemePref, resolveTheme, setThemePref, type ThemePref } from './theme';

/** The current theme preference, kept in sync across the page (settings, top bar, sign-in). */
export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const [pref, set] = useState<ThemePref>('light');
  useEffect(() => {
    set(getThemePref());
    const on = () => set(getThemePref());
    // Another tab changed it: repaint here too.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'vx-theme' && e.key !== null) return;
      const p = getThemePref();
      document.documentElement.dataset.vxTheme = resolveTheme(p);
      set(p);
    };
    window.addEventListener(THEME_EVENT, on);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(THEME_EVENT, on);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return [pref, setThemePref];
}

'use client';

import { useEffect } from 'react';
import { THEME_EVENT, applyTheme, getThemePref, hasStoredThemePref, type ResolvedTheme } from '@/lib/theme';

/** Paints a default (not stored) and tells listeners, so the hero scene and the toggle follow. */
function paint(t: ResolvedTheme) {
  applyTheme(t);
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: getThemePref() }));
}

// The landing opens light unless the visitor chose a theme (lib/theme-boot.ts paints it before first paint on a
// full load). This covers client navigation: light on the way in, back to the app's dark default on the way out.
export function LandingTheme() {
  useEffect(() => {
    if (hasStoredThemePref()) return;
    paint('light');
    return () => {
      if (!hasStoredThemePref()) paint('dark');
    };
  }, []);
  return null;
}

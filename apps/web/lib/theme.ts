'use client';

export type Theme = 'dark' | 'light';
const KEY = 'vx-theme';

export function getTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.vxTheme === 'light' ? 'light' : 'dark';
}

export function setTheme(t: Theme): void {
  try {
    if (t === 'light') localStorage.setItem(KEY, 'light');
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
  if (t === 'light') document.documentElement.dataset.vxTheme = 'light';
  else delete document.documentElement.dataset.vxTheme;
  window.dispatchEvent(new CustomEvent('vx-theme', { detail: t }));
}

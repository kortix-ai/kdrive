'use client';

import { useEffect, useState } from 'react';
import { getTheme, setTheme, type Theme } from '@/lib/theme';

/** ◐ — toggles dark (default) / light; persisted in localStorage['vx-theme']. */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, set] = useState<Theme>('dark');
  useEffect(() => {
    set(getTheme());
    const on = (e: Event) => set((e as CustomEvent<Theme>).detail);
    window.addEventListener('vx-theme', on);
    return () => window.removeEventListener('vx-theme', on);
  }, []);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={className ?? 'inline-flex h-7 w-7 items-center justify-center font-mono text-[14px] text-vx-text-3 hover:bg-vx-surface-2 hover:text-vx-text-1'}
    >
      ◐
    </button>
  );
}

export default ThemeToggle;

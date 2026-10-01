'use client';

import { Moon, Sun } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { Segmented } from '@/components/ui/segmented';
import { THEME_LABEL, THEME_PREFS, oppositeTheme, switchThemePref, type ThemePref } from '@/lib/theme';
import { useResolvedTheme, useThemePref } from '@/lib/use-theme';

/**
 * The sun/moon toggle (UNIFY-SPEC §1.4): shows Sun while Dark is painted and Moon while Light is painted.
 * A click stores the explicit opposite of what is painted (so a System user who clicks leaves System).
 * Both icons are rendered and CSS shows the one matching html[data-vx-theme], so the icon is right on the
 * first painted frame, before hydration.
 */
export function ThemeToggle({ size = 'md', className }: { size?: 'xs' | 'sm' | 'md'; className?: string }) {
  const painted = useResolvedTheme();
  const label = painted === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  const px = size === 'xs' ? 14 : 16;
  return (
    <IconButton
      size={size}
      className={className}
      label={label}
      data-testid="theme-toggle"
      onClick={() => switchThemePref(oppositeTheme(painted))}
    >
      <Sun size={px} strokeWidth={1.75} aria-hidden className="vx-when-dark" />
      <Moon size={px} strokeWidth={1.75} aria-hidden className="vx-when-light" />
    </IconButton>
  );
}

/** Dark / Light / System as a segmented control (Settings → Appearance). */
export function ThemeSegmented({ className }: { iconsOnly?: boolean; className?: string }) {
  const [pref] = useThemePref();
  return (
    <Segmented<ThemePref>
      label="Theme"
      value={pref}
      onChange={switchThemePref}
      className={className}
      options={THEME_PREFS.map((p) => ({ value: p, label: THEME_LABEL[p] }))}
    />
  );
}

export default ThemeToggle;

'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { Segmented } from '@/components/ui/segmented';
import { THEME_LABEL, nextThemePref, type ThemePref } from '@/lib/theme';
import { useThemePref } from '@/lib/use-theme';

const ICON = { light: Sun, dark: Moon, system: Monitor } as const;

/** Top-bar theme cycle: Light → Dark → System. The tooltip names the current mode. */
export function ThemeToggle({ size = 'md', className }: { size?: 'xs' | 'sm' | 'md'; className?: string }) {
  const [pref, setPref] = useThemePref();
  const Icon = ICON[pref];
  const next = nextThemePref(pref);
  return (
    <IconButton
      size={size}
      className={className}
      label={`Theme: ${THEME_LABEL[pref]}. Switch to ${THEME_LABEL[next]}`}
      onClick={() => setPref(next)}
    >
      <Icon size={size === 'md' ? 20 : 18} strokeWidth={1.75} aria-hidden />
    </IconButton>
  );
}

/** Light / Dark / System as a segmented control; `iconsOnly` for tight footers (28 px). */
export function ThemeSegmented({ iconsOnly, className }: { iconsOnly?: boolean; className?: string }) {
  const [pref, setPref] = useThemePref();
  return (
    <Segmented<ThemePref>
      label="Theme"
      value={pref}
      onChange={setPref}
      size={iconsOnly ? 'sm' : 'md'}
      check={!iconsOnly}
      className={className}
      options={(['light', 'dark', 'system'] as const).map((p) => {
        const Icon = ICON[p];
        return {
          value: p,
          ariaLabel: iconsOnly ? THEME_LABEL[p] : undefined,
          label: iconsOnly ? <Icon size={16} strokeWidth={1.75} aria-hidden /> : THEME_LABEL[p],
        };
      })}
    />
  );
}

export default ThemeToggle;

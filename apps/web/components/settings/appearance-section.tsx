'use client';

// Settings → Appearance (UNIFY-SPEC §1.4, §14.4): one radio group of three 120 × 80 previews (Dark, Light, System).
// Each preview is a tiny shell drawn inside `data-vx-theme-scope`, so it paints with that theme's tokens.
import { Check } from 'lucide-react';
import { cx } from '@/components/ui/cx';
import { THEME_LABEL, THEME_PREFS, switchThemePref, type ResolvedTheme, type ThemePref } from '@/lib/theme';
import { useThemePref } from '@/lib/use-theme';
import { Section } from './section';

/** A miniature of the app in one fixed theme: ground, a hair-ruled sidebar, a sheet with three rows and the head dot. */
function MiniShell({ theme, className, style }: { theme: ResolvedTheme; className?: string; style?: React.CSSProperties }) {
  return (
    <span data-vx-theme-scope={theme} className={cx('absolute inset-0 block bg-vx-bg', className)} style={style}>
      <span className="absolute inset-y-0 left-0 block w-[30px] border-r border-vx-hair">
        <span className="absolute left-[5px] top-[9px] block h-[5px] w-[19px] bg-vx-primary" />
        <span className="absolute left-[5px] top-[20px] block h-[6px] w-[19px] bg-vx-accent-wash" />
        <span className="absolute left-[7px] top-[30px] block h-[3px] w-[13px] bg-vx-hair-strong" />
        <span className="absolute left-[7px] top-[37px] block h-[3px] w-[15px] bg-vx-hair-strong" />
      </span>
      <span className="absolute bottom-[7px] left-[36px] right-[7px] top-[8px] block overflow-hidden rounded-vx-xs border border-vx-hair bg-vx-surface">
        <span className="absolute left-[7px] top-[7px] block h-[4px] w-[30px] bg-vx-text-3" />
        {[19, 30, 41].map((top, i) => (
          <span key={top} className="absolute inset-x-0 block border-t border-vx-hair-soft" style={{ top }}>
            <span className="absolute left-[7px] top-[4px] block h-[3px] bg-vx-hair-strong" style={{ width: [34, 26, 30][i] }} />
            <span className="absolute right-[7px] top-[4px] block h-[3px] w-[10px] bg-vx-hair" />
          </span>
        ))}
        <span className="absolute bottom-[7px] left-[7px] right-[16px] block h-px bg-vx-hair-strong" />
        <span className="absolute bottom-[4px] right-[7px] block h-[7px] w-[7px] rounded-full bg-vx-accent" />
      </span>
    </span>
  );
}

function ThemePreview({ pref, on }: { pref: ThemePref; on: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={() => switchThemePref(pref)}
      className="group flex min-w-0 flex-col items-start gap-2 rounded-vx-sm text-left"
    >
      <span
        className={cx(
          'relative block h-20 w-[120px] overflow-hidden rounded-vx-sm transition-shadow duration-[120ms] ease-vx max-[520px]:aspect-[3/2] max-[520px]:h-auto max-[520px]:w-full',
          on
            ? 'shadow-[0_0_0_1px_var(--vx-accent-edge),0_0_0_3px_var(--vx-surface),0_0_0_4px_var(--vx-accent-edge)]'
            : 'shadow-[0_0_0_1px_var(--vx-hair-strong)] group-hover:shadow-[0_0_0_1px_var(--vx-outline)]',
        )}
      >
        {pref === 'system' ? (
          <>
            <MiniShell theme="dark" />
            <MiniShell theme="light" style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }} />
            <span aria-hidden className="absolute inset-0 block bg-[linear-gradient(to_top_left,transparent_calc(50%-0.5px),var(--vx-hair-strong)_50%,transparent_calc(50%+0.5px))]" />
          </>
        ) : (
          <MiniShell theme={pref} />
        )}
        {on ? (
          <span aria-hidden className="absolute right-1.5 top-1.5 inline-flex h-4 w-4 items-center justify-center rounded-vx-xs bg-vx-accent text-vx-on-accent">
            <Check size={12} strokeWidth={2.5} />
          </span>
        ) : null}
      </span>
      <span className={cx('text-[13px] font-medium leading-5', on ? 'text-vx-text-1' : 'text-vx-text-2 group-hover:text-vx-text-1')}>
        {THEME_LABEL[pref]}
        {pref === 'dark' ? <span className="vx-meta ml-1.5 font-normal text-vx-text-3">default</span> : null}
      </span>
    </button>
  );
}

/** Appearance: the shared theme preference (one key for the app and the KDRIVE site). */
export function AppearanceSection() {
  const [pref] = useThemePref();
  return (
    <Section
      id="appearance"
      label="Appearance"
      description="System follows your device. Your choice is kept on this device and applies to the KDRIVE site too."
    >
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-[repeat(3,120px)] gap-5 max-[520px]:grid-cols-3 max-[520px]:gap-3">
        {THEME_PREFS.map((p) => (
          <ThemePreview key={p} pref={p} on={pref === p} />
        ))}
      </div>
    </Section>
  );
}

export default AppearanceSection;

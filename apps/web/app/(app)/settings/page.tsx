'use client';

// Settings (DESIGN-v2 §6.17): cards for profile, appearance, storage, workspaces, activity, shortcuts, session, danger zone.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, LogOut } from 'lucide-react';
import { ActivitySection } from '@/components/settings/activity-section';
import { DangerZone } from '@/components/settings/danger-zone';
import { ProfileSection } from '@/components/settings/profile-section';
import { Section } from '@/components/settings/section';
import { StorageSection } from '@/components/settings/storage-section';
import { WorkspacesSection } from '@/components/settings/workspaces-section';
import { ShortcutList } from '@/components/shell/shortcut-sheet';
import { ThemeSegmented } from '@/components/shell/theme-toggle';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Kbd } from '@/components/ui/kbd';
import { signOutAndEnd } from '@/lib/session';
import { useVx } from '@/lib/store';
import { THEME_LABEL, THEME_PREFS, type ResolvedTheme, type ThemePref } from '@/lib/theme';
import { useThemePref } from '@/lib/use-theme';

/** The theme actually on screen (`html[data-vx-theme]`), live. */
function useResolvedTheme(): ResolvedTheme {
  const [t, setT] = useState<ResolvedTheme>('light');
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setT(el.dataset.vxTheme === 'dark' ? 'dark' : 'light');
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ['data-vx-theme'] });
    return () => mo.disconnect();
  }, []);
  return t;
}

/**
 * Colours for a thumbnail, from tokens only: the theme on screen uses its own surfaces; the other
 * theme is drawn from the inverse tokens (which are the opposite theme's ink and paper).
 */
function thumbPalette(same: boolean) {
  return same
    ? { page: 'var(--vx-bg)', sheet: 'var(--vx-surface)', edge: 'var(--vx-hair)', ink: 'var(--vx-hair-strong)', pill: 'var(--vx-accent-wash)', dot: 'var(--vx-accent)' }
    : {
        page: 'var(--vx-inverse)',
        sheet: 'color-mix(in srgb, var(--vx-on-inverse) 9%, var(--vx-inverse))',
        edge: 'color-mix(in srgb, var(--vx-on-inverse) 16%, var(--vx-inverse))',
        ink: 'color-mix(in srgb, var(--vx-on-inverse) 32%, var(--vx-inverse))',
        pill: 'color-mix(in srgb, var(--vx-inverse-accent) 30%, var(--vx-inverse))',
        dot: 'var(--vx-inverse-accent)',
      };
}

/** A 120 × 80 miniature of the app (sidebar pill, a sheet with lines, a blue dot). */
function Mini({ p, clip }: { p: ReturnType<typeof thumbPalette>; clip?: string }) {
  return (
    <g clipPath={clip}>
      <rect width="120" height="80" fill={p.page} />
      <rect x="8" y="10" width="22" height="7" rx="3.5" fill={p.pill} />
      <rect x="8" y="22" width="18" height="4" rx="2" fill={p.ink} />
      <rect x="8" y="30" width="20" height="4" rx="2" fill={p.ink} />
      <rect x="36" y="8" width="78" height="66" rx="6" fill={p.sheet} stroke={p.edge} />
      <rect x="44" y="18" width="36" height="5" rx="2.5" fill={p.ink} />
      <rect x="44" y="30" width="58" height="4" rx="2" fill={p.edge} />
      <rect x="44" y="40" width="50" height="4" rx="2" fill={p.edge} />
      <rect x="44" y="50" width="54" height="4" rx="2" fill={p.edge} />
      <circle cx="102" cy="64" r="4" fill={p.dot} />
    </g>
  );
}

function ThemeThumb({ pref, on, onPick, resolved }: { pref: ThemePref; on: boolean; onPick: () => void; resolved: ResolvedTheme }) {
  const light = thumbPalette(resolved === 'light');
  const dark = thumbPalette(resolved === 'dark');
  const clipId = `thumb-${pref}`;
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onPick} className="group flex flex-col items-center gap-2 rounded-vx-md">
      <span
        className={cx(
          'relative block h-20 w-[120px] overflow-hidden rounded-vx-md transition-shadow duration-[120ms]',
          on ? 'shadow-[0_0_0_2px_var(--vx-accent)]' : 'shadow-[0_0_0_1px_var(--vx-hair-strong)] group-hover:shadow-[0_0_0_1px_var(--vx-outline)]',
        )}
      >
        <svg width="120" height="80" viewBox="0 0 120 80" aria-hidden className="block">
          {pref === 'system' ? (
            <>
              <defs>
                <clipPath id={clipId}>
                  <path d="M0 0 H120 L0 80 Z" />
                </clipPath>
                <clipPath id={`${clipId}-b`}>
                  <path d="M120 0 V80 H0 Z" />
                </clipPath>
              </defs>
              <Mini p={light} clip={`url(#${clipId})`} />
              <Mini p={dark} clip={`url(#${clipId}-b)`} />
            </>
          ) : (
            <Mini p={pref === 'light' ? light : dark} />
          )}
        </svg>
        {on ? (
          <span aria-hidden className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-vx-accent text-vx-on-accent">
            <Check size={14} strokeWidth={2.5} />
          </span>
        ) : null}
      </span>
      <span className={cx('text-[13px] font-medium leading-5', on ? 'text-vx-text-1' : 'text-vx-text-2')}>{THEME_LABEL[pref]}</span>
    </button>
  );
}

function AppearanceSection() {
  const [pref, setPref] = useThemePref();
  const resolved = useResolvedTheme();
  return (
    <Section id="appearance" label="Appearance" description="System follows your device's setting. Your choice is kept on this device." aside={<ThemeSegmented />}>
      <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-4">
        {THEME_PREFS.map((p) => (
          <ThemeThumb key={p} pref={p} on={pref === p} onPick={() => setPref(p)} resolved={resolved} />
        ))}
      </div>
    </Section>
  );
}

function ShortcutsSection() {
  return (
    <Section
      id="shortcuts"
      label="Shortcuts"
      description={
        <>
          Everything has a key. Press <Kbd>?</Kbd> anywhere to see them.
        </>
      }
    >
      <ShortcutList />
    </Section>
  );
}

function SessionSection() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const out = async () => {
    setBusy(true);
    // The same session end as the account menu: uploads, prompts, store and every cache.
    await signOutAndEnd();
    router.replace('/signin');
  };
  return (
    <Section
      id="session"
      label="Session"
      description="Signs you out on this device. Your files stay where they are."
      aside={
        <Button variant="outline" icon={<LogOut size={18} strokeWidth={1.75} aria-hidden />} onClick={() => void out()} loading={busy}>
          Sign out
        </Button>
      }
    />
  );
}

export default function SettingsPage() {
  const me = useVx((s) => s.me);
  if (!me) return null;
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 pb-16 pt-6 min-[721px]:px-6">
      <h1 className="vx-h1 mb-2">Settings</h1>
      <ProfileSection me={me} />
      <AppearanceSection />
      <StorageSection fallback={me.usage} />
      <WorkspacesSection />
      <ActivitySection />
      <ShortcutsSection />
      <SessionSection />
      <DangerZone me={me} />
    </div>
  );
}

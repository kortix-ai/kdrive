'use client';

// Top bar (DESIGN-v2 §6.0, §7): brand block · the "Search in Drive" pill · Help,
// theme cycle and the account avatar. On phones it is one 48 px pill holding the
// menu button, the search placeholder and a 28 px avatar.
import { usePathname, useRouter } from 'next/navigation';
import { CircleHelp, Clock, LogOut, Menu as MenuIcon, Monitor, Moon, Search, Settings, Sun } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { IconButton } from '@/components/ui/icon-button';
import { Kbd } from '@/components/ui/kbd';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';
import { cx } from '@/components/ui/cx';
import { signOut } from '@/lib/auth-client';
import { formatTimeTravelLabel } from '@/lib/format';
import { sendShellIntent } from '@/lib/shell-intents';
import { useVx } from '@/lib/store';
import { THEME_LABEL, type ThemePref } from '@/lib/theme';
import { useThemePref } from '@/lib/use-theme';
import { Brand } from './brand';
import { ThemeToggle } from './theme-toggle';

const onDriveRoute = (p: string) => p === '/drive' || p.startsWith('/drive/');

/** Opens the drive's search palette (going to the drive first when elsewhere). */
function useOpenSearch() {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  return () => {
    sendShellIntent('search');
    if (!onDriveRoute(pathname)) router.push('/drive');
  };
}

function PastChip() {
  const tt = useVx((s) => s.timeTravel);
  if (!tt) return null;
  return (
    <span className="fade-in inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-vx-past-wash px-2.5 text-[12px] font-medium text-vx-past shadow-[inset_0_0_0_1px_var(--vx-past-edge)] max-[720px]:hidden">
      <Clock size={16} strokeWidth={1.75} aria-hidden />
      <span className="tabular-nums">{formatTimeTravelLabel(tt.createdAt)}</span>
    </span>
  );
}

/** The 48 px search pill. `phone` adds the menu button and the avatar inside it. */
function SearchPill({ onMenu, phone }: { onMenu?: () => void; phone?: boolean }) {
  const open = useOpenSearch();
  return (
    <div
      role="search"
      className={cx(
        'flex h-12 w-full min-w-0 items-center gap-3 rounded-full bg-vx-field text-vx-text-3 transition-[background-color,box-shadow] duration-[120ms] ease-vx hover:bg-vx-field-hover',
        phone ? 'pl-1 pr-2' : 'max-w-[720px] px-4',
      )}
    >
      {phone ? (
        <IconButton label="Open navigation" size="md" onClick={onMenu} className="text-vx-text-2">
          <MenuIcon size={20} strokeWidth={1.75} aria-hidden />
        </IconButton>
      ) : null}
      <button
        type="button"
        onClick={open}
        aria-label="Search in Drive"
        aria-keyshortcuts="/ Meta+K"
        data-testid="search-pill"
        className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-full text-left outline-offset-0"
      >
        {phone ? null : <Search size={20} strokeWidth={1.75} className="shrink-0" aria-hidden />}
        <span className="min-w-0 flex-1 truncate text-[15px] leading-6">Search in Drive</span>
        <PastChip />
        {phone ? null : <Kbd className="max-[900px]:hidden">/</Kbd>}
      </button>
      {phone ? <AccountMenu size={28} /> : null}
    </div>
  );
}

const THEME_ICON = { light: Sun, dark: Moon, system: Monitor } as const;

/** Avatar + account menu: email, Settings, Theme (Light / Dark / System), Sign out. */
export function AccountMenu({ size = 32 }: { size?: number }) {
  const router = useRouter();
  const me = useVx((s) => s.me);
  const setMe = useVx((s) => s.setMe);
  const [pref, setPref] = useThemePref();
  const displayName = me?.user.name || me?.user.email || '';
  const items: MenuItem[] = [
    { id: 'who', type: 'label', label: <span className="block truncate">{me?.user.email ?? ''}</span> },
    { id: 'settings', label: 'Settings', icon: <Settings size={18} strokeWidth={1.75} />, kbd: 'g ,', onSelect: () => router.push('/settings') },
    { id: 'sep-theme', type: 'separator' },
    { id: 'theme', type: 'label', label: 'Theme' },
    ...(['light', 'dark', 'system'] as ThemePref[]).map<MenuItem>((p) => {
      const Icon = THEME_ICON[p];
      return { id: `theme-${p}`, label: THEME_LABEL[p], checked: pref === p, icon: <Icon size={18} strokeWidth={1.75} />, onSelect: () => setPref(p) };
    }),
    { id: 'sep', type: 'separator' },
    {
      id: 'signout',
      label: 'Sign out',
      icon: <LogOut size={18} strokeWidth={1.75} />,
      onSelect: async () => {
        await signOut().catch(() => {});
        setMe(null);
        router.replace('/signin');
      },
    },
  ];
  return (
    <Menu
      align="end"
      minWidth={260}
      items={items}
      trigger={(p) => (
        <button
          type="button"
          {...p}
          aria-label="Account menu"
          title={displayName}
          data-testid="account-menu"
          className="inline-flex shrink-0 items-center justify-center rounded-full p-1 transition-colors duration-[120ms] hover:bg-vx-surface-3"
        >
          <Avatar name={displayName} image={me?.user.image ?? null} size={size} />
        </button>
      )}
    />
  );
}

export function TopBar({ onMenu, onHelp }: { onMenu: () => void; onHelp: () => void }) {
  return (
    <header className="vx-topbar">
      {/* ≥ 721 px: brand · pill · tools */}
      <div className="flex items-center pl-4 max-[720px]:hidden">
        <Brand compactBelow />
      </div>
      <div className="flex min-w-0 justify-center px-2 max-[720px]:hidden">
        <SearchPill />
      </div>
      <div className="flex items-center gap-1 pl-2 max-[720px]:hidden">
        <Tooltip label="Keyboard shortcuts" kbd="?" side="bottom">
          <IconButton label="Keyboard shortcuts" nativeTitle={false} onClick={onHelp}>
            <CircleHelp size={20} strokeWidth={1.75} aria-hidden />
          </IconButton>
        </Tooltip>
        <ThemeToggle />
        <AccountMenu />
      </div>
      {/* Phones: a single pill. */}
      <div className="hidden w-full min-w-0 max-[720px]:flex">
        <SearchPill phone onMenu={onMenu} />
      </div>
    </header>
  );
}

export default TopBar;

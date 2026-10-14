'use client';

// Top bar (UNIFY-SPEC §11): the KDRIVE lockup · the "Search in Drive" field · Help,
// the sun/moon theme toggle and the account avatar, over a 1px hair rule. On phones
// it is a glass bar holding the menu button, the search field and a 28 px avatar.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { CircleHelp, Clock, LogOut, Menu as MenuIcon, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Search, Settings, Sun } from 'lucide-react';
import { KMark } from '@/components/brand/k-mark';
import { Avatar } from '@/components/ui/avatar';
import { IconButton } from '@/components/ui/icon-button';
import { Kbd } from '@/components/ui/kbd';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';
import { cx } from '@/components/ui/cx';
import { formatMoment } from '@/lib/format';
import { signOutAndEnd } from '@/lib/session';
import { toggleSide, useSideCollapsed } from '@/lib/side';
import { sendShellIntent } from '@/lib/shell-intents';
import { useVx } from '@/lib/store';
import { THEME_LABEL, THEME_PREFS, switchThemePref } from '@/lib/theme';
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
    <span className="fade-in inline-flex h-6 shrink-0 items-center gap-1.5 rounded-vx-xs bg-vx-past-wash px-2 font-mono text-[11px] font-medium text-vx-past shadow-[inset_0_0_0_1px_var(--vx-past-edge)] max-[720px]:hidden">
      <Clock size={13} strokeWidth={1.75} aria-hidden />
      <span className="tabular-nums">{formatMoment(tt.createdAt)}</span>
    </span>
  );
}

/** The 36 px search field (opens the palette). `phone` puts the menu button before it and the avatar after it. */
function SearchPill({ onMenu, phone }: { onMenu?: () => void; phone?: boolean }) {
  const open = useOpenSearch();
  return (
    <div role="search" className={cx('flex w-full min-w-0 items-center gap-2', phone ? '' : 'max-w-[640px]')}>
      {phone ? (
        <>
          <IconButton label="Open navigation" size="md" onClick={onMenu}>
            <MenuIcon size={18} strokeWidth={1.75} aria-hidden />
          </IconButton>
          {/* The brand on phones too: the 16 px cube mark, home to the drive. */}
          <Link href="/drive" aria-label="KDRIVE home" className="inline-flex h-9 w-6 shrink-0 items-center justify-center rounded-vx-sm">
            <KMark size={16} />
          </Link>
        </>
      ) : null}
      <button
        type="button"
        onClick={open}
        aria-label="Search in Drive"
        aria-keyshortcuts="/ Meta+K"
        data-testid="search-pill"
        className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-vx-sm border border-vx-hair-strong bg-vx-field px-3 text-left text-vx-text-3 transition-[border-color,background-color] duration-[120ms] ease-vx hover:border-vx-outline hover:bg-vx-field-hover"
      >
        <Search size={16} strokeWidth={1.75} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[14px] leading-5">Search in Drive</span>
        <PastChip />
        {phone ? null : <Kbd className="max-[900px]:hidden">/</Kbd>}
      </button>
      {phone ? (
        <>
          <ThemeToggle size="sm" />
          <AccountMenu size={28} />
        </>
      ) : null}
    </div>
  );
}

const THEME_ICON = { dark: Moon, light: Sun, system: Monitor } as const;

/** Avatar + account menu: email, Settings, Theme (Dark / Light / System), Sign out. */
export function AccountMenu({ size = 28 }: { size?: number }) {
  const router = useRouter();
  const me = useVx((s) => s.me);
  const [pref] = useThemePref();
  const displayName = me?.user.name || me?.user.email || '';
  const items: MenuItem[] = [
    { id: 'who', type: 'label', label: <span className="block truncate">{me?.user.email ?? ''}</span> },
    { id: 'settings', label: 'Settings', icon: <Settings size={16} strokeWidth={1.75} />, kbd: 'G ,', onSelect: () => router.push('/settings') },
    { id: 'sep-theme', type: 'separator' },
    { id: 'theme', type: 'label', label: <span className="vx-eyebrow">Theme</span> },
    ...THEME_PREFS.map<MenuItem>((p) => {
      const Icon = THEME_ICON[p];
      return { id: `theme-${p}`, label: THEME_LABEL[p], checked: pref === p, icon: <Icon size={16} strokeWidth={1.75} />, onSelect: () => switchThemePref(p) };
    }),
    { id: 'sep', type: 'separator' },
    {
      id: 'signout',
      label: 'Sign out',
      icon: <LogOut size={16} strokeWidth={1.75} />,
      onSelect: async () => {
        await signOutAndEnd();
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
          className="inline-flex shrink-0 items-center justify-center rounded-full p-0.5 transition-shadow duration-[120ms] hover:shadow-[0_0_0_2px_var(--vx-hair-strong)]"
        >
          <Avatar name={displayName} image={me?.user.image ?? null} size={size} />
        </button>
      )}
    />
  );
}

/** Collapses the sidebar to its icon rail and back (wide screens only; narrower ones decide by width). */
function SideToggle() {
  const collapsed = useSideCollapsed();
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <span className="mr-2 hidden shrink-0 min-[1024px]:inline-flex">
      <Tooltip label={label} kbd="⌘B" side="bottom">
        <IconButton label={label} nativeTitle={false} onClick={toggleSide} aria-expanded={!collapsed} aria-controls="vx-side">
          <Icon size={16} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </Tooltip>
    </span>
  );
}

export function TopBar({ onMenu, onHelp }: { onMenu: () => void; onHelp: () => void }) {
  return (
    <header className="vx-topbar">
      {/* ≥ 721 px: brand · pill · tools */}
      <div className="flex items-center pl-4 max-[1023px]:justify-center max-[1023px]:pl-0 side-collapsed:justify-center side-collapsed:pl-0 max-[720px]:hidden">
        <Brand compactBelow />
      </div>
      <div className="flex min-w-0 items-center justify-start px-3 max-[720px]:hidden">
        <SideToggle />
        <SearchPill />
      </div>
      <div className="flex items-center gap-1 pl-2 max-[720px]:hidden">
        <Tooltip label="Keyboard shortcuts" kbd="?" side="bottom">
          <IconButton label="Keyboard shortcuts" nativeTitle={false} onClick={onHelp}>
            <CircleHelp size={16} strokeWidth={1.75} aria-hidden />
          </IconButton>
        </Tooltip>
        <ThemeToggle />
        <span className="ml-1 inline-flex">
          <AccountMenu />
        </span>
      </div>
      {/* Phones: menu · search field · theme · avatar. */}
      <div className="hidden w-full min-w-0 max-[720px]:flex">
        <SearchPill phone onMenu={onMenu} />
      </div>
    </header>
  );
}

export default TopBar;

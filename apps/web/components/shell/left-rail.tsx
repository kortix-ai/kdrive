'use client';

// Sidebar (DESIGN-v2 §6.0): on the page colour, no border. Top to bottom:
// + New, the workspace switcher, nav pills (chord hints on hover), a flexible gap,
// then storage and the emulated-storage badge. 72 px icon column at 720–1023 px;
// a drawer on phones (AppShell opens it from the top bar).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bookmark, HardDrive, Settings, Shield, Trash } from 'lucide-react';
import StorageMeter from '@/components/drive/storage-meter';
import WorkspaceSwitcher from '@/components/workspaces/workspace-switcher';
import { cx } from '@/components/ui/cx';
import { useVx } from '@/lib/store';
import { useCheckpoints } from '@/lib/versioning/hooks';
import { EmulatedBadge } from './emulated-badge';
import { NewButton } from './new-button';

type NavItem = { href: string; label: string; short: string; icon: typeof HardDrive; chord: string };

const NAV_MAIN: NavItem[] = [
  { href: '/drive', label: 'My Drive', short: 'Drive', icon: HardDrive, chord: 'g d' },
  { href: '/checkpoints', label: 'Checkpoints', short: 'Saved', icon: Bookmark, chord: 'g c' },
  { href: '/recently-deleted', label: 'Recently deleted', short: 'Deleted', icon: Trash, chord: 'g x' },
];
const NAV_SETTINGS: NavItem = { href: '/settings', label: 'Settings', short: 'Settings', icon: Settings, chord: 'g ,' };
const NAV_ADMIN: NavItem = { href: '/admin', label: 'Admin', short: 'Admin', icon: Shield, chord: '' };

function NavLink({ n, active, count, onNavigate }: { n: NavItem; active: boolean; count?: number; onNavigate?: () => void }) {
  const Icon = n.icon;
  return (
    <Link href={n.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} title={n.label} className="vx-nav">
      <span className="vx-nav-icon">
        <Icon size={18} strokeWidth={1.75} aria-hidden />
      </span>
      <span className="vx-side-full min-w-0 flex-1 truncate">{n.label}</span>
      {n.chord ? (
        <span className="vx-nav-chord vx-side-full vx-micro shrink-0 text-vx-text-4" aria-hidden>
          {n.chord}
        </span>
      ) : null}
      {count ? <span className="vx-nav-count vx-side-full vx-meta shrink-0 tabular-nums">{count}</span> : null}
      <span className="vx-side-compact text-[12px] font-medium leading-4">{n.short}</span>
    </Link>
  );
}

export function LeftRail({ open, onNavigate }: { open?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname() ?? '/';
  const me = useVx((s) => s.me);
  const { data: cps } = useCheckpoints();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const cpCount = cps?.checkpoints.length ?? 0;

  return (
    <nav data-open={open ? 'true' : 'false'} className="vx-side" aria-label="Main">
      <div className="pb-3">
        <NewButton />
      </div>
      <div className="pb-2">
        <WorkspaceSwitcher />
      </div>
      <ul className="flex flex-col gap-0.5">
        {NAV_MAIN.map((n) => (
          <li key={n.href}>
            <NavLink n={n} active={isActive(n.href)} count={n.href === '/checkpoints' ? cpCount : undefined} onNavigate={onNavigate} />
          </li>
        ))}
        <li role="separator" aria-hidden className="mx-4 my-2 h-px bg-vx-hair max-[1023px]:mx-2" />
        <li>
          <NavLink n={NAV_SETTINGS} active={isActive(NAV_SETTINGS.href)} onNavigate={onNavigate} />
        </li>
        {me?.isAdmin ? (
          <li>
            <NavLink n={NAV_ADMIN} active={isActive(NAV_ADMIN.href)} onNavigate={onNavigate} />
          </li>
        ) : null}
      </ul>
      <div className="min-h-6 flex-1" />
      <div className={cx('vx-side-full border-t border-vx-hair-soft px-1 pt-4')}>
        <StorageMeter />
        <EmulatedBadge className="mt-3" />
      </div>
    </nav>
  );
}

export const Sidebar = LeftRail;
export default LeftRail;

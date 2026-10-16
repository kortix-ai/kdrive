'use client';

// Sidebar (UNIFY-SPEC §11): on the page ground with a 1px hair right rule. Top to bottom:
// + New (primary), the DRIVES eyebrow + workspace switcher, 32 px nav items (chord hints
// on hover, Mono counts), a flexible gap, then storage, "Get more storage" and (emulated
// storage only) a small badge on a hair rule. 64 px icon column at 720–1023 px, or wider when collapsed (lib/side.ts); a drawer on phones (AppShell opens it).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Clock, Diamond, Files, Inbox, Settings, Shield, Star, Trash } from 'lucide-react';
import StorageMeter from '@/components/drive/storage-meter';
import WorkspaceSwitcher from '@/components/workspaces/workspace-switcher';
import { ProposalsNavCount } from '@/components/proposals/proposals-nav-count';
import { cx } from '@/components/ui/cx';
import { useVx } from '@/lib/store';
import { useCheckpoints } from '@/lib/versioning/hooks';
import { EmulatedBadge } from './emulated-badge';
import { GetMoreStorage } from './get-more-storage';
import { NewButton } from './new-button';

type NavItem = { href: string; label: string; short: string; icon: typeof Files; chord: string };

const NAV_MAIN: NavItem[] = [
  { href: '/drive', label: 'Files', short: 'Files', icon: Files, chord: 'g d' },
  { href: '/recent', label: 'Recent', short: 'Recent', icon: Clock, chord: 'g r' },
  { href: '/starred', label: 'Starred', short: 'Starred', icon: Star, chord: 'g s' },
  { href: '/checkpoints', label: 'Checkpoints', short: 'Saved', icon: Diamond, chord: 'g c' },
  { href: '/recently-deleted', label: 'Recently deleted', short: 'Deleted', icon: Trash, chord: 'g x' },
  { href: '/proposals', label: 'Proposals', short: 'Review', icon: Inbox, chord: 'g p' },
];
const NAV_SETTINGS: NavItem = { href: '/settings', label: 'Settings', short: 'Settings', icon: Settings, chord: 'g ,' };
const NAV_ADMIN: NavItem = { href: '/admin', label: 'Admin', short: 'Admin', icon: Shield, chord: '' };

function NavLink({
  n,
  active,
  count,
  countSlot,
  onNavigate,
}: {
  n: NavItem;
  active: boolean;
  count?: number;
  /** Renders its own count pill (e.g. open proposals) instead of `count`. */
  countSlot?: ReactNode;
  onNavigate?: () => void;
}) {
  const Icon = n.icon;
  return (
    <Link href={n.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} title={n.label} className="vx-nav">
      <span className="vx-nav-icon">
        <Icon size={16} strokeWidth={1.75} aria-hidden />
      </span>
      <span className="vx-side-full min-w-0 flex-1 truncate">{n.label}</span>
      {n.chord ? (
        <span className="vx-nav-chord vx-side-full shrink-0" aria-hidden>
          {n.chord}
        </span>
      ) : null}
      {countSlot ?? (count ? <span className="vx-nav-count vx-side-full shrink-0">{count}</span> : null)}
      <span className="vx-side-compact">{n.short}</span>
    </Link>
  );
}

export function LeftRail({ open, onNavigate }: { open?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname() ?? '/';
  const me = useVx((s) => s.me);
  const { data: cps } = useCheckpoints();
  // Compare (a file or the whole drive) is a drive view: Files stays lit there.
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/') || (href === '/drive' && (pathname === '/compare' || pathname.startsWith('/compare/')));
  const cpCount = cps?.checkpoints.length ?? 0;

  return (
    <nav id="vx-side" data-open={open ? 'true' : 'false'} className="vx-side" aria-label="Main">
      <div className="pb-4">
        <NewButton />
      </div>
      <div className="vx-eyebrow vx-side-full px-2.5 pb-1.5">Drives</div>
      <div className="pb-2">
        <WorkspaceSwitcher />
      </div>
      <ul className="flex flex-col gap-0.5">
        {NAV_MAIN.map((n) => (
          <li key={n.href}>
            <NavLink
              n={n}
              active={isActive(n.href)}
              count={n.href === '/checkpoints' ? cpCount : undefined}
              countSlot={n.href === '/proposals' ? <ProposalsNavCount /> : undefined}
              onNavigate={onNavigate}
            />
          </li>
        ))}
        <li role="separator" aria-hidden className="mx-2.5 my-2 h-px bg-vx-hair max-[1023px]:mx-1 side-collapsed:mx-1" />
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
      <div className={cx('vx-side-full -mx-3 border-t border-vx-hair px-4 pt-3')}>
        <StorageMeter />
        <GetMoreStorage className="mt-3" onNavigate={onNavigate} />
        <EmulatedBadge className="mt-2" />
      </div>
    </nav>
  );
}

export const Sidebar = LeftRail;
export default LeftRail;

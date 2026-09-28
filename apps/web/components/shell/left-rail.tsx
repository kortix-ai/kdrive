'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bookmark, HardDrive, LogOut, Settings, Shield, Trash } from 'lucide-react';
import StorageMeter from '@/components/drive/storage-meter';
import WorkspaceSwitcher from '@/components/workspaces/workspace-switcher';
import { Menu } from '@/components/ui/menu';
import { cx } from '@/components/ui/cx';
import { signOut } from '@/lib/auth-client';
import { useVx } from '@/lib/store';
import { EmulatedBadge } from './emulated-badge';
import { ThemeToggle } from './theme-toggle';

const NAV = [
  { href: '/drive', label: 'My Drive', icon: HardDrive, chord: 'g d' },
  { href: '/checkpoints', label: 'Checkpoints', icon: Bookmark, chord: 'g c' },
  { href: '/recently-deleted', label: 'Recently deleted', icon: Trash, chord: 'g x' },
  { href: '/settings', label: 'Settings', icon: Settings, chord: 'g ,' },
];

/** Platinum square mark in currentColor. */
function Mark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <rect x="0.5" y="0.5" width="15" height="15" fill="none" stroke="currentColor" />
      <rect x="4" y="4" width="8" height="8" fill="currentColor" />
    </svg>
  );
}

function Avatar({ name, image }: { name: string; image: string | null }) {
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" width={24} height={24} className="h-6 w-6 border border-vx-hair object-cover" referrerPolicy="no-referrer" />;
  }
  return <span className="inline-flex h-6 w-6 items-center justify-center border border-vx-hair font-mono text-[10px] text-vx-text-2">{initials || '·'}</span>;
}

export function LeftRail({ open, onNavigate }: { open?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const me = useVx((s) => s.me);
  const setMe = useVx((s) => s.setMe);
  const nav = me?.isAdmin ? [...NAV, { href: '/admin', label: 'Admin', icon: Shield, chord: '' }] : NAV;
  const displayName = me?.user.name || me?.user.email || '';

  return (
    <nav data-open={open ? 'true' : 'false'} className="vx-rail flex min-h-0 flex-col border-r border-vx-hair bg-vx-surface" aria-label="Main">
      <div className="flex h-12 shrink-0 items-center gap-2.5 px-4 text-vx-text-1">
        <Mark />
        <span className="vx-label vx-rail-label text-vx-text-1">Volumes</span>
      </div>
      <div className="vx-rail-extra">
        <WorkspaceSwitcher />
      </div>
      <ul className="mt-1 flex flex-col">
        {nav.map((n) => {
          const active = pathname === n.href || pathname.startsWith(n.href + '/');
          const Icon = n.icon;
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                title={n.label}
                className={cx(
                  'flex h-8 items-center gap-2.5 px-4 font-mono text-[12px] transition-colors duration-[120ms]',
                  active ? 'text-vx-text-1 shadow-[inset_2px_0_0_var(--pt-300)]' : 'text-vx-text-3 hover:bg-vx-surface-2 hover:text-vx-text-1',
                )}
              >
                <Icon size={16} strokeWidth={1.5} aria-hidden />
                <span className="vx-rail-label flex-1 truncate">{n.label}</span>
                {n.chord ? <span className="vx-rail-label vx-micro text-vx-text-4">{n.chord}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="min-h-0 flex-1" />
      <div className="vx-rail-extra border-t border-vx-hair">
        <StorageMeter />
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2 border-t border-vx-hair px-3">
        <ThemeToggle />
        <span className="vx-rail-extra flex-1">
          <EmulatedBadge />
        </span>
        <Menu
          align="end"
          items={[
            { id: 'who', type: 'label', label: me?.user.email ?? '' },
            { id: 'settings', label: 'Settings', icon: <Settings size={14} />, onSelect: () => router.push('/settings') },
            { id: 'sep', type: 'separator' },
            {
              id: 'signout',
              label: 'Sign out',
              icon: <LogOut size={14} />,
              onSelect: async () => {
                await signOut().catch(() => {});
                setMe(null);
                router.replace('/signin');
              },
            },
          ]}
          trigger={(p) => (
            <button type="button" {...p} aria-label="Account menu" title={displayName} className="inline-flex items-center hover:opacity-80">
              <Avatar name={displayName} image={me?.user.image ?? null} />
            </button>
          )}
        />
      </div>
    </nav>
  );
}

export default LeftRail;

'use client';

// The admin console's frame (/admin/**), apart from the drive: a left sidebar with the KDRIVE mark
// and "Admin", one link per section, the signed-in admin and "Back to drive" at the bottom; the
// section on a sheet beside it. Phones get a top bar and the sidebar as a drawer. The server
// layout has already checked the visitor is an admin (lib/admin-gate.ts); this frame only loads
// `me` into the store, which the sections read.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CreditCard,
  HardDrive,
  Inbox,
  LayoutDashboard,
  Menu as MenuIcon,
  ScrollText,
  Settings2,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { AdminSessionResponse } from '@volumes/shared';
import { KMark } from '@/components/brand/k-mark';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/icon-button';
import { useMe } from '@/lib/api/hooks';
import { useVx } from '@/lib/store';
import { ADMIN_SECTIONS, sectionOf, type AdminSection } from './admin-route';
import { useOpenStorageRequests } from './storage-requests';

const ICONS: Record<AdminSection, LucideIcon> = {
  overview: LayoutDashboard,
  users: Users,
  drives: HardDrive,
  requests: Inbox,
  billing: CreditCard,
  logs: ScrollText,
  admins: ShieldCheck,
  settings: Settings2,
};

function Lockup() {
  return (
    <Link href="/admin" className="inline-flex items-center gap-2 rounded-vx-sm" aria-label="KDRIVE admin, overview">
      <KMark size={16} className="shrink-0" />
      <span className="vx-wordmark">KDRIVE</span>
      <Badge tone="accent">Admin</Badge>
    </Link>
  );
}

export function ConsoleShell({ admin, children }: { admin: AdminSessionResponse; children: React.ReactNode }) {
  const pathname = usePathname() ?? '/admin';
  const section = sectionOf(pathname);
  const { data: me } = useMe();
  const setMe = useVx((s) => s.setMe);
  const { data: open } = useOpenStorageRequests();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    if (me) setMe(me);
  }, [me, setMe]);
  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  const who = me?.user ?? admin.user;
  const openCount = open?.requests.length ?? 0;

  return (
    <div className="vx-adm">
      <a href="#vx-adm-main" className="vx-skip">
        Skip to content
      </a>
      <header className="vx-adm-bar">
        <IconButton label="Sections" onClick={() => setDrawer((d) => !d)} aria-expanded={drawer} aria-controls="vx-adm-side">
          <MenuIcon size={18} strokeWidth={1.75} />
        </IconButton>
        <Lockup />
      </header>

      <nav id="vx-adm-side" className="vx-adm-side" data-open={drawer ? 'true' : 'false'} aria-label="Admin">
        <div className="px-2.5 pb-5 pt-1">
          <Lockup />
        </div>
        <ul className="flex flex-col gap-0.5">
          {ADMIN_SECTIONS.map((s) => {
            const Icon = ICONS[s.id];
            const active = s.id === section;
            return (
              <li key={s.id}>
                <Link href={s.href} aria-current={active ? 'page' : undefined} className="vx-adm-nav">
                  <Icon size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  {s.id === 'requests' && openCount ? <span className="vx-nav-count is-attention shrink-0">{openCount}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="min-h-6 flex-1" />
        <div className="-mx-3 border-t border-vx-hair px-3 pt-3">
          <div className="flex items-center gap-2.5 px-1">
            <Avatar name={who.name || who.email} image={who.image} size={28} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium leading-[18px] text-vx-text-1">{who.name || who.email}</div>
              <div className="vx-micro truncate text-vx-text-3" title={admin.source === 'env' ? 'Admin from the server config' : undefined}>
                {who.name ? who.email : admin.source === 'env' ? 'server config admin' : 'admin'}
              </div>
            </div>
            <ThemeToggle size="sm" />
          </div>
          <Link href="/drive" className={cx('vx-adm-nav mt-2 text-vx-text-3')}>
            <ArrowLeft size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
            Back to drive
          </Link>
        </div>
      </nav>
      {drawer ? <div className="dlg-fade fixed inset-0 z-[55] hidden bg-vx-scrim max-[720px]:block" onClick={() => setDrawer(false)} aria-hidden /> : null}

      <div className="vx-adm-content">
        <main id="vx-adm-main" tabIndex={-1} className="vx-adm-main vx-sheet outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}

export default ConsoleShell;

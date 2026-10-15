'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import CheckpointDialog from '@/components/versioning/checkpoint-dialog';
import DuplicateDialog from '@/components/workspaces/duplicate-dialog';
import PeopleDialog from '@/components/workspaces/people-dialog';
import RenameWorkspaceDialog from '@/components/workspaces/rename-dialog';
import GlobalDropZone from '@/components/drive/global-drop-zone';
import RestoreDialog from '@/components/versioning/restore-dialog';
import ShareDialog from '@/components/share/share-dialog';
import TimeStrip from '@/components/versioning/time-strip';
import TimeTravelBanner from '@/components/versioning/time-travel-banner';
import TimelineRail from '@/components/versioning/timeline-rail';
import UploadTray from '@/components/drive/upload-tray';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { cx } from '@/components/ui/cx';
import { isApiError } from '@/lib/api/client';
import { VerifyBanner, VerifyHold } from '@/components/auth/verify-email';
import { useConfig, useMe } from '@/lib/api/hooks';
import { useDeepLink } from '@/lib/deep-link';
import { useHotkeys } from '@/lib/keys';
import { endSession } from '@/lib/session';
import { toggleSide } from '@/lib/side';
import { useVx } from '@/lib/store';
import { LeftRail } from './left-rail';
import { NewFab } from './new-button';
import { PanelHost } from './panel-host';
import { ShortcutSheet } from './shortcut-sheet';
import { TopBar } from './top-bar';

/** Routes that are not about the drive's contents, so the past ring never frames them. */
export function isTimeless(pathname: string): boolean {
  return pathname === '/settings' || pathname.startsWith('/settings/');
}

/**
 * The signed-in frame (DESIGN-v2 §6.0): auth guard (401 → /signin?next=…), the grid
 * [sidebar][top bar / content], the work sheet with the past banner, the timeline rail
 * and details panel as sheets beside it, the history strip under them on /drive, and
 * the global keys.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/drive';
  const { data: me, error, mutate } = useMe();
  const { data: config } = useConfig();
  const setMe = useVx((s) => s.setMe);
  const timelineOpen = useVx((s) => s.timelineOpen);
  const panel = useVx((s) => s.panel);
  const past = useVx((s) => !!s.timeTravel);
  const [sheet, setSheet] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    if (me) setMe(me);
  }, [me, setMe]);

  // Links from AI agents carry ?ws= (and ?file= on /drive/**).
  useDeepLink();

  // The drawer closes on navigation and on Esc.
  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setDrawer(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [drawer]);

  const unauthorized = isApiError(error) && error.status === 401;
  const ending = useRef(false);
  useEffect(() => {
    if (!unauthorized) return;
    const next = typeof window !== 'undefined' ? window.location.pathname + window.location.search : pathname;
    // The session ended outside this tab (signed out elsewhere, or expired): forget the
    // user here as well before leaving, or the stale identity still cached next to the 401
    // would send the sign-in page straight back.
    // Ending clears the cached 401 too, so this effect is not re-run by it; the navigation
    // happens whether or not the shell is still mounted by then.
    if (ending.current) return;
    ending.current = true;
    void endSession().finally(() => {
      ending.current = false;
      router.replace(`/signin?next=${encodeURIComponent(next)}`);
    });
  }, [unauthorized, router, pathname]);

  useHotkeys(
    {
      h: () => useVx.getState().toggleTimeline(),
      'mod+z': () => void useVx.getState().undoLast(),
      'mod+b': () => window.matchMedia('(min-width: 1024px)').matches && toggleSide(),
      '?': () => setSheet(true),
      'g d': () => router.push('/drive'),
      'g r': () => router.push('/recent'),
      'g s': () => router.push('/starred'),
      'g c': () => router.push('/checkpoints'),
      'g x': () => router.push('/recently-deleted'),
      'g p': () => router.push('/proposals'),
      'g ,': () => router.push('/settings'),
    },
    { enabled: !!me },
  );

  if (error && !unauthorized) {
    return (
      <div className="vx-atmos flex h-dvh items-center justify-center p-4">
        <div className="vx-sheet w-full max-w-[480px] shadow-vx-mock">
          <EmptyState
            art="gone"
            title="Could not load your drive"
            body={error instanceof Error ? error.message : 'Unknown error'}
            actions={
              <Button variant="primary" onClick={() => void mutate()}>
                Retry
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="vx-app" aria-busy>
        <header className="vx-topbar">
          <div className="flex items-center gap-2.5 pl-4">
            <span className="skeleton h-4 w-4 !rounded-vx-xs" />
            <span className="skeleton skel-line w-16" />
          </div>
          <div className="flex justify-start px-3">
            <span className="skeleton h-9 w-full max-w-[640px] !rounded-vx-sm" />
          </div>
          <span className="skeleton mx-2 h-7 w-7 !rounded-full" />
        </header>
        <div className="vx-side">
          <span className="skeleton h-9 w-full !rounded-vx-sm" />
          <span className="skeleton skel-line mt-6 w-40" />
          <span className="skeleton skel-line w-32" />
          <span className="skeleton skel-line w-36" />
        </div>
        <div className="vx-content">
          <main className="vx-main vx-sheet p-6">
            <span className="skeleton skel-line w-64" />
          </main>
        </div>
      </div>
    );
  }

  // Unverified address: held at the verify screen when the server requires it, else a banner.
  const unverified = me.user.emailVerified === false && !!config?.emailVerification;
  if (unverified && config?.requireEmailVerification) return <VerifyHold me={me} onVerified={() => void mutate()} />;

  // The history strip belongs to the drive only (never on /proposals/**, whose review page is full height).
  const onDrive = pathname === '/drive' || pathname.startsWith('/drive/');
  const timeless = isTimeless(pathname);
  return (
    <div className="vx-app">
      <a href="#vx-main" className="vx-skip">
        Skip to content
      </a>
      <TopBar onMenu={() => setDrawer((d) => !d)} onHelp={() => setSheet(true)} />
      <LeftRail open={drawer} onNavigate={() => setDrawer(false)} />
      {drawer ? <div className="dlg-fade fixed inset-0 z-[55] hidden bg-vx-scrim max-[720px]:block" onClick={() => setDrawer(false)} aria-hidden /> : null}
      <div className="vx-content" data-strip={onDrive ? 'true' : 'false'}>
        <main id="vx-main" tabIndex={-1} className={cx('vx-main vx-sheet outline-none', past && !timeless && 'is-past')} data-past={past ? 'true' : undefined}>
          {unverified ? <VerifyBanner email={me.user.email} /> : null}
          <TimeTravelBanner />
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        </main>
        {timelineOpen ? (
          <aside className="vx-timeline vx-sheet" aria-label="History">
            <div className="min-h-0 flex-1 overflow-auto">
              <TimelineRail />
            </div>
          </aside>
        ) : null}
        {panel ? (
          <div className="vx-panel vx-sheet">
            <PanelHost />
          </div>
        ) : null}
        {onDrive ? (
          <div className={cx('vx-strip vx-sheet', past && 'is-past')}>
            <TimeStrip />
          </div>
        ) : null}
      </div>
      {onDrive ? <NewFab /> : null}
      <GlobalDropZone />
      <UploadTray />
      <ShareDialog />
      <RestoreDialog />
      <CheckpointDialog />
      <DuplicateDialog />
      <RenameWorkspaceDialog />
      <PeopleDialog />
      <ShortcutSheet open={sheet} onClose={() => setSheet(false)} />
    </div>
  );
}

export default AppShell;

'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import CheckpointDialog from '@/components/versioning/checkpoint-dialog';
import DuplicateDialog from '@/components/workspaces/duplicate-dialog';
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
import { useMe } from '@/lib/api/hooks';
import { useDeepLink } from '@/lib/deep-link';
import { useHotkeys } from '@/lib/keys';
import { endSession } from '@/lib/session';
import { useVx } from '@/lib/store';
import { LeftRail } from './left-rail';
import { NewFab } from './new-button';
import { PanelHost } from './panel-host';
import { ShortcutSheet } from './shortcut-sheet';
import { TopBar } from './top-bar';

/** Routes whose content sits straight on the page instead of in a sheet (DESIGN-v2 §6.17). */
export function isSheetless(pathname: string): boolean {
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
      '?': () => setSheet(true),
      'g d': () => router.push('/drive'),
      'g c': () => router.push('/checkpoints'),
      'g x': () => router.push('/recently-deleted'),
      'g p': () => router.push('/proposals'),
      'g ,': () => router.push('/settings'),
    },
    { enabled: !!me },
  );

  if (error && !unauthorized) {
    return (
      <div className="flex h-dvh items-center justify-center bg-vx-bg p-4">
        <div className="vx-sheet w-full max-w-[480px]">
          <EmptyState
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
            <span className="skeleton h-8 w-8 !rounded-vx-sm" />
            <span className="skeleton skel-line w-24" />
          </div>
          <div className="flex justify-center px-2">
            <span className="skeleton h-12 w-full max-w-[720px] !rounded-full" />
          </div>
          <span className="skeleton mx-2 h-8 w-8 !rounded-full" />
        </header>
        <div className="vx-side">
          <span className="skeleton h-14 w-32 !rounded-full" />
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

  // The history strip belongs to the drive only (never on /proposals/**, whose review page is full height).
  const onDrive = pathname === '/drive' || pathname.startsWith('/drive/');
  const sheetless = isSheetless(pathname);
  return (
    <div className="vx-app">
      <TopBar onMenu={() => setDrawer((d) => !d)} onHelp={() => setSheet(true)} />
      <LeftRail open={drawer} onNavigate={() => setDrawer(false)} />
      {drawer ? <div className="dlg-fade fixed inset-0 z-[55] hidden bg-vx-scrim max-[720px]:block" onClick={() => setDrawer(false)} aria-hidden /> : null}
      <div className="vx-content" data-strip={onDrive ? 'true' : 'false'}>
        <main className={cx('vx-main', sheetless ? 'vx-sheetless' : 'vx-sheet', past && !sheetless && 'is-past')} data-past={past ? 'true' : undefined}>
          <TimeTravelBanner />
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        </main>
        {timelineOpen ? (
          <aside className="vx-timeline vx-sheet" aria-label="Timeline">
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
      <ShortcutSheet open={sheet} onClose={() => setSheet(false)} />
    </div>
  );
}

export default AppShell;

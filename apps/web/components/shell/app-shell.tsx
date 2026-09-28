'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu as MenuIcon } from 'lucide-react';
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
import { cx } from '@/components/ui/cx';
import { isApiError } from '@/lib/api/client';
import { useMe } from '@/lib/api/hooks';
import { useHotkeys } from '@/lib/keys';
import { useVx } from '@/lib/store';
import { LeftRail } from './left-rail';
import { PanelHost } from './panel-host';
import { ShortcutSheet } from './shortcut-sheet';

/**
 * The signed-in frame: auth guard (401 → /signin?next=…), grid
 * [LeftRail][main][TimelineRail][PanelHost] + Time Strip on /drive, global keys.
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

  const unauthorized = isApiError(error) && error.status === 401;
  useEffect(() => {
    if (!unauthorized) return;
    const next = typeof window !== 'undefined' ? window.location.pathname + window.location.search : pathname;
    router.replace(`/signin?next=${encodeURIComponent(next)}`);
  }, [unauthorized, router, pathname]);

  useHotkeys(
    {
      h: () => useVx.getState().toggleTimeline(),
      'mod+z': () => void useVx.getState().undoLast(),
      '?': () => setSheet(true),
      'g d': () => router.push('/drive'),
      'g c': () => router.push('/checkpoints'),
      'g x': () => router.push('/recently-deleted'),
      'g ,': () => router.push('/settings'),
    },
    { enabled: !!me },
  );

  if (error && !unauthorized) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4">
        <div className="vx-title">Could not load your drive</div>
        <p className="vx-body text-vx-text-3">{error instanceof Error ? error.message : 'Unknown error'}</p>
        <Button onClick={() => void mutate()}>Retry</Button>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="vx-shell" aria-busy>
        <div className="vx-rail border-r border-vx-hair bg-vx-surface p-4">
          <span className="skeleton skel-line w-24" />
          <span className="skeleton skel-line mt-6 w-40" />
          <span className="skeleton skel-line w-32" />
          <span className="skeleton skel-line w-36" />
        </div>
        <main className="vx-main p-6">
          <span className="skeleton skel-line w-64" />
        </main>
      </div>
    );
  }

  const onDrive = pathname === '/drive' || pathname.startsWith('/drive/');
  return (
    <div className="vx-shell">
      <LeftRail open={drawer} onNavigate={() => setDrawer(false)} />
      <main className={cx('vx-main relative flex min-h-0 min-w-0 flex-col', past && 'is-past')}>
        <button
          type="button"
          aria-label="Open navigation"
          onClick={() => setDrawer((d) => !d)}
          className="absolute left-2 top-2 z-20 hidden h-8 w-8 items-center justify-center text-vx-text-3 max-[720px]:inline-flex"
        >
          <MenuIcon size={16} />
        </button>
        <TimeTravelBanner />
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </main>
      {timelineOpen ? (
        <aside className="vx-timeline min-h-0 overflow-auto border-l border-vx-hair bg-vx-surface" aria-label="Timeline">
          <TimelineRail />
        </aside>
      ) : null}
      {panel ? (
        <div className="vx-panel min-h-0">
          <PanelHost />
        </div>
      ) : null}
      {onDrive ? (
        <div className="vx-strip border-t border-vx-hair bg-vx-surface">
          <TimeStrip />
        </div>
      ) : null}
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

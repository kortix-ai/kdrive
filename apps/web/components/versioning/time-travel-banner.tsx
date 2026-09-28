'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ArrowLeftRight, Bookmark, Clock, Copy, Ellipsis, Link2, RotateCcw } from 'lucide-react';
import useSWR from 'swr';
import type { TimelineEntry } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { isTypingTarget } from '@/lib/keys';
import { actionText, formatTimeTravelLabel } from '@/lib/format';
import { useVx, type TimeTravel } from '@/lib/store';
import { driveCompareHref } from '@/lib/urls';
import { useCommit, useTimelineEntries } from '@/lib/versioning/hooks';
import { jumpCheckpoint, stepEntry, type Target } from '@/lib/versioning/timeline';
import { CheckpointBadge } from './checkpoint-badge';
import { CommitId } from './readout';
import './versioning.css';

/**
 * Amber "you are viewing the past" card at the top of the drive sheet (DESIGN-v2 §6.3), plus the time keys
 * (`,` `.` step, `⇧,` `⇧.` checkpoints, `p` checkpoint, `c` compare with now, `Esc` back to now).
 */
export default function TimeTravelBanner() {
  const tt = useVx((s) => s.timeTravel);
  const timeline = useTimelineEntries();
  useTimeKeys(timeline);
  if (!tt) return null;
  const idx = timeline.entries.findIndex((e) => e.commitId === tt.commitId);
  const entry = idx >= 0 ? timeline.entries[idx] : null;
  const version = idx >= 0 ? `v${timeline.entries.length - idx}` : null;
  return <Banner tt={tt} entry={entry} version={version} />;
}

function Banner({ tt, entry, version }: { tt: NonNullable<TimeTravel>; entry: TimelineEntry | null; version: string | null }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const exit = useVx((s) => s.exitTimeTravel);
  const openRestore = useVx((s) => s.openRestore);
  const openCheckpoint = useVx((s) => s.openCheckpoint);
  const openDuplicate = useVx((s) => s.openDuplicate);
  const openShare = useVx((s) => s.openShare);
  const drivePath = useVx((s) => s.path);
  const { headCommitId } = useTimelineEntries();
  const summary = entry ? actionText(entry.summary, entry.restoredTo) : null;
  const commit = useCommit(summary ? null : tt.commitId);
  const action = commit.data?.action;
  const text = summary ?? (action ? actionText(action.summary, action.restoredTo) : null);
  const onDrive = pathname === '/drive' || pathname.startsWith('/drive/');
  // The drive listing for this frame (same swr key as useListing, read-only here): while it loads,
  // a 2 px amber bar runs along the sheet's top edge; the previous frame stays on screen.
  const ws = useVx((s) => s.workspaceId);
  const frame = useSWR(onDrive && ws ? ['ls', ws, drivePath, tt.commitId] : null, null);
  const loadingFrame = onDrive && frame.isValidating;

  const compare = () => router.push(driveCompareHref(tt.commitId, headCommitId ?? 'head'));
  const restore = () => openRestore({ scope: 'drive', at: tt.commitId });
  const full = format(new Date(tt.createdAt), 'd MMM yyyy, HH:mm');
  const short = formatTimeTravelLabel(tt.createdAt);
  const checkpoints = entry?.checkpoints ?? [];

  const more: MenuItem[] = [
    { id: 'cmp', label: 'Compare with now', icon: <ArrowLeftRight size={18} strokeWidth={1.75} />, kbd: 'C', onSelect: compare },
    { id: 'rst', label: 'Restore drive…', icon: <RotateCcw size={18} strokeWidth={1.75} />, tone: 'past', onSelect: restore },
    { id: 'sep', type: 'separator' },
    { id: 'cp', label: 'Checkpoint this version…', icon: <Bookmark size={18} strokeWidth={1.75} />, kbd: 'P', onSelect: () => openCheckpoint(tt.commitId) },
    { id: 'dup', label: 'Duplicate as new workspace…', icon: <Copy size={18} strokeWidth={1.75} />, onSelect: () => openDuplicate(tt.commitId) },
    { id: 'link', label: 'Copy pinned link to drive…', icon: <Link2 size={18} strokeWidth={1.75} />, onSelect: () => openShare('/') },
  ];

  return (
    <div className="relative shrink-0 px-3 pt-3">
      {loadingFrame ? <span className="vxv-progress" aria-hidden /> : null}
      <div
        role="status"
        aria-live="polite"
        className="vxv-banner flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-vx-md bg-vx-past-wash py-3 pl-4 pr-3 shadow-[inset_0_0_0_1px_var(--vx-past-edge)] max-[720px]:flex-nowrap max-[720px]:py-2 max-[720px]:pl-3 max-[720px]:pr-2"
      >
        <span
          aria-hidden
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-vx-surface text-vx-past shadow-[inset_0_0_0_1px_var(--vx-past-edge)] max-[720px]:h-8 max-[720px]:w-8"
        >
          <Clock size={18} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-[1_1_360px] max-[720px]:flex-1">
          <p className="text-[15px] font-semibold leading-5 tracking-[-0.005em] text-vx-past-strong" title={new Date(tt.createdAt).toString()}>
            <span className="max-[720px]:hidden">Viewing your drive as it was on </span>
            <span className="hidden max-[720px]:inline">Viewing </span>
            <span className="tabular-nums max-[720px]:hidden">{full}</span>
            <span className="hidden tabular-nums max-[720px]:inline">{short}</span>
          </p>
          <p className="vx-meta mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-vx-past max-[720px]:hidden">
            {version ? <span className="tabular-nums">{version}</span> : null}
            {version ? <span aria-hidden>·</span> : null}
            <CommitId id={tt.commitId} />
            {text ? (
              <>
                <span aria-hidden>·</span>
                <span className="min-w-0 max-w-[320px] truncate" title={text}>
                  {text}
                </span>
              </>
            ) : null}
            {checkpoints.map((c) => (
              <CheckpointBadge key={c.id} name={c.name} className="max-w-[180px]" />
            ))}
          </p>
          <p className="vx-meta text-vx-past max-[720px]:hidden">Read-only. Restore, or go back to now to make changes.</p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="sm" kbd="C" onClick={compare} className="max-[720px]:hidden">
            Compare with now
          </Button>
          <Button variant="restore" size="sm" onClick={restore} className="max-[720px]:hidden">
            Restore drive…
          </Button>
          <Menu
            align="end"
            items={more}
            trigger={(p) => (
              <IconButton {...p} size="sm" label="More actions for this version" className="!text-vx-past hover:!bg-vx-surface">
                <Ellipsis size={18} strokeWidth={1.75} aria-hidden />
              </IconButton>
            )}
          />
          <Button variant="primary" size="sm" kbd="Esc" onClick={exit}>
            Back to now
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Global time keys. Esc only returns to now when nothing closer (menu, dialog, panel, selection) wants it. */
function useTimeKeys(timeline: ReturnType<typeof useTimelineEntries>) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const ref = useRef({ timeline, pathname, router });
  ref.current = { timeline, pathname, router };

  useEffect(() => {
    const go = (t: Target) => {
      const s = useVx.getState();
      if (t === 'now') s.exitTimeTravel();
      else if (t) s.enterTimeTravel(t);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const s = useVx.getState();
      if (!s.me || s.restore || s.checkpoint || s.duplicate || s.share) return;
      if (document.querySelector('[role="dialog"],[role="menu"]')) return;
      const { timeline: tl, pathname: path, router: r } = ref.current;
      const onCompare = path.startsWith('/compare');
      const current = s.timeTravel?.commitId ?? null;
      const comma = e.code === 'Comma' || e.key === ',' || e.key === '<';
      const period = e.code === 'Period' || e.key === '.' || e.key === '>';

      if (comma || period) {
        if (onCompare) return;
        e.preventDefault();
        const dir = comma ? 'older' : 'newer';
        const t = e.shiftKey ? jumpCheckpoint(tl.entries, current, dir) : stepEntry(tl.entries, current, dir);
        if (t === null && dir === 'older' && tl.hasMore) tl.loadMore();
        go(t);
        return;
      }
      if (e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === 'p') {
        e.preventDefault();
        s.openCheckpoint(current);
      } else if (k === 'c' && s.timeTravel && !onCompare) {
        e.preventDefault();
        r.push(driveCompareHref(s.timeTravel.commitId, tl.headCommitId ?? 'head'));
      } else if (e.key === 'Escape' && s.timeTravel && !onCompare) {
        if (s.panel || s.selection.length) return; // closer layers first
        e.preventDefault();
        s.exitTimeTravel();
      }
    };
    // Capture phase: this handler decides first and only claims a key when nothing closer wants it
    // (open dialog/menu, panel, selection), so it layers cleanly with the drive's own keys.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

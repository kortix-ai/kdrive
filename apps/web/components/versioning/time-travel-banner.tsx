'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeftRight, Clock, Copy, Diamond, Ellipsis, Link2, RotateCcw } from 'lucide-react';
import useSWR from 'swr';
import type { TimelineEntry } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { isTypingTarget } from '@/lib/keys';
import { actionText, formatMoment } from '@/lib/format';
import { useVx, type TimeTravel } from '@/lib/store';
import { driveCompareHref } from '@/lib/urls';
import { useCommit, useTimelineEntries } from '@/lib/versioning/hooks';
import { jumpCheckpoint, stepEntry, type Target } from '@/lib/versioning/timeline';
import { CheckpointBadge } from './checkpoint-badge';
import { CommitId } from './readout';
import './versioning.css';

/**
 * The past band at the top of the work sheet (UNIFY-SPEC §12.2; behaviour DESIGN-v2 §6.3), plus the time keys
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
  const driveName = useVx((s) => s.me?.workspaces.find((w) => w.id === s.workspaceId)?.name) ?? 'My Drive';
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
  const full = formatMoment(tt.createdAt);
  const short = formatMoment(tt.createdAt, { weekday: false });
  const checkpoints = entry?.checkpoints ?? [];

  const more: MenuItem[] = [
    { id: 'cmp', label: 'Compare with now', icon: <ArrowLeftRight size={16} strokeWidth={1.75} />, kbd: 'C', onSelect: compare },
    { id: 'rst', label: 'Restore drive…', icon: <RotateCcw size={16} strokeWidth={1.75} />, tone: 'past', onSelect: restore },
    { id: 'sep', type: 'separator' },
    { id: 'cp', label: 'Checkpoint this version…', icon: <Diamond size={16} strokeWidth={1.75} />, kbd: 'P', onSelect: () => openCheckpoint(tt.commitId) },
    { id: 'dup', label: 'Duplicate as new drive…', icon: <Copy size={16} strokeWidth={1.75} />, onSelect: () => openDuplicate(tt.commitId) },
    { id: 'link', label: 'Copy pinned link to drive…', icon: <Link2 size={16} strokeWidth={1.75} />, onSelect: () => openShare('/') },
  ];

  // The past band (UNIFY-SPEC §12.2): full width at the top of the work sheet, wash + brass hatch, past-edge rule.
  return (
    <div className="@container relative shrink-0">
      {loadingFrame ? <span className="vxv-progress" aria-hidden /> : null}
      <div
        role="status"
        aria-live="polite"
        className="vxv-banner vxv-band flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 @max-[720px]:flex-nowrap @max-[720px]:pl-3 @max-[720px]:pr-2"
      >
        <div className="flex min-w-0 flex-[1_1_320px] items-center gap-2.5 @max-[720px]:flex-1">
          <Clock size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-vx-past" />
          <p className="min-w-0 truncate text-[14px] leading-5 text-vx-text-1" title={text ? `${text} · ${new Date(tt.createdAt).toString()}` : new Date(tt.createdAt).toString()}>
            <span className="@max-[720px]:hidden">
              Viewing <span className="font-semibold">{driveName}</span> as it was ·{' '}
            </span>
            <span className="hidden @max-[720px]:inline">Viewing </span>
            <span className="whitespace-nowrap font-mono text-[12.5px] text-vx-past-strong">
              <span className="@max-[720px]:hidden">{full}</span>
              <span className="hidden @max-[720px]:inline">{short}</span>
              {version ? <span className="@max-[720px]:hidden"> · {version}</span> : null}
              <span className="@max-[960px]:hidden">
                {' · '}
                <CommitId id={tt.commitId} className="!text-[1em]" />
              </span>
            </span>
            <span className="sr-only">. Read-only. Restore, or go back to now to make changes.</span>
          </p>
          {checkpoints.map((c) => (
            <CheckpointBadge key={c.id} name={c.name} className="max-w-[160px] @max-[1100px]:hidden" />
          ))}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button variant="restore" size="sm" icon={<RotateCcw size={14} strokeWidth={1.75} aria-hidden />} onClick={restore} className="@max-[720px]:hidden">
            Restore drive…
          </Button>
          <Button variant="outline" size="sm" kbd="C" onClick={compare} className="@max-[960px]:hidden">
            Compare with now
          </Button>
          <Menu
            align="end"
            items={more}
            trigger={(p) => (
              <IconButton {...p} size="sm" label="More actions for this version">
                <Ellipsis size={16} strokeWidth={1.75} aria-hidden />
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

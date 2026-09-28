'use client';

import { forwardRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, Copy, Eye, RotateCcw, Undo2 } from 'lucide-react';
import type { TimelineEntry as Entry } from '@volumes/shared';
import { cx } from '@/components/ui/cx';
import { actionText } from '@/lib/format';
import type { MenuItem } from '@/components/ui/menu';
import { driveCompareHref } from '@/lib/urls';
import { useVx } from '@/lib/store';
import { isRestoreKind, orderPair, plural } from '@/lib/versioning/timeline';
import { Badge, CheckpointBadge } from './checkpoint-badge';
import { CommitId, Delta, When } from './readout';

/** What a timeline entry (rail row or strip tick) can do. Shared by the rail, the strip and the banner. */
export function useEntryActions(headCommitId: string | null) {
  const router = useRouter();
  const enter = useVx((s) => s.enterTimeTravel);
  const exit = useVx((s) => s.exitTimeTravel);

  const open = useCallback(
    (e: Pick<Entry, 'commitId' | 'createdAt' | 'isHead'>) => {
      if (e.isHead) exit();
      else enter({ commitId: e.commitId, createdAt: e.createdAt });
    },
    [enter, exit],
  );

  /** Shift-click: compare the viewed version (or now) with `e`, older first. */
  const compareWithViewed = useCallback(
    (e: Pick<Entry, 'commitId' | 'createdAt'>, entries: Entry[]) => {
      const tt = useVx.getState().timeTravel;
      const head = entries.find((x) => x.isHead);
      const base = tt ?? (head ? { commitId: head.commitId, createdAt: head.createdAt } : null);
      if (!base || base.commitId === e.commitId) return;
      const [a, b] = orderPair(base, e);
      router.push(driveCompareHref(a.commitId, b.commitId));
    },
    [router],
  );

  const compareWithNow = useCallback(
    (commitId: string) => router.push(driveCompareHref(commitId, headCommitId ?? 'head')),
    [router, headCommitId],
  );

  const menuItems = useCallback(
    (e: Entry): MenuItem[] => {
      const s = useVx.getState();
      const items: MenuItem[] = [
        { id: 'open', label: e.isHead ? 'Back to now' : 'Open drive here', icon: <Eye size={14} />, kbd: '↵', onSelect: () => open(e) },
        {
          id: 'compare',
          label: 'Compare with now',
          icon: <ArrowLeftRight size={14} />,
          kbd: 'C',
          disabled: e.isHead,
          reason: 'This is the current version.',
          onSelect: () => compareWithNow(e.commitId),
        },
        { id: 'cp', label: 'Checkpoint here…', icon: <span className="text-vx-accent">◆</span>, kbd: 'P', onSelect: () => s.openCheckpoint(e.commitId) },
        { id: 'sep1', type: 'separator' },
        {
          id: 'restore',
          label: 'Restore drive to here…',
          icon: <RotateCcw size={14} />,
          disabled: e.isHead,
          reason: 'The drive is already at this version.',
          onSelect: () => s.openRestore({ scope: 'drive', at: e.commitId }),
        },
        { id: 'dup', label: 'Duplicate as new workspace…', icon: <Copy size={14} />, onSelect: () => s.openDuplicate(e.commitId) },
      ];
      if (e.isHead && e.undoable && e.actionId) {
        const actionId = e.actionId;
        items.push({ id: 'sep2', type: 'separator' }, { id: 'undo', label: 'Undo this change', icon: <Undo2 size={14} />, kbd: '⌘Z', onSelect: () => void s.undo(actionId) });
      }
      return items;
    },
    [open, compareWithNow],
  );

  return { open, compareWithViewed, compareWithNow, menuItems };
}

/** Node glyph: ◆ checkpointed (purple), ● head, ↺ restore/undo, ○ normal. */
export function EntryGlyph({ e, className }: { e: Pick<Entry, 'checkpoints' | 'isHead' | 'kind'>; className?: string }) {
  if (e.checkpoints.length) return <span className={cx('text-vx-accent', className)}>◆</span>;
  if (e.isHead) return <span className={cx('text-vx-text-1', className)}>●</span>;
  if (isRestoreKind(e.kind)) return <span className={cx('text-vx-text-2', className)}>↺</span>;
  return <span className={cx('text-vx-text-4', className)}>○</span>;
}

export interface TimelineEntryProps {
  entry: Entry;
  selected: boolean;
  viewerEmail: string | null;
  onOpen: (ev: React.MouseEvent | React.KeyboardEvent) => void;
  onMenu: (at: { x: number; y: number }) => void;
}

/** One rail row (52 px): glyph + summary + time; items · delta · @commit · ⋯; merged note. */
export const TimelineEntryRow = forwardRef<HTMLDivElement, TimelineEntryProps>(function TimelineEntryRow(
  { entry: e, selected, viewerEmail, onOpen, onMenu },
  ref,
) {
  const showActor = !!e.actor && !!viewerEmail && e.actor.email.toLowerCase() !== viewerEmail.toLowerCase();
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${actionText(e.summary, e.restoredTo)}, ${new Date(e.createdAt).toLocaleString()}`}
      data-commit={e.commitId}
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          onOpen(ev);
        }
      }}
      onContextMenu={(ev) => {
        ev.preventDefault();
        onMenu({ x: ev.clientX, y: ev.clientY });
      }}
      className={cx(
        'vx-inset-focus group relative flex min-h-[52px] cursor-pointer select-none flex-col justify-center gap-0.5 border-b border-vx-hair-soft px-4 py-1.5 transition-colors duration-[120ms]',
        selected ? 'bg-vx-past-wash shadow-[inset_2px_0_0_var(--vx-past)]' : 'hover:bg-vx-surface-2',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <EntryGlyph e={e} className="w-3.5 shrink-0 text-center font-mono text-[11px]" />
        {/* Line 1 is the change itself; checkpoint names ride on line 2 (the ◆ glyph already marks the row). */}
        <span className="vx-name min-w-0 flex-1 truncate text-vx-text-1" title={actionText(e.summary, e.restoredTo)}>
          {actionText(e.summary, e.restoredTo)}
        </span>
        {e.isHead ? <Badge>Now</Badge> : null}
        <When at={e.createdAt} className="vx-meta shrink-0 text-vx-text-3" />
      </div>
      <div className="flex min-w-0 items-center gap-2 pl-[22px]">
        <span className="vx-meta shrink-0 text-vx-text-3">{plural(e.itemCount, 'item')}</span>
        <span className="vx-meta text-vx-text-4">·</span>
        <Delta n={e.bytesDelta} className="vx-meta shrink-0" />
        {showActor ? <span className="vx-meta truncate text-vx-text-3">· {e.actor?.name || e.actor?.email}</span> : null}
        {e.checkpoints.length ? (
          <CheckpointBadge bare glyph={false} name={e.checkpoints.map((c) => c.name).join(', ')} className="min-w-0 max-w-[50%] shrink" />
        ) : null}
        <span className="flex-1" />
        <CommitId id={e.commitId} className="vx-meta shrink-0 text-vx-text-4" />
        <button
          type="button"
          aria-label="Version actions"
          onClick={(ev) => {
            ev.stopPropagation();
            const r = ev.currentTarget.getBoundingClientRect();
            onMenu({ x: r.right - 220, y: r.bottom + 4 });
          }}
          className="-mr-1 inline-flex h-5 w-5 items-center justify-center font-mono text-[12px] text-vx-text-3 opacity-0 hover:bg-vx-surface-3 hover:text-vx-text-1 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          ⋯
        </button>
      </div>
      {e.mergedCount > 0 ? (
        <div className="vx-micro pl-[22px] text-vx-text-4">includes {plural(e.mergedCount, 'earlier change')}</div>
      ) : null}
    </div>
  );
});

export default TimelineEntryRow;

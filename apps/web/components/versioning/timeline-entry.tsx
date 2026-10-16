'use client';

import { forwardRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, Copy, Diamond, Ellipsis, Eye, RotateCcw, Undo2 } from 'lucide-react';
import type { TimelineEntry as Entry } from '@volumes/shared';
import { AgentBadge } from '@/components/agents/agent-badge';
import { cx } from '@/components/ui/cx';
import { actionText } from '@/lib/format';
import type { MenuItem } from '@/components/ui/menu';
import { driveCompareHref } from '@/lib/urls';
import { useVx } from '@/lib/store';
import { isRestoreKind, orderPair, plural } from '@/lib/versioning/timeline';
import { CheckpointBadge } from './checkpoint-badge';
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
        { id: 'open', label: e.isHead ? 'Back to now' : 'Open drive here', icon: <Eye size={16} strokeWidth={1.75} />, kbd: '↵', onSelect: () => open(e) },
        {
          id: 'compare',
          label: 'Compare with now',
          icon: <ArrowLeftRight size={16} strokeWidth={1.75} />,
          kbd: 'C',
          disabled: e.isHead,
          reason: 'This is the current version.',
          onSelect: () => compareWithNow(e.commitId),
        },
        { id: 'cp', label: 'Checkpoint here…', icon: <Diamond size={16} strokeWidth={1.75} />, kbd: 'P', onSelect: () => s.openCheckpoint(e.commitId) },
        { id: 'sep1', type: 'separator' },
        {
          id: 'restore',
          label: 'Restore drive to here…',
          icon: <RotateCcw size={16} strokeWidth={1.75} />,
          tone: 'past',
          disabled: e.isHead,
          reason: 'The drive is already at this version.',
          onSelect: () => s.openRestore({ scope: 'drive', at: e.commitId }),
        },
        { id: 'dup', label: 'Duplicate as new drive…', icon: <Copy size={16} strokeWidth={1.75} />, onSelect: () => s.openDuplicate(e.commitId) },
      ];
      if (e.isHead && e.undoable && e.actionId) {
        const actionId = e.actionId;
        items.push({ id: 'sep2', type: 'separator' }, { id: 'undo', label: 'Undo this change', icon: <Undo2 size={16} strokeWidth={1.75} />, kbd: '⌘Z', onSelect: () => void s.undo(actionId) });
      }
      return items;
    },
    [open, compareWithNow],
  );

  return { open, compareWithViewed, compareWithNow, menuItems };
}

/**
 * Node on the rail's spine, drawn like the strip's marks (UNIFY-SPEC §12.3): a tick-dot (normal), ◆ (checkpoint),
 * the accent head disc, a hollow ring (restore / undo); the viewed version is the cobalt grip ring.
 * Each node sits on a 3 px surface gap so the spine never runs through it.
 */
export function EntryNode({ e, viewed, className }: { e: Pick<Entry, 'checkpoints' | 'isHead' | 'kind'>; viewed?: boolean; className?: string }) {
  let cls: string;
  if (viewed) cls = 'h-3 w-3 rounded-full bg-vx-surface shadow-[inset_0_0_0_2.5px_var(--vx-past-dot)]';
  else if (e.checkpoints.length) cls = 'h-2 w-2 rotate-45 bg-vx-text-1 shadow-[0_0_0_3px_var(--vx-surface)]';
  else if (e.isHead) cls = 'h-2.5 w-2.5 rounded-full bg-vx-accent shadow-[0_0_0_3px_var(--vx-surface)]';
  else if (isRestoreKind(e.kind)) cls = 'h-2 w-2 rounded-full bg-vx-surface shadow-[inset_0_0_0_1.5px_var(--vx-text-2),0_0_0_3px_var(--vx-surface)]';
  else cls = 'h-1.5 w-1.5 rounded-full bg-vx-tick shadow-[0_0_0_3px_var(--vx-surface)]';
  return <span aria-hidden className={cx('relative z-[1] block shrink-0', cls, className)} />;
}

export interface TimelineEntryProps {
  entry: Entry;
  selected: boolean;
  viewerEmail: string | null;
  onOpen: (ev: React.MouseEvent | React.KeyboardEvent) => void;
  onMenu: (at: { x: number; y: number }) => void;
}

/**
 * One rail entry (UNIFY-SPEC §12.3; behaviour DESIGN-v2 §6.4): r4, a 32 px node column on the 1 px spine;
 * line 1 summary (Inter 14/500, up to two lines), line 2 Mono time · items · delta · @commit; ◆ checkpoint badges; merged note.
 */
export const TimelineEntryRow = forwardRef<HTMLDivElement, TimelineEntryProps>(function TimelineEntryRow(
  { entry: e, selected, viewerEmail, onOpen, onMenu },
  ref,
) {
  const showActor = !!e.actor && !!viewerEmail && e.actor.email.toLowerCase() !== viewerEmail.toLowerCase();
  const text = actionText(e.summary, e.restoredTo);
  return (
    <div className="relative">
      {/* the continuous line through the node column */}
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-[27.5px] w-px bg-vx-hair" />
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`${text}, ${new Date(e.createdAt).toLocaleString()}`}
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
          'vx-inset-focus group relative grid cursor-pointer select-none grid-cols-[32px_minmax(0,1fr)] rounded-vx-sm py-2 pl-3 pr-2 transition-colors duration-[120ms]',
          selected ? 'bg-vx-past-wash shadow-[inset_0_0_0_1px_var(--vx-past-edge)]' : 'hover:bg-vx-raise',
        )}
      >
        <span className="flex h-5 items-center justify-center">
          <EntryNode e={e} viewed={selected} />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-start gap-2">
            <span className={cx('vx-ui line-clamp-2 min-w-0 flex-1 break-words', selected ? 'text-vx-past-strong' : 'text-vx-text-1')} title={text}>
              {text}
            </span>
            <button
              type="button"
              aria-label="Version actions"
              onClick={(ev) => {
                ev.stopPropagation();
                const r = ev.currentTarget.getBoundingClientRect();
                onMenu({ x: r.right - 240, y: r.bottom + 4 });
              }}
              className="-my-1 -mr-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded-vx-sm text-vx-text-2 hover:bg-vx-pressed hover:text-vx-text-1 group-hover:inline-flex group-focus-within:inline-flex"
            >
              <Ellipsis size={16} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
          {e.checkpoints.length ? (
            <div className="mt-1 flex min-w-0 flex-wrap gap-1">
              {e.checkpoints.map((c) => (
                <CheckpointBadge key={c.id} name={c.name} className="max-w-full" />
              ))}
            </div>
          ) : null}
          {/* Mono meta: when · items · delta · @commit; wraps whole segments (a trailing dot) rather than clipping. */}
          <div className={cx('vx-meta mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5', selected ? 'text-vx-past' : 'text-vx-text-3')}>
            {e.agent ? <AgentBadge agent={e.agent} className="min-w-0 max-w-[45%]" /> : null}
            <span className="inline-flex shrink-0 items-center gap-1.5">
              <When at={e.createdAt} />
              <span aria-hidden>·</span>
            </span>
            {/* One item is already named in the title; counts only matter for batches. */}
            {e.itemCount !== 1 ? (
              <span className="inline-flex shrink-0 items-center gap-1.5">
                {plural(e.itemCount, 'item')}
                <span aria-hidden>·</span>
              </span>
            ) : null}
            <span className="inline-flex shrink-0 items-center gap-1.5">
              <Delta n={e.bytesDelta} />
              <span aria-hidden>·</span>
            </span>
            <CommitId id={e.commitId} className="shrink-0" />
            {showActor ? <span className="min-w-0 truncate">· {e.actor?.name || e.actor?.email}</span> : null}
          </div>
          {e.mergedCount > 0 ? <div className="vx-micro mt-0.5 text-vx-text-3">includes {plural(e.mergedCount, 'earlier change')}</div> : null}
        </div>
      </div>
    </div>
  );
});

export default TimelineEntryRow;

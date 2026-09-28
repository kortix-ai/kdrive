'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { ContextMenu, type MenuItem } from '@/components/ui/menu';
import { cx } from '@/components/ui/cx';
import { useVx } from '@/lib/store';
import { errorText, useTimelineEntries } from '@/lib/versioning/hooks';
import { groupByDay, matchesFilter, TIMELINE_FILTERS, type TimelineFilter } from '@/lib/versioning/timeline';
import { RetentionNote } from './retention-note';
import { TimelineEntryRow, useEntryActions } from './timeline-entry';
import './versioning.css';

/** Right rail (320 px, `h`): the drive's history, newest first, grouped by day. Click = view the drive then. */
export default function TimelineRail() {
  const open = useVx((s) => s.timelineOpen);
  if (!open) return null;
  return <Rail />;
}

function Rail() {
  const toggle = useVx((s) => s.toggleTimeline);
  const viewed = useVx((s) => s.timeTravel?.commitId ?? null);
  const viewerEmail = useVx((s) => s.me?.user.email ?? null);
  const { entries, headCommitId, hasMore, loadMore, loadingMore, isLoading, error, retry } = useTimelineEntries();
  const actions = useEntryActions(headCommitId);
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const shown = useMemo(() => entries.filter((e) => matchesFilter(e, filter)), [entries, filter]);
  const groups = useMemo(() => groupByDay(shown), [shown]);

  // Infinite scroll: load older pages when the sentinel comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((xs) => xs.some((x) => x.isIntersecting) && loadMore(), { root: listRef.current, rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore, shown.length]);

  // Keep the viewed entry in view.
  useEffect(() => {
    const key = viewed ?? entries.find((e) => e.isHead)?.commitId;
    if (key) rowRefs.current.get(key)?.scrollIntoView({ block: 'nearest' });
  }, [viewed, entries]);

  const headEntry = entries.find((e) => e.isHead);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-vx-hair pl-4 pr-2">
        <span className="vx-label text-vx-text-2">History</span>
        <button
          type="button"
          aria-label="Close history (H)"
          title="Close history (H)"
          onClick={() => toggle(false)}
          className="inline-flex h-7 w-7 items-center justify-center font-mono text-[12px] text-vx-text-3 hover:bg-vx-surface-2 hover:text-vx-text-1"
        >
          ✕
        </button>
      </div>
      <div className="shrink-0 border-b border-vx-hair px-4 py-3">
        <div role="radiogroup" aria-label="Filter history" className="flex flex-wrap">
          {TIMELINE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={filter === f.value}
              aria-label={f.value === 'checkpoints' ? 'Checkpoints' : f.label}
              onClick={() => setFilter(f.value)}
              className={cx(
                '-ml-px -mt-px h-6 border border-vx-hair px-2 font-mono text-[11px] transition-colors duration-[120ms] first:ml-0',
                filter === f.value ? 'relative z-10 border-pt-100 bg-pt-100 text-vx-text-inv' : 'text-vx-text-3 hover:text-vx-text-1',
                f.value === 'checkpoints' && filter !== f.value && 'text-vx-accent',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <RetentionNote className="mt-2.5" />
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" role="list" aria-label="Versions">
        {isLoading ? (
          <div aria-busy className="px-4 py-3">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex h-[52px] flex-col justify-center gap-2 border-b border-vx-hair-soft">
                <span className="skeleton skel-line w-3/4" />
                <span className="skeleton skel-line w-1/2" />
              </div>
            ))}
          </div>
        ) : error && !entries.length ? (
          <div className="flex flex-col items-start gap-3 px-4 py-6">
            <p className="vx-meta text-vx-text-3">Couldn&apos;t load history · {errorText(error)}</p>
            <Button size="sm" onClick={retry}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <div className="pt-band vx-label sticky top-0 z-[1] h-7 bg-vx-surface px-4 text-vx-text-3">{g.label}</div>
                {g.items.map((e) => (
                  <div role="listitem" key={e.id}>
                    <TimelineEntryRow
                      ref={(el) => {
                        if (el) rowRefs.current.set(e.commitId, el);
                        else rowRefs.current.delete(e.commitId);
                      }}
                      entry={e}
                      selected={viewed === e.commitId}
                      viewerEmail={viewerEmail}
                      onOpen={(ev) => (ev.shiftKey ? actions.compareWithViewed(e, entries) : actions.open(e))}
                      onMenu={(at) => setMenu({ at, items: actions.menuItems(e) })}
                    />
                  </div>
                ))}
              </section>
            ))}
            {!shown.length && entries.length ? (
              <div className="px-4 py-6">
                <p className="vx-meta text-vx-text-3">Nothing like that in the loaded history.</p>
                {hasMore ? (
                  <Button size="sm" className="mt-3" onClick={loadMore} loading={loadingMore}>
                    Load older
                  </Button>
                ) : null}
              </div>
            ) : null}
            {hasMore ? (
              <div ref={sentinel} className="flex h-10 items-center justify-center">
                {loadingMore ? <span className="vx-meta text-vx-text-4">Loading older versions…</span> : null}
              </div>
            ) : null}
            {entries.length <= 1 && filter === 'all' ? (
              <EmptyState
                className="py-10"
                title="This is where your drive's history builds up."
                body="Each upload, rename or delete adds a tick."
              />
            ) : null}
            {!hasMore && entries.length > 1 && filter === 'all' ? (
              <p className="vx-micro px-4 py-4 text-vx-text-4">
                {headEntry ? 'That is everything still kept.' : null}
              </p>
            ) : null}
          </>
        )}
      </div>
      <ContextMenu at={menu?.at ?? null} items={menu?.items ?? []} onClose={() => setMenu(null)} />
    </div>
  );
}

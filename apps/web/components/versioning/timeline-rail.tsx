'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { ContextMenu, type MenuItem } from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';
import { useVx } from '@/lib/store';
import { errorText, useTimelineEntries } from '@/lib/versioning/hooks';
import { groupByDay, matchesFilter, TIMELINE_FILTERS, type TimelineFilter } from '@/lib/versioning/timeline';
import { RetentionNote } from './retention-note';
import { TimelineEntryRow, useEntryActions } from './timeline-entry';
import './versioning.css';

/** History rail (320 px sheet, `h`; DESIGN-v2 §6.4): newest first, grouped by day. Click = view the drive then. */
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
      <div className="shrink-0 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="vx-title">History</h2>
          <Tooltip label="Close history" kbd="H" side="left">
            <IconButton label="Close history (H)" nativeTitle={false} size="sm" onClick={() => toggle(false)} className="-mr-1">
              <X size={18} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </Tooltip>
        </div>
        <div role="group" aria-label="Filter history" className="mt-3 flex flex-wrap gap-1.5">
          {TIMELINE_FILTERS.map((f) => (
            <Chip
              key={f.value}
              size="sm"
              on={filter === f.value}
              onClick={() => setFilter(f.value)}
              icon={f.value === 'checkpoints' ? <Bookmark size={16} strokeWidth={1.75} aria-hidden /> : undefined}
            >
              {f.label}
            </Chip>
          ))}
        </div>
        <RetentionNote className="mt-3" />
      </div>
      <div className="h-px shrink-0 bg-vx-hair-soft" />

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" role="list" aria-label="Versions">
        {isLoading ? (
          <div aria-busy className="px-3 py-3">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex h-14 items-start gap-4 pt-2">
                <span className="skeleton h-3 w-3 shrink-0 !rounded-full" />
                <span className="flex flex-1 flex-col">
                  <span className="skeleton skel-line w-3/4" />
                  <span className="skeleton skel-line w-1/2" />
                </span>
              </div>
            ))}
          </div>
        ) : error && !entries.length ? (
          <div className="flex flex-col items-start gap-2 px-3 py-6">
            <p className="vx-body text-vx-text-2">Couldn&apos;t load history</p>
            <p className="vx-meta text-vx-text-3">{errorText(error)}</p>
            <Button size="sm" variant="text" className="-ml-3" onClick={retry}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label} className="relative">
                <div className="sticky top-0 z-[2] bg-vx-surface pb-1.5 pl-11 pt-3 text-[12px] font-semibold leading-4 text-vx-text-2">
                  <span aria-hidden className="absolute inset-y-0 left-[27px] w-0.5 bg-vx-hair-soft" />
                  {g.label}
                </div>
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
              <div className="px-3 py-6">
                <p className="vx-body text-vx-text-3">Nothing like that in the loaded history.</p>
                {hasMore ? (
                  <Button size="sm" className="mt-3" onClick={loadMore} loading={loadingMore}>
                    Load older
                  </Button>
                ) : null}
              </div>
            ) : null}
            {hasMore ? (
              <div ref={sentinel} className="flex h-10 items-center justify-center">
                {loadingMore ? <span className="vx-meta text-vx-text-3">Loading older versions…</span> : null}
              </div>
            ) : null}
            {entries.length <= 1 && filter === 'all' ? (
              <EmptyState className="py-10" title="Your history starts here." body="Each upload, rename or delete adds a version." />
            ) : null}
            {!hasMore && entries.length > 1 && filter === 'all' ? (
              <p className="vx-micro px-3 pb-2 pt-4 text-vx-text-3">{headEntry ? 'That is everything still kept.' : null}</p>
            ) : null}
          </>
        )}
      </div>
      <ContextMenu at={menu?.at ?? null} items={menu?.items ?? []} onClose={() => setMenu(null)} />
    </div>
  );
}

'use client';

// Search palette (UNIFY-SPEC §14.2, DESIGN-v2 §6.15): `/`, ⌘K or the shell's search field open
// it. It expands in place from the field (same left edge, at least 640 wide, r6, shadow-4) over a
// transparent scrim. Results come from api.files.search, debounced 120 ms, at the viewed
// version in the past. ↑↓ move · ↵ open · ⌘↵ reveal in folder · Esc close.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useSWR from 'swr';
import { CircleAlert, Clock, Search } from 'lucide-react';
import { RETENTION_COPY, type TimelineResponse } from '@volumes/shared';
import { Kbd } from '@/components/ui/kbd';
import { isApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { useTimeline } from '@/lib/api/hooks';
import { goToMatches } from '@/lib/drive/goto';
import { actionText, formatMoment } from '@/lib/format';
import { useVx } from '@/lib/store';
import { cx } from '@/components/ui/cx';
import { DriveEmpty } from './empty-drive';
import SearchResults, { type PaletteItem } from './search-results';
import s from './drive.module.css';

/** Where the palette opens: over the shell's search field, at least 640 wide. */
function anchorBox(): { left: number; top: number; width: number } {
  const vw = window.innerWidth;
  const pill = document.querySelector<HTMLElement>('[data-testid="search-pill"]');
  const box = (pill?.closest<HTMLElement>('[role="search"]') ?? pill)?.getBoundingClientRect();
  if (vw <= 720 || !box) return { left: 8, top: box ? box.top : 8, width: vw - 16 };
  const left = Math.max(16, Math.min(box.left, vw - 16 - 640));
  return { left, top: box.top, width: Math.min(Math.max(640, box.width), vw - left - 16) };
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function SearchPalette({
  open,
  onClose,
  onPick,
  rootName,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (it: PaletteItem, reveal: boolean) => void;
  rootName: string;
}) {
  if (!open || typeof document === 'undefined') return null;
  return createPortal(<Palette onClose={onClose} onPick={onPick} rootName={rootName} />, document.body);
}

function Palette({ onClose, onPick, rootName }: { onClose: () => void; onPick: (it: PaletteItem, reveal: boolean) => void; rootName: string }) {
  const ws = useVx((s) => s.workspaceId);
  const tt = useVx((s) => s.timeTravel);
  const at = tt?.commitId ?? null;
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // Placed on the first render (the palette only renders in the browser), so it is visible at its first commit
  // and the field can take focus right away.
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(() => (typeof window === 'undefined' ? null : anchorBox()));
  useLayoutEffect(() => {
    const place = () => setBox(anchorBox());
    place();
    // Focus the field now and again on the next frame. Done here, not in a passive effect, so a dev double-mount's
    // focus restore cannot leave focus on <body> with the palette open.
    input.current?.focus({ preventScroll: true });
    const raf = requestAnimationFrame(() => {
      if (document.activeElement !== input.current) input.current?.focus({ preventScroll: true });
    });
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
    };
  }, []);
  // Esc closes the palette wherever focus is (a click on the backdrop's edge, a tool that stole focus).
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const dq = useDebounced(q.trim(), 120);
  const fileQuery = dq && !dq.startsWith('@') ? dq : '';
  const { data, error, isLoading } = useSWR(ws && fileQuery ? ['search', ws, fileQuery, at] : null, () => api.files.search(ws!, { q: fileQuery, at }), {
    revalidateOnFocus: false,
    keepPreviousData: true,
    shouldRetryOnError: false,
  });
  const timeline = useTimeline();
  const timelineEntries = useMemo(
    () => (timeline.data ?? []).flatMap((p: TimelineResponse) => p.entries).map((e) => ({ commitId: e.commitId, createdAt: e.createdAt, summary: actionText(e.summary, e.restoredTo), isHead: e.isHead })),
    [timeline.data],
  );
  const items: PaletteItem[] = useMemo(() => {
    const gotos = goToMatches(dq, timelineEntries).map((m) => ({ kind: 'goto' as const, entry: m.entry, label: m.label }));
    const files = fileQuery && data ? data.results.map((entry) => ({ kind: 'file' as const, entry })) : [];
    return [...gotos, ...files];
  }, [dq, fileQuery, data, timelineEntries]);

  useEffect(() => setActive(0), [dq]);
  // Closing hands focus back to what had it before the palette opened.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    return () => {
      if (prev && prev !== document.body && prev.isConnected) prev.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    list.current?.querySelector(`#vx-sr-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (i: number, reveal: boolean) => {
    const it = items[i];
    if (!it) return;
    onClose();
    onPick(it, reveal);
  };

  const pending = (q.trim() !== dq || (isLoading && !data)) && !!fileQuery;
  const noResults = !!fileQuery && data && !pending && items.length === 0;

  return (
    <div className="fixed inset-0 z-50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search files"
        className={cx(s.palette, 'vx-pop flex max-h-[min(640px,calc(100dvh-24px))] flex-col overflow-hidden rounded-vx-lg bg-vx-float text-vx-text-2 shadow-vx-4')}
        style={box ?? { left: 0, top: 0, width: 0, visibility: 'hidden' }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            pick(active, e.metaKey || e.ctrlKey);
          }
        }}
      >
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-vx-hair px-4">
          <Search size={16} strokeWidth={1.75} className="shrink-0 text-vx-text-3" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tt ? 'Search names as they were…' : 'Search in Drive'}
            aria-label="Search"
            aria-controls="vx-search-list"
            aria-activedescendant={items.length ? `vx-sr-${active}` : undefined}
            spellCheck={false}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] leading-6 text-vx-text-1 outline-none placeholder:text-vx-text-3 focus-visible:outline-none"
          />
          {tt ? (
            <span
              className={cx(
                s.fadeIn,
                'inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-vx-xs bg-vx-past-wash px-1.5 font-mono text-[11px] font-medium uppercase leading-4 tracking-[.06em] text-vx-past shadow-[inset_0_0_0_1px_var(--vx-past-edge)]',
              )}
            >
              <Clock size={12} strokeWidth={2} aria-hidden />
              At {formatMoment(tt.createdAt)}
            </span>
          ) : (
            <span className="inline-flex h-5 shrink-0 items-center rounded-vx-xs border border-vx-hair-strong px-1.5 font-mono text-[11px] font-medium uppercase leading-4 tracking-[.06em] text-vx-text-3">
              Files
            </span>
          )}
          <Kbd className="max-[720px]:hidden">Esc</Kbd>
        </div>
        <div ref={list} id="vx-search-list" className="min-h-0 flex-1 overflow-auto">
          {!dq ? (
            <div className="px-4 py-5">
              <p className="vx-body text-vx-text-2">Type part of a name. Search looks at names in this drive{tt ? ', as the drive was at that moment' : ''}.</p>
              <p className="vx-micro mt-2 text-vx-text-3">
                Jump in time with <span className="vx-code font-mono text-vx-text-2">@a41f9c2</span>, “yesterday 16:00” or “14 sep”.
              </p>
            </div>
          ) : pending && !items.length ? (
            <div className="px-2 py-2" aria-busy>
              {[48, 36, 42, 30].map((w, i) => (
                <div key={i} className="flex h-10 items-center gap-3 px-3">
                  <span className="skeleton h-5 w-5 shrink-0 !rounded-vx-xs" />
                  <span className="skeleton skel-line" style={{ width: `${w}%` }} />
                </div>
              ))}
            </div>
          ) : error && !items.length ? (
            <div className="m-3 flex items-start gap-2 rounded-vx-sm border border-vx-danger-edge bg-vx-danger-wash px-3 py-2 text-[13px] leading-5 text-vx-danger" role="alert">
              <CircleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
              {isApiError(error, 'version_gone') ? `This version is no longer kept. ${RETENTION_COPY}` : "Search didn't answer. Try again."}
            </div>
          ) : noResults ? (
            <DriveEmpty
              art="search"
              className="py-8"
              title={`No names match “${dq}”.`}
              body="Search looks at names in this drive. In the past, it searches the drive as it was."
            />
          ) : (
            <>
              <SearchResults items={items} query={fileQuery} active={active} onHover={setActive} onPick={(it, reveal) => pick(items.indexOf(it), reveal)} rootName={rootName} />
              {data?.truncated ? <p className="vx-meta px-4 pb-3 text-vx-text-3">Showing the first {data.results.length}</p> : null}
            </>
          )}
        </div>
        <div className="flex h-9 shrink-0 items-center gap-2 border-t border-vx-hair bg-vx-surface-2 px-4 font-mono text-[11px] leading-4 text-vx-text-3 max-[720px]:hidden">
          <span>↑↓ move</span>
          <span aria-hidden>·</span>
          <span>↵ open</span>
          <span aria-hidden>·</span>
          <span>⌘↵ reveal</span>
          <span aria-hidden>·</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}

export default SearchPalette;

'use client';

// Search (DESIGN §6.14): the 280 px field in the top bar opens a palette
// (`/` or ⌘K). Results come from api.files.search, debounced 120 ms, at the
// viewed version in the past. ↑↓ move · ↵ open · ⌘↵ reveal in folder · Esc close.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useSWR from 'swr';
import { Search } from 'lucide-react';
import { RETENTION_COPY, type TimelineResponse } from '@volumes/shared';
import { Kbd } from '@/components/ui/kbd';
import { cx } from '@/components/ui/cx';
import { isApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { useTimeline } from '@/lib/api/hooks';
import { goToMatches } from '@/lib/drive/goto';
import { formatTimeTravelLabel } from '@/lib/format';
import { useVx } from '@/lib/store';
import { DriveEmpty } from './empty-drive';
import SearchResults, { type PaletteItem } from './search-results';

export function SearchField({ onOpen }: { onOpen: () => void }) {
  const tt = useVx((s) => s.timeTravel);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Search files"
      aria-keyshortcuts="/ Meta+K"
      className="flex h-8 w-[280px] min-w-0 shrink items-center gap-2 border border-vx-hair bg-vx-surface-2 px-2.5 text-left transition-colors duration-[120ms] hover:border-vx-hair-strong max-[900px]:w-[180px]"
    >
      <Search size={14} className="shrink-0 text-vx-text-4" aria-hidden />
      <span className={cx('vx-ui min-w-0 flex-1 truncate', tt ? 'text-vx-past' : 'text-vx-text-4')}>
        {tt ? `Search ${formatTimeTravelLabel(tt.createdAt)}` : 'Search files'}
      </span>
      <Kbd>/</Kbd>
    </button>
  );
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
  const dq = useDebounced(q.trim(), 120);
  const fileQuery = dq && !dq.startsWith('@') ? dq : '';
  const { data, error, isLoading } = useSWR(ws && fileQuery ? ['search', ws, fileQuery, at] : null, () => api.files.search(ws!, { q: fileQuery, at }), {
    revalidateOnFocus: false,
    keepPreviousData: true,
    shouldRetryOnError: false,
  });
  const timeline = useTimeline();
  const timelineEntries = useMemo(
    () => (timeline.data ?? []).flatMap((p: TimelineResponse) => p.entries).map((e) => ({ commitId: e.commitId, createdAt: e.createdAt, summary: e.summary, isHead: e.isHead })),
    [timeline.data],
  );
  const items: PaletteItem[] = useMemo(() => {
    const gotos = goToMatches(dq, timelineEntries).map((m) => ({ kind: 'goto' as const, entry: m.entry, label: m.label }));
    const files = fileQuery && data ? data.results.map((entry) => ({ kind: 'file' as const, entry })) : [];
    return [...gotos, ...files];
  }, [dq, fileQuery, data, timelineEntries]);

  useEffect(() => setActive(0), [dq]);
  useEffect(() => {
    input.current?.focus();
    const prev = document.activeElement as HTMLElement | null;
    return () => prev?.focus?.();
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
    <div className="dlg-fade fixed inset-0 z-50 flex items-start justify-center bg-vx-scrim pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search files"
        className="dlg-pop flex max-h-[70vh] w-[640px] max-w-[calc(100vw-32px)] flex-col border border-vx-hair-strong bg-vx-float shadow-[0_24px_64px_-24px_rgba(0,0,0,.7)]"
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
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-vx-hair px-4">
          <Search size={16} className="text-vx-text-4" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tt ? 'Search names as they were…' : 'Search names, @commit or a date…'}
            aria-label="Search"
            aria-controls="vx-search-list"
            aria-activedescendant={items.length ? `vx-sr-${active}` : undefined}
            spellCheck={false}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent font-mono text-[14px] text-vx-text-1 outline-none placeholder:text-vx-text-4"
          />
          {tt ? (
            <span className="vx-label shrink-0 border border-vx-past-edge px-1.5 py-0.5 text-vx-past">At {formatTimeTravelLabel(tt.createdAt)}</span>
          ) : (
            <span className="vx-label shrink-0 border border-vx-hair px-1.5 py-0.5">Files</span>
          )}
        </div>
        <div ref={list} id="vx-search-list" className="min-h-0 flex-1 overflow-auto">
          {!dq ? (
            <div className="px-4 py-6">
              <p className="vx-body text-vx-text-3">Type part of a name. Search looks at names in this workspace{tt ? ', as the drive was at that moment' : ''}.</p>
              <p className="vx-meta mt-2 text-vx-text-4">Jump in time with @a41f9c2, “yesterday 16:00” or “14 sep”.</p>
            </div>
          ) : pending && !items.length ? (
            <div className="space-y-3 px-4 py-4" aria-busy>
              {[48, 36, 42, 30].map((w, i) => (
                <span key={i} className="skeleton skel-line" style={{ width: `${w}%` }} />
              ))}
            </div>
          ) : error && !items.length ? (
            <p className="vx-meta px-4 py-6 text-vx-danger">
              {isApiError(error, 'version_gone') ? `This version is no longer kept. ${RETENTION_COPY}` : "Search didn't answer. Try again."}
            </p>
          ) : noResults ? (
            <DriveEmpty
              art="search"
              className="py-8"
              title={`No names match “${dq}”.`}
              body="Search looks at names in this workspace. In the past, it searches the drive as it was."
            />
          ) : (
            <>
              <SearchResults items={items} query={fileQuery} active={active} onHover={setActive} onPick={(it, reveal) => pick(items.indexOf(it), reveal)} rootName={rootName} />
              {data?.truncated ? <p className="vx-meta px-4 pb-3 text-vx-text-4">Showing the first {data.results.length}</p> : null}
            </>
          )}
        </div>
        <div className="vx-micro flex h-8 shrink-0 items-center gap-3 border-t border-vx-hair px-4 text-vx-text-4">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>⌘↵ reveal in folder</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

export default SearchField;

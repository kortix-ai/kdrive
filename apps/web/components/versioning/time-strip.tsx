'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import type { TimelineEntry } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { ContextMenu, Menu, type MenuItem } from '@/components/ui/menu';
import { useVx } from '@/lib/store';
import { errorText, useFileVersions, useTimelineEntries } from '@/lib/versioning/hooks';
import {
  axisDayLabel,
  isRestoreKind,
  nearestTick,
  plural,
  releaseTick,
  retentionBoundary,
  slotWidth,
  stepEntry,
  tickDirection,
  tickHeight,
  timecode,
  tooltipTime,
} from '@/lib/versioning/timeline';
import { CommitId, Delta } from './readout';
import { useEntryActions } from './timeline-entry';
import './versioning.css';

// Lanes (56 px): checkpoint 0–12 · ticks 12–40 (baseline at 26) · axis 40–56.
const CP_LANE = 12;
const TICK_TOP = 12;
const TICK_LANE = 28;
const BASE = TICK_LANE / 2;
const AXIS_TOP = 40;
const PAD_R = 12;
const MAGNET = 8;
const ZONE_RECENT = 'Every version · 7d';
const ZONE_OLD = 'Newest 50 + checkpoints';
const labelW = (s: string, perChar = 6.4) => s.length * perChar + 8;

/**
 * Bottom Time Strip (56 px, /drive only): timecode block, an ordinal track of versions (oldest left,
 * now pinned right) with a draggable brushed-platinum playhead, and the History / Checkpoint / Compare tools.
 */
export default function TimeStrip() {
  const tt = useVx((s) => s.timeTravel);
  const timelineOpen = useVx((s) => s.timelineOpen);
  const toggleTimeline = useVx((s) => s.toggleTimeline);
  const openCheckpoint = useVx((s) => s.openCheckpoint);
  const selection = useVx((s) => s.selection);
  const { entries, headCommitId, hasMore, loadMore, isLoading, error, retry } = useTimelineEntries();
  const actions = useEntryActions(headCommitId);

  const ordered = useMemo(() => [...entries].reverse(), [entries]);
  const headEntry = entries.find((e) => e.isHead) ?? null;

  // ── geometry ────────────────────────────────────────────────────────────
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackW, setTrackW] = useState(0);
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTrackW(el.clientWidth));
    ro.observe(el);
    setTrackW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const n = ordered.length;
  const slot = slotWidth(Math.max(0, trackW - PAD_R), n);
  const contentW = Math.max(trackW, n * slot + PAD_R);
  const offset = contentW - PAD_R - n * slot;
  const xs = useMemo(() => ordered.map((_, i) => offset + i * slot + slot / 2), [ordered, offset, slot]);
  const nowX = contentW - PAD_R / 2;
  const viewedIdx = tt ? ordered.findIndex((e) => e.commitId === tt.commitId) : -1;

  // ── scroll: start at the right, keep the right edge anchored while older pages prepend ──
  const rightGap = useRef(0);
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, el.scrollWidth - el.clientWidth - rightGap.current);
  }, [contentW]);
  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    rightGap.current = el.scrollWidth - el.scrollLeft - el.clientWidth;
    if (el.scrollLeft < 200 && hasMore) loadMore();
  };
  useEffect(() => {
    const el = trackRef.current;
    if (!el || viewedIdx < 0 || dragRef.current) return;
    const x = xs[viewedIdx];
    if (x < el.scrollLeft + 24 || x > el.scrollLeft + el.clientWidth - 24) {
      el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
      rightGap.current = el.scrollWidth - el.scrollLeft - el.clientWidth;
    }
  }, [viewedIdx, xs]);

  // ── new versions stamp in ───────────────────────────────────────────────
  const ws = useVx((s) => s.workspaceId);
  const prevHead = useRef<{ ws: string | null; id: string } | null>(null);
  const [stamp, setStamp] = useState<{ id: string; n: number } | null>(null);
  useEffect(() => {
    if (!headCommitId) return;
    const prev = prevHead.current;
    if (prev && prev.ws === ws && prev.id !== headCommitId) setStamp((s) => ({ id: headCommitId, n: (s?.n ?? 0) + 1 }));
    else if (prev && prev.ws !== ws) setStamp(null); // a workspace switch is not a new version
    prevHead.current = { ws, id: headCommitId };
  }, [headCommitId, ws]);
  // The flash + tick growth play once per new version, not again when leaving the past.
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (!stamp) return;
    setFlashing(true);
    const t = setTimeout(() => setFlashing(false), 450);
    return () => clearTimeout(t);
  }, [stamp]);

  // ── leaving the past: the playhead glides to the right edge (its only animated move) ──
  const [gliding, setGliding] = useState(false);
  const wasPast = useRef(!!tt);
  useEffect(() => {
    if (wasPast.current && !tt) {
      setGliding(true);
      const t = setTimeout(() => setGliding(false), 240);
      wasPast.current = false;
      return () => clearTimeout(t);
    }
    wasPast.current = !!tt;
  }, [tt]);

  // ── go to a tick ────────────────────────────────────────────────────────
  const goIdx = useCallback(
    (i: number) => {
      const e = ordered[i];
      if (e) actions.open(e);
    },
    [ordered, actions],
  );

  // ── drag the playhead (snaps to ticks within 8 px; fetch on snap, debounced 120 ms) ──
  const dragRef = useRef<{ pointerId: number } | null>(null);
  const [dragX, setDragX] = useState<number | null>(null);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSnap = useRef(-1);
  const contentX = (clientX: number) => {
    const el = trackRef.current!;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(contentW, clientX - r.left + el.scrollLeft));
  };
  const onDragStart = (ev: React.PointerEvent) => {
    if (!n || ev.button !== 0) return;
    ev.preventDefault();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    dragRef.current = { pointerId: ev.pointerId };
    lastSnap.current = -1;
    onDragMove(ev);
  };
  const onDragMove = (ev: React.PointerEvent) => {
    if (!dragRef.current) return;
    const x = contentX(ev.clientX);
    const snapped = nearestTick(xs, x, MAGNET);
    setDragX(snapped >= 0 ? xs[snapped] : x);
    if (snapped >= 0 && snapped !== lastSnap.current) {
      lastSnap.current = snapped;
      if (snapTimer.current) clearTimeout(snapTimer.current);
      snapTimer.current = setTimeout(() => goIdx(snapped), 120);
    }
  };
  const onDragEnd = (ev: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (snapTimer.current) clearTimeout(snapTimer.current);
    const x = contentX(ev.clientX);
    const i = x >= nowX - MAGNET ? n - 1 : releaseTick(xs, x, MAGNET);
    setDragX(null);
    if (i >= 0) goIdx(i);
  };
  useEffect(() => () => void (snapTimer.current && clearTimeout(snapTimer.current)), []);

  const onGripKey = (ev: React.KeyboardEvent) => {
    const s = useVx.getState();
    const cur = s.timeTravel?.commitId ?? null;
    let t: ReturnType<typeof stepEntry> = null;
    if (ev.key === 'ArrowLeft') t = stepEntry(entries, cur, 'older');
    else if (ev.key === 'ArrowRight') t = stepEntry(entries, cur, 'newer');
    else if (ev.key === 'End') t = 'now';
    else if (ev.key === 'Home') {
      const oldest = ordered[0];
      t = oldest && !oldest.isHead ? { commitId: oldest.commitId, createdAt: oldest.createdAt } : null;
    } else return;
    ev.preventDefault();
    ev.stopPropagation();
    if (t === 'now') s.exitTimeTravel();
    else if (t) s.enterTimeTravel(t);
    else if (ev.key === 'ArrowLeft' && hasMore) loadMore();
  };

  // ── tooltip + menu ──────────────────────────────────────────────────────
  const [hover, setHover] = useState<{ e: TimelineEntry; rect: DOMRect } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastShown = useRef(0);
  const showTip = (e: TimelineEntry, el: HTMLElement) => {
    if (dragRef.current) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    const rect = el.getBoundingClientRect();
    const delay = Date.now() - lastShown.current < 300 ? 0 : 400;
    hoverTimer.current = setTimeout(() => setHover({ e, rect }), delay);
  };
  const hideTip = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (hover) lastShown.current = Date.now();
    setHover(null);
  };
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);

  // ── file lens: one selected file → its versions stay bright, the rest dim ──
  const lensPath = selection.length === 1 ? selection[0] : null;
  const lens = useFileVersions(lensPath);
  const lensSet = useMemo(() => {
    const vs = lens.data?.versions;
    return vs && vs.length ? new Set(vs.map((v) => v.commitId)) : null;
  }, [lens.data]);

  // ── axis: day dividers + retention zone ─────────────────────────────────
  const boundary = retentionBoundary(ordered);
  const zones = useMemo(() => {
    const out: { x: number; text: string; align: 'left' | 'right' }[] = [];
    if (!n) return out;
    if (boundary > 0) {
      const bx = offset + boundary * slot;
      out.push({ x: bx - 4, text: ZONE_OLD, align: 'right' }, { x: bx + 4, text: ZONE_RECENT, align: 'left' });
    } else {
      const text = boundary === 0 ? ZONE_RECENT : ZONE_OLD;
      const w = labelW(text);
      out.push(offset > w + 12 ? { x: offset - 8, text, align: 'right' } : { x: offset + 4, text, align: 'left' });
    }
    return out;
  }, [n, boundary, offset, slot]);
  const days = useMemo(() => {
    const out: { x: number; label: string | null }[] = [];
    const taken = zones.map((z) => (z.align === 'left' ? [z.x, z.x + labelW(z.text)] : [z.x - labelW(z.text), z.x]));
    let lastLabelEnd = -Infinity;
    for (let i = 1; i < n; i++) {
      const a = new Date(ordered[i - 1].createdAt);
      const b = new Date(ordered[i].createdAt);
      if (format(a, 'yyyy-MM-dd') === format(b, 'yyyy-MM-dd')) continue;
      const x = offset + i * slot;
      const label = axisDayLabel(b);
      const span: [number, number] = [x + 3, x + 3 + labelW(label, 6.2)];
      const clash = span[0] < lastLabelEnd || taken.some(([l, r]) => span[0] < r && span[1] > l) || span[1] > contentW;
      out.push({ x, label: clash ? null : label });
      if (!clash) lastLabelEnd = span[1] + 6;
    }
    return out;
  }, [ordered, n, offset, slot, zones, contentW]);

  // ── checkpoint lane labels (hidden when they would collide) ─────────────
  const cps = useMemo(() => {
    const idx = ordered.map((e, i) => (e.checkpoints.length ? i : -1)).filter((i) => i >= 0);
    return idx.map((i, k) => {
      const name = ordered[i].checkpoints.map((c) => c.name).join(', ');
      const nextX = k + 1 < idx.length ? xs[idx[k + 1]] : contentW;
      return { i, x: xs[i], name, showLabel: nextX - xs[i] - 10 > labelW(name, 6.3) };
    });
  }, [ordered, xs, contentW]);

  const playX = dragX ?? (tt ? (viewedIdx >= 0 ? xs[viewedIdx] : Math.max(0, offset - 4)) : nowX);
  const past = !!tt || (dragX !== null && dragX < nowX - MAGNET);
  const viewedEntry = viewedIdx >= 0 ? ordered[viewedIdx] : null;
  const shownCommit = tt?.commitId ?? headCommitId;
  const ordinal = shownCommit ? ordered.findIndex((e) => e.commitId === shownCommit) + 1 : 0;
  const code = tt ? timecode(tt.createdAt) : headEntry ? timecode(headEntry.createdAt) : timecode(new Date());

  const tools: MenuItem[] = [
    { id: 'h', label: timelineOpen ? 'Hide history' : 'History', kbd: 'H', onSelect: () => toggleTimeline() },
    { id: 'p', label: 'Checkpoint…', kbd: 'P', icon: <span className="text-vx-accent">◆</span>, onSelect: () => openCheckpoint(tt?.commitId ?? null) },
    {
      id: 'c',
      label: 'Compare with now',
      kbd: 'C',
      disabled: !tt,
      reason: 'Pick a past version first.',
      onSelect: () => tt && actions.compareWithNow(tt.commitId),
    },
  ];

  return (
    <div className="flex h-full min-w-0 select-none" aria-label="Time strip">
      {/* timecode block */}
      <div className="flex w-[216px] shrink-0 flex-col justify-center gap-0.5 border-r border-vx-hair px-4 max-[720px]:w-[132px] max-[720px]:px-3">
        <span className={cx('vx-label', tt ? 'text-vx-past' : 'text-vx-text-3')}>{tt ? 'Viewing' : 'Now'}</span>
        <span className={cx('vx-title truncate uppercase tabular-nums max-[720px]:text-[12px]', tt ? '!text-vx-past' : 'text-vx-text-1')} title={code}>
          {code}
        </span>
        <span key={stamp?.n ?? 0} className={cx('vx-meta w-fit truncate text-vx-text-3 max-[720px]:hidden', flashing && !tt && 'vxv-stamp')}>
          {shownCommit ? <CommitId id={shownCommit} /> : '—'}
          {ordinal > 0 ? <span className="text-vx-text-4"> · v{ordinal}</span> : null}
        </span>
      </div>

      {/* track */}
      <div
        ref={trackRef}
        onScroll={onScroll}
        onWheel={(e) => {
          const el = trackRef.current;
          if (el && Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY;
        }}
        className="vxv-noscroll relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
      >
        <div className="relative h-full" style={{ width: contentW }}>
          {isLoading ? (
            <div aria-busy aria-label="Loading history">
              {Array.from({ length: 24 }, (_, i) => (
                <span key={i} className="skeleton absolute w-[2px]" style={{ left: contentW - PAD_R - 8 - i * 16, top: TICK_TOP + BASE - 5, height: 10 }} />
              ))}
            </div>
          ) : error && !n ? (
            <div className="absolute inset-0 flex items-center gap-3 px-4">
              <span className="vx-meta text-vx-text-3">Couldn&apos;t load history · {errorText(error)}</span>
              <button type="button" onClick={retry} className="vx-meta text-vx-text-1 underline decoration-vx-hair-strong underline-offset-2 hover:decoration-vx-text-1">
                Retry
              </button>
            </div>
          ) : (
            <>
              {/* the future you are "before" */}
              {past ? <div className="vx-hatch pointer-events-none absolute inset-y-0" style={{ left: playX, width: Math.max(0, contentW - playX) }} /> : null}

              {/* day dividers */}
              {days.map((d) => (
                <div key={d.x} className="pointer-events-none absolute inset-y-0 w-px bg-vx-hair" style={{ left: d.x }}>
                  {d.label ? (
                    <span className="vx-micro absolute left-[3px] whitespace-nowrap uppercase text-vx-text-4" style={{ top: AXIS_TOP + 1 }}>
                      {d.label}
                    </span>
                  ) : null}
                </div>
              ))}

              {/* retention zone boundary + labels */}
              {boundary > 0 ? (
                <div className="pointer-events-none absolute inset-y-0 border-l border-dashed border-vx-hair-dash" style={{ left: offset + boundary * slot }} />
              ) : null}
              {zones.map((z) => (
                <span
                  key={z.text}
                  className="vx-label pointer-events-none absolute whitespace-nowrap !text-[9px] !tracking-[0.14em] text-vx-text-4"
                  style={{ top: AXIS_TOP + 2, ...(z.align === 'left' ? { left: z.x } : { right: contentW - z.x }) }}
                >
                  {z.text}
                </span>
              ))}

              {/* checkpoint lane */}
              {cps.map((c) => (
                <span key={c.i} className="pointer-events-none absolute flex items-center gap-1 whitespace-nowrap" style={{ left: c.x - 3.5, top: 1, height: CP_LANE - 1 }}>
                  <span className="text-[7px] leading-none text-vx-accent">◆</span>
                  {c.showLabel ? <span className="vx-micro !text-[9.5px] leading-none text-vx-text-3">{c.name}</span> : null}
                </span>
              ))}

              {/* ticks */}
              {ordered.map((e, i) => {
                const { h, cap } = tickHeight(e.bytesDelta);
                const dir = tickDirection(e.bytesDelta);
                const top = dir === 'up' ? BASE - h : dir === 'down' ? BASE : BASE - 2;
                const selected = i === viewedIdx;
                const dim = lensSet && !lensSet.has(e.commitId);
                const lensHit = lensSet?.has(e.commitId);
                const isNew = flashing && stamp?.id === e.commitId;
                return (
                  <button
                    key={e.id}
                    type="button"
                    tabIndex={-1}
                    aria-label={`${e.summary}, ${new Date(e.createdAt).toLocaleString()}`}
                    onClick={(ev) => (ev.shiftKey ? actions.compareWithViewed(e, entries) : actions.open(e))}
                    onContextMenu={(ev) => {
                      ev.preventDefault();
                      hideTip();
                      setMenu({ at: { x: ev.clientX, y: ev.clientY }, items: actions.menuItems(e) });
                    }}
                    onMouseEnter={(ev) => showTip(e, ev.currentTarget)}
                    onMouseLeave={hideTip}
                    className={cx(
                      'group absolute outline-none',
                      selected ? 'text-vx-past' : e.isHead ? 'text-vx-text-1' : 'text-vx-text-3 hover:text-vx-text-1',
                    )}
                    style={{ left: xs[i] - slot / 2, width: slot, top: TICK_TOP, height: TICK_LANE, opacity: dim ? 0.3 : 1 }}
                  >
                    {isRestoreKind(e.kind) ? (
                      <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[8px] leading-none" style={{ top: Math.max(0, top - 9) }} aria-hidden>
                        ↺
                      </span>
                    ) : null}
                    <span
                      key={isNew ? `new-${stamp?.n}` : 'tick'}
                      className={cx('absolute left-1/2 -translate-x-1/2 bg-current', isNew && !tt && 'vxv-grow vxv-pulse')}
                      style={{
                        top,
                        height: dir === 'center' ? 4 : h,
                        width: selected ? 3 : 2,
                        transformOrigin: dir === 'down' ? 'top' : 'bottom',
                      }}
                    />
                    {cap ? <span className="absolute left-1/2 h-[2px] w-[6px] -translate-x-1/2 bg-current" style={{ top: dir === 'down' ? top + h - 2 : top }} /> : null}
                    {lensHit ? <span className="absolute left-1/2 h-[3px] w-[3px] -translate-x-1/2 bg-vx-text-1" style={{ top: BASE - 1.5 }} /> : null}
                  </button>
                );
              })}

              {!n ? (
                <span className="vx-meta pointer-events-none absolute whitespace-nowrap text-vx-text-4" style={{ right: PAD_R + 12, top: TICK_TOP + BASE - 8 }}>
                  Workspace created · every change adds a tick here
                </span>
              ) : n === 1 ? (
                <span className="vx-meta pointer-events-none absolute whitespace-nowrap text-vx-text-4" style={{ right: contentW - xs[0] + slot, top: TICK_TOP + BASE - 8 }}>
                  Every upload, rename or delete adds a tick
                </span>
              ) : null}

              {/* axis lane = drag surface */}
              <div
                className="absolute inset-x-0 cursor-ew-resize"
                style={{ top: AXIS_TOP, height: 56 - AXIS_TOP }}
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
              />

              {/* playhead */}
              <div
                className={cx('pointer-events-none absolute inset-y-0 w-px', past ? 'bg-vx-past' : 'bg-vx-text-1', gliding && dragX === null && 'vxv-glide')}
                style={{ left: playX }}
              />
              <div
                role="slider"
                tabIndex={0}
                aria-label="Version playhead"
                aria-valuemin={1}
                aria-valuemax={Math.max(1, n)}
                aria-valuenow={viewedIdx >= 0 ? viewedIdx + 1 : Math.max(1, n)}
                aria-valuetext={tt ? `Viewing ${viewedEntry?.summary ?? ''} ${new Date(tt.createdAt).toLocaleString()}` : 'Now'}
                onKeyDown={onGripKey}
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
                className={cx(
                  'vxv-grip vx-inset-focus absolute cursor-grab active:cursor-grabbing',
                  past && 'is-past',
                  gliding && dragX === null && 'vxv-glide',
                )}
                style={{
                  left: playX - (dragX !== null ? 7 : 6),
                  top: AXIS_TOP + (dragX !== null ? 1 : 2),
                  width: dragX !== null ? 14 : 12,
                  height: dragX !== null ? 14 : 12,
                }}
              />
            </>
          )}
        </div>
      </div>

      {/* tools */}
      <div className="flex shrink-0 items-center gap-1 border-l border-vx-hair px-2 max-[720px]:hidden">
        <Button size="sm" variant={timelineOpen ? 'primary' : 'ghost'} kbd="H" aria-pressed={timelineOpen} onClick={() => toggleTimeline()}>
          History
        </Button>
        <Button size="sm" variant="ghost" kbd="P" icon={<span className="text-vx-accent">◆</span>} onClick={() => openCheckpoint(tt?.commitId ?? null)}>
          Checkpoint
        </Button>
        <Button
          size="sm"
          variant="ghost"
          kbd="C"
          disabled={!tt}
          title={tt ? 'Compare this version with now' : 'Pick a past version to compare with now'}
          onClick={() => tt && actions.compareWithNow(tt.commitId)}
        >
          ⇄ Compare
        </Button>
      </div>
      <div className="hidden shrink-0 items-center border-l border-vx-hair px-1 max-[720px]:flex">
        <Menu
          align="end"
          items={tools}
          trigger={(p) => (
            <button type="button" {...p} aria-label="Time tools" className="inline-flex h-7 w-7 items-center justify-center font-mono text-[12px] text-vx-text-3 hover:bg-vx-surface-2 hover:text-vx-text-1">
              ⋯
            </button>
          )}
        />
      </div>

      {hover ? <TickTooltip e={hover.e} rect={hover.rect} /> : null}
      <ContextMenu at={menu?.at ?? null} items={menu?.items ?? []} onClose={() => setMenu(null)} />
    </div>
  );
}

/** Hover card for a tick (280 px, --vx-float, 8 px above, no arrow). */
function TickTooltip({ e, rect }: { e: TimelineEntry; rect: DOMRect }) {
  if (typeof document === 'undefined') return null;
  const w = 280;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left + rect.width / 2 - w / 2));
  const bottom = window.innerHeight - rect.top + 8;
  return createPortal(
    <div
      role="tooltip"
      className="vxv-fade pointer-events-none fixed z-[70] border border-vx-hair-strong bg-vx-float px-3 py-2.5 shadow-[0_16px_40px_-16px_rgba(0,0,0,.7)]"
      style={{ left, bottom, width: w }}
    >
      <div className="vx-meta uppercase text-vx-text-3">{tooltipTime(e.createdAt)}</div>
      <div className="vx-name mt-1 text-vx-text-1">{e.summary}</div>
      <div className="vx-meta mt-1 text-vx-text-3">
        {plural(e.itemCount, 'item')} · <Delta n={e.bytesDelta} />
      </div>
      {e.paths.length ? (
        <ul className="mt-1.5">
          {e.paths.slice(0, 3).map((p, i) => (
            <li key={i} className="vx-meta truncate text-vx-text-3">
              {p.fromPath ? `${p.fromPath} → ${p.path}` : p.path}
            </li>
          ))}
        </ul>
      ) : null}
      {e.checkpoints.length ? (
        <div className="mt-1.5 flex flex-wrap gap-x-3">
          {e.checkpoints.map((c) => (
            <span key={c.id} className="vx-ui inline-flex items-center gap-1">
              <span className="text-vx-accent">◆</span>
              <span className="vx-metal">{c.name}</span>
            </span>
          ))}
        </div>
      ) : null}
      {e.mergedCount > 0 ? <div className="vx-micro mt-1 text-vx-text-4">includes {plural(e.mergedCount, 'earlier change')}</div> : null}
      <div className="vx-micro mt-2 text-vx-text-4">{e.isHead ? 'This is now · right-click for more' : 'Click to view · right-click for more'}</div>
    </div>,
    document.body,
  );
}

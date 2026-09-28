'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { ArrowLeftRight, Bookmark, ClockFading } from 'lucide-react';
import type { TimelineEntry } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/icon-button';
import { ContextMenu, type MenuItem } from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';
import { actionText } from '@/lib/format';
import { useVx } from '@/lib/store';
import { errorText, useFileVersions, useTimelineEntries } from '@/lib/versioning/hooks';
import {
  axisDayLabel,
  dotSize,
  isRestoreKind,
  nearestTick,
  plural,
  releaseTick,
  retentionBoundary,
  shortTimecode,
  slotWidth,
  stepEntry,
  timecode,
  tooltipTime,
} from '@/lib/versioning/timeline';
import { CheckpointBadge } from './checkpoint-badge';
import { CommitId, Delta } from './readout';
import { useEntryActions } from './timeline-entry';
import './versioning.css';

// Track geometry (72 px): top lane 4–22 (flags, zone labels) · line at 36 · bottom lane 50–66 (days).
const H = 72;
const LINE_Y = 36;
const HIT_TOP = 22;
const HIT_H = 28;
const DAY_Y = 50;
const PAD_L = 16;
const PAD_R = 20;
const MAGNET = 8;
const ZONE_RECENT = 'Every version · 7 days';
const ZONE_OLD = 'Newest 50 + checkpoints';
const textW = (s: string, perChar = 6.1) => s.length * perChar;

/**
 * History strip (DESIGN-v2 §6.4; /drive only): a white 72 px sheet with the Now / Viewing readout,
 * a track of dots on a line (oldest left, now pinned right) with a draggable amber grip in the past,
 * and the History / Checkpoint / Compare tools. On phones it is a floating 56 px pill.
 */
export default function TimeStrip() {
  const tt = useVx((s) => s.timeTravel);
  const timelineOpen = useVx((s) => s.timelineOpen);
  const toggleTimeline = useVx((s) => s.toggleTimeline);
  const openCheckpoint = useVx((s) => s.openCheckpoint);
  const exitTimeTravel = useVx((s) => s.exitTimeTravel);
  const selection = useVx((s) => s.selection);
  const { entries, headCommitId, hasMore, loadMore, isLoading, error, retry } = useTimelineEntries();
  const actions = useEntryActions(headCommitId);
  const rootRef = useRef<HTMLDivElement>(null);

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
  const slot = slotWidth(Math.max(0, trackW - PAD_L - PAD_R), n);
  const contentW = Math.max(trackW, n * slot + PAD_L + PAD_R);
  const offset = contentW - PAD_R - n * slot;
  const xs = useMemo(() => ordered.map((_, i) => offset + i * slot + slot / 2), [ordered, offset, slot]);
  const nowX = n ? xs[n - 1] : contentW - PAD_R;
  const viewedIdx = tt ? ordered.findIndex((e) => e.commitId === tt.commitId) : -1;

  // ── scroll: start at the right, keep the right edge anchored while older pages prepend ──
  const rightGap = useRef(0);
  const [edges, setEdges] = useState({ left: false, right: false });
  const syncEdges = () => {
    const el = trackRef.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollWidth - el.scrollLeft - el.clientWidth > 2 });
  };
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, el.scrollWidth - el.clientWidth - rightGap.current);
    syncEdges();
  }, [contentW]);
  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    rightGap.current = el.scrollWidth - el.scrollLeft - el.clientWidth;
    syncEdges();
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

  // ── new versions: the dot grows in with one halo pulse; the readout @commit highlights ──
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
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (!stamp) return;
    setFlashing(true);
    const t = setTimeout(() => setFlashing(false), 650);
    return () => clearTimeout(t);
  }, [stamp]);

  // ── leaving the past: the grip glides to the head (its only animated move) ──
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

  // ── go to a dot ─────────────────────────────────────────────────────────
  const goIdx = useCallback(
    (i: number) => {
      const e = ordered[i];
      if (e) actions.open(e);
    },
    [ordered, actions],
  );

  // ── drag the grip (snaps to dots within 8 px; enters on snap, debounced 120 ms) ──
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
    hideTip();
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

  // ── hover card + menu ───────────────────────────────────────────────────
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [tip, setTip] = useState<{ e: TimelineEntry; v: number; x: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastShown = useRef(0);
  const showTip = (e: TimelineEntry, v: number, el: HTMLElement) => {
    if (dragRef.current) return;
    setHoverId(e.id);
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const delay = Date.now() - lastShown.current < 300 ? 0 : 400;
    hoverTimer.current = setTimeout(() => setTip({ e, v, x }), delay);
  };
  function hideTip() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (tip) lastShown.current = Date.now();
    setHoverId(null);
    setTip(null);
  }
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);

  // ── file lens: one selected file → its versions stay bright, the rest dim ──
  const lensPath = selection.length === 1 ? selection[0] : null;
  const lens = useFileVersions(lensPath);
  const lensSet = useMemo(() => {
    const vs = lens.data?.versions;
    return vs && vs.length ? new Set(vs.map((v) => v.commitId)) : null;
  }, [lens.data]);

  // ── checkpoint flags (top lane): full badge when there is room, else the bookmark only ──
  const flags = useMemo(() => {
    const out: { i: number; x: number; name: string; full: boolean; l: number; r: number }[] = [];
    let lastRight = -Infinity;
    const idx = ordered.map((e, i) => (e.checkpoints.length ? i : -1)).filter((i) => i >= 0);
    idx.forEach((i, k) => {
      const name = ordered[i].checkpoints.map((c) => c.name).join(', ');
      const x = xs[i];
      const fullW = Math.min(160, textW(name) + 30);
      const nextX = k + 1 < idx.length ? xs[idx[k + 1]] : Infinity;
      // Near the track ends the badge slides inward (its stem stays on the dot) instead of shrinking.
      const fullL = Math.max(2, Math.min(x - fullW / 2, contentW - 2 - fullW));
      const fits = fullL > lastRight + 4 && fullL + fullW < nextX - 14 && fullL <= x - 6 && fullL + fullW >= x + 6;
      const w = fits ? fullW : 22;
      const l = fits ? fullL : x - w / 2;
      out.push({ i, x, name, full: fits, l, r: l + w });
      lastRight = l + w;
    });
    return out;
  }, [ordered, xs, contentW]);

  // ── retention zones: older zone band + dashed boundary, labels in the top lane (flags win) ──
  const boundary = retentionBoundary(ordered);
  const zones = useMemo(() => {
    const out: { text: string; l: number; r: number }[] = [];
    if (!n) return out;
    const startX = offset;
    const bx = boundary > 0 ? offset + boundary * slot : boundary === 0 ? startX : contentW - PAD_R;
    // Each label prefers its spot next to the boundary, else the first gap between flags inside its zone.
    const cands: { text: string; ls: number[]; min: number; max: number }[] = [];
    const gapsIn = (min: number, max: number) => [min + 4, ...flags.filter((f) => f.r > min && f.r < max).map((f) => f.r + 10)];
    if (boundary !== 0) cands.push({ text: ZONE_OLD, ls: [bx - textW(ZONE_OLD) - 8, ...gapsIn(startX, bx)], min: startX, max: bx });
    if (boundary >= 0) cands.push({ text: ZONE_RECENT, ls: [bx + 8, ...gapsIn(bx, contentW - PAD_R)], min: bx, max: contentW - PAD_R + 12 });
    for (const c of cands) {
      const w = textW(c.text);
      for (const l of c.ls) {
        const r = l + w;
        if (l < Math.max(2, c.min) || r > Math.min(contentW - 4, c.max)) continue;
        if (flags.some((f) => l < f.r + 6 && r > f.l - 6)) continue;
        if (out.some((o) => l < o.r + 8 && r > o.l - 8)) continue;
        out.push({ text: c.text, l, r });
        break;
      }
    }
    return out;
  }, [n, boundary, offset, slot, contentW, flags]);
  const oldBand = n && boundary !== 0 ? { l: offset + 2, r: boundary > 0 ? offset + boundary * slot : xs[n - 1] + slot / 2 } : null;

  // ── day ticks and labels (bottom lane) ──────────────────────────────────
  const days = useMemo(() => {
    const out: { x: number; label: string | null; tick: boolean }[] = [];
    if (!n) return out;
    let lastRight = -Infinity;
    const push = (x: number, label: string, tick: boolean, align: 'center' | 'left') => {
      const w = textW(label, 5.8);
      const l = align === 'center' ? x - w / 2 : x;
      const ok = l > lastRight + 8 && l >= 2 && l + w <= contentW - 2;
      out.push({ x: align === 'center' ? x : x + w / 2, label: ok ? label : null, tick });
      if (ok) lastRight = l + w;
    };
    push(offset + 2, axisDayLabel(ordered[0].createdAt), false, 'left');
    for (let i = 1; i < n; i++) {
      const a = new Date(ordered[i - 1].createdAt);
      const b = new Date(ordered[i].createdAt);
      if (format(a, 'yyyy-MM-dd') === format(b, 'yyyy-MM-dd')) continue;
      push(offset + i * slot, axisDayLabel(b), true, 'center');
    }
    return out;
  }, [ordered, n, offset, slot, contentW]);

  const dragging = dragX !== null;
  const playX = dragX ?? (tt ? (viewedIdx >= 0 ? xs[viewedIdx] : Math.max(PAD_L, offset - 6)) : nowX);
  const past = !!tt || (dragging && dragX < nowX - MAGNET);
  const viewedEntry = viewedIdx >= 0 ? ordered[viewedIdx] : null;
  const shownCommit = tt?.commitId ?? headCommitId;
  const ordinal = shownCommit ? ordered.findIndex((e) => e.commitId === shownCommit) + 1 : 0;
  const codeAt = tt ? tt.createdAt : headEntry ? headEntry.createdAt : new Date();
  const version = ordinal > 0 ? (tt ? `v${ordinal} of ${n}` : `v${ordinal}`) : null;

  const history = () => toggleTimeline();
  const checkpoint = () => openCheckpoint(tt?.commitId ?? null);
  const compare = () => tt && actions.compareWithNow(tt.commitId);

  return (
    <div ref={rootRef} className="h-[var(--vx-strip-h)] min-w-0 select-none" aria-label="Time strip">
      {/* ── desktop / tablet ── */}
      <div className="flex h-full min-w-0 items-center pl-5 pr-3 max-[720px]:hidden">
        {/* readout */}
        <div className="flex h-[52px] w-[200px] shrink-0 flex-col justify-center border-r border-vx-hair pr-4">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className={cx(
                'h-2 w-2 shrink-0 rounded-full',
                tt ? 'bg-vx-past-dot shadow-[0_0_0_3px_var(--vx-past-halo)]' : 'bg-vx-ok shadow-[0_0_0_3px_var(--vx-ok-wash)]',
              )}
            />
            <span className={cx('vx-eyebrow', tt && '!text-vx-past')}>{tt ? 'Viewing' : 'Now'}</span>
          </div>
          <span className={cx('truncate text-[14px] font-semibold leading-5 tabular-nums', tt ? 'text-vx-past' : 'text-vx-text-1')} title={new Date(codeAt).toString()}>
            {timecode(codeAt)}
          </span>
          <span className="vx-meta flex min-w-0 items-center gap-1 truncate text-vx-text-3">
            {version ? <span className="shrink-0 tabular-nums">{version}</span> : null}
            {version && shownCommit ? <span aria-hidden>·</span> : null}
            {shownCommit ? (
              <span key={stamp?.n ?? 0} className={cx('-mx-1 rounded-full px-1', flashing && !tt && 'vxv-stamp')}>
                <CommitId id={shownCommit} />
              </span>
            ) : (
              '—'
            )}
          </span>
        </div>

        {/* track */}
        <div className="relative h-full min-w-0 flex-1">
          <div
            ref={trackRef}
            onScroll={onScroll}
            onWheel={(e) => {
              const el = trackRef.current;
              if (el && Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY;
            }}
            className="vxv-noscroll h-full overflow-x-auto overflow-y-hidden"
          >
            <div className="relative" style={{ width: contentW, height: H }}>
              {/* the line */}
              <div className="pointer-events-none absolute h-0.5 rounded-full bg-vx-hair" style={{ left: PAD_L / 2, right: 4, top: LINE_Y - 1 }} />

              {isLoading ? (
                <div aria-busy aria-label="Loading history">
                  {Array.from({ length: 24 }, (_, i) => (
                    <span
                      key={i}
                      className="skeleton absolute h-2 w-2 !rounded-full"
                      style={{ left: contentW - PAD_R - 8 - i * 20, top: LINE_Y - 4 }}
                    />
                  ))}
                </div>
              ) : error && !n ? (
                <div className="absolute inset-0 flex items-center gap-2 bg-vx-surface pl-4">
                  <span className="vx-body text-vx-text-3">Couldn&apos;t load history</span>
                  <span className="vx-meta truncate text-vx-text-4">{errorText(error)}</span>
                  <Button variant="text" size="sm" onClick={retry}>
                    Retry
                  </Button>
                </div>
              ) : (
                <>
                  {/* retention zones */}
                  {oldBand && oldBand.r > oldBand.l ? (
                    <div className="pointer-events-none absolute h-[18px] rounded-full bg-vx-surface-2" style={{ left: oldBand.l, width: oldBand.r - oldBand.l, top: LINE_Y - 9 }} />
                  ) : null}
                  {boundary > 0 ? (
                    <div className="pointer-events-none absolute w-0 border-l border-dashed border-vx-hair-strong" style={{ left: offset + boundary * slot, top: HIT_TOP, height: HIT_H }} />
                  ) : null}
                  {zones.map((z) => (
                    <span key={z.text} className="vx-micro pointer-events-none absolute whitespace-nowrap text-vx-text-4" style={{ left: z.l, top: 4 }}>
                      {z.text}
                    </span>
                  ))}
                  {/* the line again, above the band */}
                  <div className="pointer-events-none absolute h-0.5 rounded-full bg-vx-hair" style={{ left: PAD_L / 2, right: 4, top: LINE_Y - 1 }} />

                  {/* day ticks + labels */}
                  {days.map((d, k) => (
                    <div key={`${k}-${d.x}`}>
                      {d.tick ? <span className="pointer-events-none absolute w-px bg-vx-hair" style={{ left: d.x, top: 26, height: 22 }} /> : null}
                      {d.label ? (
                        <span className="vx-micro pointer-events-none absolute -translate-x-1/2 whitespace-nowrap text-vx-text-4" style={{ left: d.x, top: DAY_Y }}>
                          {d.label}
                        </span>
                      ) : null}
                    </div>
                  ))}

                  {/* the future you are "before" */}
                  {past ? (
                    <div className="vx-hatch pointer-events-none absolute rounded-vx-sm" style={{ left: playX, width: Math.max(0, contentW - playX - 4), top: HIT_TOP, height: HIT_H }} />
                  ) : null}

                  {/* checkpoint flags */}
                  {flags.map((f) => (
                    <div key={f.i} className="pointer-events-none absolute flex flex-col items-start" style={{ left: f.l, top: 4 }}>
                      {f.full ? (
                        <CheckpointBadge name={f.name} className="!h-[18px] max-w-[160px] !px-1.5" />
                      ) : (
                        <span className="inline-flex h-[18px] w-[22px] items-center justify-center rounded-full bg-vx-accent-wash text-vx-on-accent-wash" title={`Checkpoint: ${f.name}`}>
                          <Bookmark size={11} strokeWidth={2} fill="currentColor" aria-hidden />
                        </span>
                      )}
                      <span aria-hidden className="h-2 w-px bg-vx-accent opacity-50" style={{ marginLeft: f.x - f.l }} />
                    </div>
                  ))}

                  {/* dots */}
                  {ordered.map((e, i) => {
                    const dim = (lensSet && !lensSet.has(e.commitId)) || (past && e.isHead);
                    const lensHit = !!lensSet?.has(e.commitId);
                    const hovered = hoverId === e.id && !dragging;
                    const isNew = flashing && stamp?.id === e.commitId && !tt;
                    const restore = isRestoreKind(e.kind);
                    let size: number = e.isHead ? 14 : restore ? 10 : dotSize(e.bytesDelta);
                    let style: React.CSSProperties;
                    if (hovered) {
                      size = Math.max(size, 12);
                      style = { background: 'var(--vx-text-1)', boxShadow: '0 0 0 4px var(--vx-surface-3)' };
                    } else if (e.isHead) {
                      style = { background: 'var(--vx-accent)', boxShadow: '0 0 0 4px var(--vx-accent-wash)' };
                    } else if (restore) {
                      style = { background: 'var(--vx-surface)', boxShadow: 'inset 0 0 0 2px var(--vx-text-2), 0 0 0 2px var(--vx-surface)' };
                    } else {
                      style = { background: 'var(--vx-tick)', boxShadow: '0 0 0 2px var(--vx-surface)' };
                    }
                    if (lensHit && !hovered) style = { ...style, boxShadow: `${style.boxShadow}, 0 0 0 4px var(--vx-accent)` };
                    return (
                      <button
                        key={e.id}
                        type="button"
                        tabIndex={-1}
                        aria-label={`${actionText(e.summary, e.restoredTo)}, ${new Date(e.createdAt).toLocaleString()}`}
                        onClick={(ev) => (ev.shiftKey ? actions.compareWithViewed(e, entries) : actions.open(e))}
                        onContextMenu={(ev) => {
                          ev.preventDefault();
                          hideTip();
                          setMenu({ at: { x: ev.clientX, y: ev.clientY }, items: actions.menuItems(e) });
                        }}
                        onMouseEnter={(ev) => showTip(e, i + 1, ev.currentTarget)}
                        onMouseLeave={hideTip}
                        className="absolute cursor-pointer outline-none"
                        style={{ left: xs[i] - slot / 2, width: slot, top: HIT_TOP, height: HIT_H, zIndex: hovered ? 2 : 1 }}
                      >
                        <span
                          key={isNew ? `new-${stamp?.n}` : 'dot'}
                          className={cx(
                            'absolute left-1/2 rounded-full transition-[width,height,background-color,box-shadow] duration-[120ms]',
                            isNew && (e.isHead ? 'vxv-pulse' : 'vxv-grow'),
                          )}
                          style={{
                            ...style,
                            top: LINE_Y - HIT_TOP,
                            width: size,
                            height: size,
                            transform: 'translate(-50%, -50%)',
                            opacity: dim ? 0.35 : 1,
                          }}
                        />
                      </button>
                    );
                  })}

                  {n === 0 ? (
                    <span className="vx-meta pointer-events-none absolute whitespace-nowrap text-vx-text-4" style={{ right: PAD_R + 16, top: LINE_Y + 8 }}>
                      Every upload, rename or delete adds a dot here
                    </span>
                  ) : n === 1 ? (
                    <span className="vx-meta pointer-events-none absolute whitespace-nowrap bg-vx-surface pr-2 text-vx-text-3" style={{ right: contentW - xs[0] + 16, top: LINE_Y - 8 }}>
                      Your history starts here
                    </span>
                  ) : null}

                  {/* bottom lane = drag surface */}
                  <div
                    className="absolute inset-x-0 cursor-ew-resize"
                    style={{ top: HIT_TOP + HIT_H, bottom: 0 }}
                    onPointerDown={onDragStart}
                    onPointerMove={onDragMove}
                    onPointerUp={onDragEnd}
                    onPointerCancel={onDragEnd}
                  />

                  {/* playhead (past only) */}
                  {past ? (
                    <div
                      className={cx('pointer-events-none absolute z-[3] w-0.5 -translate-x-1/2 rounded-full bg-vx-past-dot', gliding && !dragging && 'vxv-glide')}
                      style={{ left: playX, top: LINE_Y - 17, height: 34 }}
                    />
                  ) : null}
                  {/* the grip: a 16 px amber ring in the past; an invisible focus target on the head dot at now */}
                  {n ? (
                    <div
                      role="slider"
                      tabIndex={0}
                      aria-label="Version playhead"
                      aria-valuemin={1}
                      aria-valuemax={Math.max(1, n)}
                      aria-valuenow={viewedIdx >= 0 ? viewedIdx + 1 : Math.max(1, n)}
                      aria-valuetext={
                        tt
                          ? `Viewing ${viewedEntry ? actionText(viewedEntry.summary, viewedEntry.restoredTo) : ''} ${new Date(tt.createdAt).toLocaleString()}`
                          : 'Now'
                      }
                      onKeyDown={onGripKey}
                      onPointerDown={onDragStart}
                      onPointerMove={onDragMove}
                      onPointerUp={onDragEnd}
                      onPointerCancel={onDragEnd}
                      onMouseEnter={(ev) => {
                        const i = viewedIdx >= 0 ? viewedIdx : n - 1;
                        if (!past || viewedIdx >= 0) showTip(ordered[i], i + 1, ev.currentTarget);
                      }}
                      onMouseLeave={hideTip}
                      className={cx(
                        'absolute z-[4] rounded-full',
                        past ? 'vxv-grip' : 'cursor-grab focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-vx-accent-edge',
                        gliding && !dragging && 'vxv-glide',
                      )}
                      style={{ left: playX - (past ? 8 : 7), top: LINE_Y - (past ? 8 : 7), width: past ? 16 : 14, height: past ? 16 : 14 }}
                    />
                  ) : null}
                </>
              )}
            </div>
          </div>
          {/* 16 px edge fades */}
          <div
            aria-hidden
            className={cx('pointer-events-none absolute inset-y-0 left-0 w-4 transition-opacity duration-[120ms]', edges.left ? 'opacity-100' : 'opacity-0')}
            style={{ background: 'linear-gradient(90deg, var(--vx-surface), transparent)' }}
          />
          <div
            aria-hidden
            className={cx('pointer-events-none absolute inset-y-0 right-0 w-4 transition-opacity duration-[120ms]', edges.right ? 'opacity-100' : 'opacity-0')}
            style={{ background: 'linear-gradient(270deg, var(--vx-surface), transparent)' }}
          />
        </div>

        {/* tools */}
        <div className="flex h-12 shrink-0 items-center gap-1 border-l border-vx-hair pl-3">
          <Tooltip label={timelineOpen ? 'Hide history' : 'History'} kbd="H">
            <IconButton label={timelineOpen ? 'Hide history' : 'History'} nativeTitle={false} toggled={timelineOpen} onClick={history}>
              <ClockFading size={20} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </Tooltip>
          <Tooltip label={tt ? 'Checkpoint this version' : 'New checkpoint'} kbd="P">
            <IconButton label="Checkpoint" nativeTitle={false} onClick={checkpoint}>
              <Bookmark size={20} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </Tooltip>
          <Tooltip label={tt ? 'Compare with now' : 'You are already at now'} kbd={tt ? 'C' : undefined}>
            <IconButton label="Compare with now" nativeTitle={false} disabled={!tt} onClick={compare}>
              <ArrowLeftRight size={20} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {/* ── phone: a floating pill ── */}
      <div className="hidden h-full min-w-0 items-center gap-3 pl-[18px] pr-2 max-[720px]:flex">
        <span
          aria-hidden
          className={cx('h-2 w-2 shrink-0 rounded-full', tt ? 'bg-vx-past-dot shadow-[0_0_0_3px_var(--vx-past-halo)]' : 'bg-vx-ok shadow-[0_0_0_3px_var(--vx-ok-wash)]')}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className={cx('truncate text-[14px] font-semibold leading-5 tabular-nums', tt ? 'text-vx-past-strong' : 'text-vx-text-1')}>
            {tt ? `Viewing ${format(new Date(tt.createdAt), 'd MMM')}` : `Now${ordinal > 0 ? ` · v${ordinal}` : ''}`}
          </span>
          <span className={cx('vx-meta truncate', tt ? 'text-vx-past' : 'text-vx-text-3')}>
            {shortTimecode(codeAt)}
            {tt && version ? ` · ${version}` : ''}
          </span>
        </div>
        {tt ? (
          <>
            <IconButton size="sm" label={timelineOpen ? 'Hide history' : 'History'} toggled={timelineOpen} onClick={history}>
              <ClockFading size={18} strokeWidth={1.75} aria-hidden />
            </IconButton>
            <Button size="sm" variant="primary" onClick={() => exitTimeTravel()}>
              Back to now
            </Button>
          </>
        ) : (
          <Button size="sm" variant="tonal" icon={<ClockFading size={16} strokeWidth={1.75} aria-hidden />} aria-pressed={timelineOpen} onClick={history}>
            History
          </Button>
        )}
      </div>

      {tip ? <DotCard e={tip.e} v={tip.v} x={tip.x} anchor={rootRef.current} /> : null}
      <ContextMenu at={menu?.at ?? null} items={menu?.items ?? []} onClose={() => setMenu(null)} />
    </div>
  );
}

/** Hover card for a dot (float, r12, shadow-3, 280 px), 12 px above the strip. */
function DotCard({ e, v, x, anchor }: { e: TimelineEntry; v: number; x: number; anchor: HTMLElement | null }) {
  if (typeof document === 'undefined') return null;
  const w = 280;
  const top = anchor ? anchor.getBoundingClientRect().top : window.innerHeight - 88;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2));
  const bottom = window.innerHeight - top + 12;
  return createPortal(
    <div
      role="tooltip"
      className="vxv-fade pointer-events-none fixed z-[70] rounded-vx-md border border-vx-hair bg-vx-float px-3.5 py-3 text-vx-text-2 shadow-vx-3"
      style={{ left, bottom, width: w }}
    >
      <div className="vx-meta text-vx-text-3">
        {tooltipTime(e.createdAt)} · v{v}
      </div>
      <div className="mt-0.5 text-[14px] font-semibold leading-5 text-vx-text-1">{actionText(e.summary, e.restoredTo)}</div>
      <div className="vx-meta mt-0.5 flex flex-wrap items-center gap-x-1 text-vx-text-3">
        <Delta n={e.bytesDelta} />
        <span>· {plural(e.itemCount, 'item')} ·</span>
        <CommitId id={e.commitId} />
      </div>
      {e.paths.length ? (
        <ul className="mt-2 flex flex-col gap-0.5 border-t border-vx-hair-soft pt-2">
          {e.paths.slice(0, 3).map((p, i) => (
            <li key={i} className="vx-code truncate text-vx-text-2">
              {p.fromPath ? `${p.fromPath} → ${p.path}` : p.path}
            </li>
          ))}
        </ul>
      ) : null}
      {e.checkpoints.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {e.checkpoints.map((c) => (
            <CheckpointBadge key={c.id} name={c.name} />
          ))}
        </div>
      ) : null}
      {e.mergedCount > 0 ? <div className="vx-micro mt-1.5 text-vx-text-3">includes {plural(e.mergedCount, 'earlier change')}</div> : null}
      <div className="vx-micro mt-2 text-vx-text-4">
        {e.isHead ? 'This is now · Right-click for more' : 'Click to view · Shift-click to compare · Right-click for more'}
      </div>
    </div>,
    document.body,
  );
}

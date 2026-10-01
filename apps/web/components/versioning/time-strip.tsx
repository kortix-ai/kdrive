'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { ArrowLeftRight, ClockFading, Diamond } from 'lucide-react';
import type { TimelineEntry } from '@volumes/shared';
import { AgentBadge } from '@/components/agents/agent-badge';
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

// Track geometry (64 px, the strip's height): top lane 4–16 (checkpoint and zone labels) · line at 30 ·
// bottom lane 42–54 (day labels).
const H = 64;
const LINE_Y = 30;
const HIT_TOP = 17;
const HIT_H = 26;
const DAY_Y = 43;
const PAD_L = 16;
const PAD_R = 20;
const MAGNET = 8;
const ZONE_RECENT = 'every version · 7 days';
const ZONE_OLD = 'newest 50 + checkpoints';
/** Minimum gap between a zone label and a checkpoint label in the shared top lane. */
const ZONE_CLEAR = 120;
/** Mono 11 is ~6.6 px a character. */
/** Tick heights by size bucket (dotSize 6 / 8 / 10 → 8 / 12 / 16 px). */
const TICK_H: Record<6 | 8 | 10, number> = { 6: 8, 8: 12, 10: 16 };
const textW = (s: string, perChar = 6.7) => s.length * perChar;

/**
 * History strip (UNIFY-SPEC §12.3; behaviour DESIGN-v2 §6.4; /drive only): a 64 px sheet with the Now / Viewing
 * readout, a ruler of version ticks on a hairline (oldest left, now pinned right; ◆ checkpoints with Mono labels,
 * the head disc at the right) with a draggable brass grip in the past, and the History / Checkpoint / Compare tools.
 * On phones it is a floating 56 px bar.
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

  // ── checkpoint labels (top lane): the Mono name above its ◆ when there is room, else the ◆ alone ──
  const flags = useMemo(() => {
    const out: { i: number; x: number; name: string; full: boolean; l: number; r: number }[] = [];
    let lastRight = -Infinity;
    const idx = ordered.map((e, i) => (e.checkpoints.length ? i : -1)).filter((i) => i >= 0);
    idx.forEach((i, k) => {
      const name = ordered[i].checkpoints.map((c) => c.name).join(', ');
      const x = xs[i];
      const fullW = Math.min(150, textW(name));
      const nextX = k + 1 < idx.length ? xs[idx[k + 1]] : Infinity;
      // Near the track ends the label slides inward (the ◆ stays on its tick) instead of shrinking.
      const fullL = Math.max(2, Math.min(x - fullW / 2, contentW - 2 - fullW));
      const fits = fullL > lastRight + 10 && fullL + fullW < nextX - 10 && fullL <= x + 4 && fullL + fullW >= x - 4;
      const l = fits ? fullL : x - 5;
      const r = fits ? fullL + fullW : x + 5;
      out.push({ i, x, name, full: fits, l, r });
      lastRight = r;
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
    const gapsIn = (min: number, max: number) => [min + 4, ...flags.filter((f) => f.r > min && f.r < max).map((f) => f.r + ZONE_CLEAR)];
    if (boundary !== 0) cands.push({ text: ZONE_OLD, ls: [bx - textW(ZONE_OLD) - 8, ...gapsIn(startX, bx)], min: startX, max: bx });
    if (boundary >= 0) cands.push({ text: ZONE_RECENT, ls: [bx + 8, ...gapsIn(bx, contentW - PAD_R)], min: bx, max: contentW - PAD_R + 12 });
    for (const c of cands) {
      const w = textW(c.text);
      for (const l of c.ls) {
        const r = l + w;
        if (l < Math.max(2, c.min) || r > Math.min(contentW - 4, c.max)) continue;
        // Well clear of any checkpoint label (or hidden), so "First draft" and a zone label never read as one phrase.
        if (flags.some((f) => l < f.r + ZONE_CLEAR && r > f.l - ZONE_CLEAR)) continue;
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
      const w = textW(label);
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
      <div className="flex h-full min-w-0 items-center pl-4 pr-2 max-[720px]:hidden">
        {/* readout */}
        <div className="flex h-full w-[200px] shrink-0 flex-col justify-center border-r border-vx-hair pr-4">
          <div className="flex items-center gap-1.5">
            <span aria-hidden className={cx('h-1.5 w-1.5 shrink-0 rounded-full', tt ? 'bg-vx-past-dot' : 'bg-vx-ok')} />
            <span className={cx('vx-eyebrow', tt && '!text-vx-past')}>{tt ? 'Viewing' : 'Now'}</span>
          </div>
          <span className="truncate text-[14px] font-semibold leading-5 tabular-nums text-vx-text-1" title={new Date(codeAt).toString()}>
            {timecode(codeAt)}
          </span>
          <span className="vx-meta flex min-w-0 items-center gap-1 truncate text-vx-text-3">
            {version ? <span className="shrink-0 tabular-nums">{version}</span> : null}
            {version && shownCommit ? <span aria-hidden>·</span> : null}
            {shownCommit ? (
              <span key={stamp?.n ?? 0} className={cx('-mx-1 rounded-vx-xs px-1', flashing && !tt && 'vxv-stamp')}>
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
              {isLoading ? (
                <div aria-busy aria-label="Loading history">
                  <div className="pointer-events-none absolute h-px bg-vx-hair-strong" style={{ left: PAD_L / 2, right: 4, top: LINE_Y }} />
                  {Array.from({ length: 24 }, (_, i) => (
                    <span key={i} className="skeleton absolute w-px" style={{ left: contentW - PAD_R - 8 - i * 20, top: LINE_Y - 6, height: 12 }} />
                  ))}
                </div>
              ) : error && !n ? (
                <div className="absolute inset-0 flex items-center gap-2 bg-vx-surface pl-4">
                  <span className="vx-body text-vx-text-2">Couldn&apos;t load history</span>
                  <span className="vx-micro truncate text-vx-text-3">{errorText(error)}</span>
                  <Button variant="text" size="sm" onClick={retry}>
                    Retry
                  </Button>
                </div>
              ) : (
                <>
                  {/* the baseline: dashed through the older zone (newest 50 + checkpoints), solid through the last 7 days */}
                  {oldBand && oldBand.r > oldBand.l ? (
                    <div className="pointer-events-none absolute h-0 border-t border-dashed border-vx-hair-strong" style={{ left: PAD_L / 2, width: oldBand.r - PAD_L / 2, top: LINE_Y }} />
                  ) : null}
                  <div
                    className="pointer-events-none absolute h-px bg-vx-hair-strong"
                    style={{ left: oldBand && oldBand.r > oldBand.l ? oldBand.r : PAD_L / 2, right: 4, top: LINE_Y }}
                  />
                  {boundary > 0 ? (
                    <div className="pointer-events-none absolute w-0 border-l border-dashed border-vx-hair-strong" style={{ left: offset + boundary * slot, top: LINE_Y - 9, height: 18 }} />
                  ) : null}
                  {zones.map((z) => (
                    <span
                      key={z.text}
                      // A surface chip: the label stays legible over the hatched future and never touches a tick.
                      className="pointer-events-none absolute z-[1] -mx-1 whitespace-nowrap rounded-vx-xs bg-vx-surface px-1 font-mono text-[11px] leading-3 text-vx-text-3"
                      style={{ left: z.l, top: 6 }}
                    >
                      {z.text}
                    </span>
                  ))}

                  {/* day boundaries (taller ticks) + Mono day labels */}
                  {days.map((d, k) => (
                    <div key={`${k}-${d.x}`}>
                      {d.tick ? <span className="pointer-events-none absolute w-px bg-vx-hair-strong" style={{ left: d.x, top: LINE_Y - 7, height: 18 }} /> : null}
                      {d.label ? (
                        <span className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap font-mono text-[11px] leading-3 text-vx-text-3" style={{ left: d.x, top: DAY_Y }}>
                          {d.label}
                        </span>
                      ) : null}
                    </div>
                  ))}

                  {/* the future you are "before" */}
                  {past ? (
                    <div className="vx-hatch pointer-events-none absolute" style={{ left: playX, width: Math.max(0, contentW - playX - 4), top: LINE_Y - 8, height: 16 }} />
                  ) : null}

                  {/* checkpoint labels above their ◆ */}
                  {flags.map((f) =>
                    f.full ? (
                      <span
                        key={f.i}
                        className="pointer-events-none absolute truncate whitespace-nowrap font-mono text-[11px] leading-3 text-vx-text-2"
                        style={{ left: f.l, top: 8, maxWidth: f.r - f.l + 2 }}
                        title={`Checkpoint: ${f.name}`}
                      >
                        {f.name}
                      </span>
                    ) : null,
                  )}

                  {/* marks: ticks (size bucket), ◆ checkpoints, hollow restore rings, the head disc */}
                  {ordered.map((e, i) => {
                    const dim = (lensSet && !lensSet.has(e.commitId)) || (past && e.isHead);
                    const lensHit = !!lensSet?.has(e.commitId);
                    const hovered = hoverId === e.id && !dragging;
                    const isNew = flashing && stamp?.id === e.commitId && !tt;
                    const lit = hovered || lensHit;
                    let mark: React.ReactNode;
                    const pos: React.CSSProperties = { top: LINE_Y - HIT_TOP, opacity: dim ? 0.35 : 1 };
                    const anim = isNew ? (e.isHead ? 'vxv-pulse' : 'vxv-grow') : undefined;
                    if (e.isHead) {
                      mark = <span key={isNew ? `new-${stamp?.n}` : 'mark'} className={cx('vxv-head', anim)} style={pos} />;
                    } else if (e.checkpoints.length) {
                      const filled = lit || viewedIdx < 0 || i <= viewedIdx;
                      mark = <span key="mark" className="vxv-diamond" data-filled={filled ? 'true' : undefined} style={pos} />;
                    } else if (isRestoreKind(e.kind)) {
                      mark = (
                        <span
                          key={isNew ? `new-${stamp?.n}` : 'mark'}
                          className={cx('vxv-ring', anim)}
                          style={lit ? { ...pos, boxShadow: 'inset 0 0 0 1.5px var(--vx-text-1)' } : pos}
                        />
                      );
                    } else {
                      const h = TICK_H[dotSize(e.bytesDelta)];
                      mark = (
                        <span
                          key={isNew ? `new-${stamp?.n}` : 'mark'}
                          className={cx('vxv-tick transition-[background-color,width] duration-[120ms]', anim)}
                          style={{ ...pos, height: h, width: hovered ? 2 : 1, background: lit ? 'var(--vx-text-1)' : undefined }}
                        />
                      );
                    }
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
                        {mark}
                      </button>
                    );
                  })}

                  {n === 0 ? (
                    <span className="vx-micro pointer-events-none absolute whitespace-nowrap bg-vx-surface pl-2 text-vx-text-3" style={{ right: PAD_R + 16, top: LINE_Y + 6 }}>
                      Every upload, rename or delete adds a version here
                    </span>
                  ) : n === 1 ? (
                    <span className="vx-micro pointer-events-none absolute whitespace-nowrap bg-vx-surface pr-2 text-vx-text-3" style={{ right: contentW - xs[0] + 16, top: LINE_Y - 8 }}>
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

                  {/* playhead (past only): a 1 px brass line through the grip */}
                  {past ? (
                    <div
                      className={cx('pointer-events-none absolute z-[3] w-px -translate-x-1/2 bg-vx-past-dot', gliding && !dragging && 'vxv-glide')}
                      style={{ left: playX, top: LINE_Y - 14, height: 28 }}
                    />
                  ) : null}
                  {/* the grip: a 14 px brass ring in the past; an invisible focus target on the head disc at now */}
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
                        past ? 'vxv-grip' : 'vxv-head-target cursor-grab',
                        gliding && !dragging && 'vxv-glide',
                      )}
                      style={{ left: playX - 7, top: LINE_Y - 7, width: 14, height: 14 }}
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
        <div className="flex h-10 shrink-0 items-center gap-0.5 border-l border-vx-hair pl-2">
          <Tooltip label={timelineOpen ? 'Hide history' : 'History'} kbd="H">
            <IconButton label={timelineOpen ? 'Hide history' : 'History'} nativeTitle={false} toggled={timelineOpen} onClick={history}>
              <ClockFading size={18} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </Tooltip>
          <Tooltip label={tt ? 'Checkpoint this version' : 'New checkpoint'} kbd="P">
            <IconButton label="Checkpoint" nativeTitle={false} onClick={checkpoint}>
              <Diamond size={18} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </Tooltip>
          <Tooltip label={tt ? 'Compare with now' : 'You are already at now'} kbd={tt ? 'C' : undefined}>
            <IconButton label="Compare with now" nativeTitle={false} disabled={!tt} onClick={compare}>
              <ArrowLeftRight size={18} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {/* ── phone: a floating bar ── */}
      <div className="hidden h-full min-w-0 items-center gap-3 pl-4 pr-2 max-[720px]:flex">
        <span aria-hidden className={cx('h-1.5 w-1.5 shrink-0 rounded-full', tt ? 'bg-vx-past-dot' : 'bg-vx-ok')} />
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

/** Hover card for a version (float, r6, shadow-3 with its hair ring, 280 px), 12 px above the strip. */
function DotCard({ e, v, x, anchor }: { e: TimelineEntry; v: number; x: number; anchor: HTMLElement | null }) {
  if (typeof document === 'undefined') return null;
  const w = 280;
  const top = anchor ? anchor.getBoundingClientRect().top : window.innerHeight - 88;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2));
  const bottom = window.innerHeight - top + 12;
  return createPortal(
    <div
      role="tooltip"
      className="vxv-fade pointer-events-none fixed z-[70] rounded-vx-md bg-vx-float px-3.5 py-3 text-vx-text-2 shadow-vx-3"
      style={{ left, bottom, width: w }}
    >
      <div className="vx-meta text-vx-text-3">
        {tooltipTime(e.createdAt)} · v{v}
      </div>
      <div className="mt-0.5 text-[14px] font-semibold leading-5 text-vx-text-1">{actionText(e.summary, e.restoredTo)}</div>
      {e.agent ? (
        <div className="vx-meta mt-1 flex min-w-0 items-center gap-1.5 text-vx-text-3">
          By <AgentBadge agent={e.agent} className="min-w-0" />
        </div>
      ) : null}
      <div className="vx-meta mt-0.5 flex flex-wrap items-center gap-x-1 text-vx-text-3">
        <Delta n={e.bytesDelta} />
        <span>· {plural(e.itemCount, 'item')} ·</span>
        <CommitId id={e.commitId} />
      </div>
      {e.paths.length ? (
        <ul className="-mx-3.5 mt-2 flex flex-col gap-0.5 border-t border-vx-hair-soft px-3.5 pt-2">
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
      <div className="vx-micro mt-2 text-vx-text-3">
        {e.isHead ? 'This is now · Right-click for more' : 'Click to view · Shift-click to compare · Right-click for more'}
      </div>
    </div>,
    document.body,
  );
}

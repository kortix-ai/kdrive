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

// Track geometry (80 px, the strip's height): zone lane 4–18 · checkpoint labels centred over their ◆ at 20–36 ·
// the line at 46 · day labels at 58. Phones (64 px): the line at 28, day numbers at 40, no label lanes.
type Geo = { H: number; LINE_Y: number; HIT_TOP: number; HIT_H: number; DAY_Y: number; FLAG_Y: number; ZONE_Y: number; PAD_R: number; labels: boolean };
const WIDE: Geo = { H: 80, LINE_Y: 46, HIT_TOP: 33, HIT_H: 26, DAY_Y: 58, FLAG_Y: 20, ZONE_Y: 4, PAD_R: 60, labels: true };
const PHONE: Geo = { H: 64, LINE_Y: 30, HIT_TOP: 17, HIT_H: 26, DAY_Y: 42, FLAG_Y: 0, ZONE_Y: 0, PAD_R: 48, labels: false };
const PAD_L = 16;
const MAGNET = 8;
const ZONE_RECENT = 'every version · 7 days';
const ZONE_OLD = 'newest 50 + checkpoints';
/** Clear space between a checkpoint label and the now disc (and its "now" label's ripple). */
const NOW_GUTTER = 24;
/** Tick heights by size bucket (dotSize 6 / 8 / 10 → 10 / 14 / 18 px). */
const TICK_H: Record<6 | 8 | 10, number> = { 6: 10, 8: 14, 10: 18 };
/** Geist Mono at 11.5 px is ~6.9 px a character. */
const textW = (s: string, perChar = 6.9) => s.length * perChar;

function usePhone(): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)');
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return match;
}

/**
 * History strip (UNIFY-SPEC §12.3; behaviour DESIGN-v2 §6.4; /drive only): an 80 px sheet with the Now / Viewing
 * readout, a ruler of version ticks on a hairline (oldest left, now pinned right as an ember disc labelled "now";
 * ◆ checkpoints with their Mono names centred above), a draggable cobalt grip with a version bubble in the past and
 * the cobalt hatch from it to now, and the Checkpoint / Compare / History tools.
 * On phones it is a floating 64 px bar: the readout, the ruler with day numbers, History.
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
  const phone = usePhone();
  const { H, LINE_Y, HIT_TOP, HIT_H, DAY_Y, FLAG_Y, ZONE_Y, PAD_R } = phone ? PHONE : WIDE;
  const labels = !phone;

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

  // ── checkpoint labels: the Mono name centred over its ◆ when it fits, else the ◆ alone (named on hover). A label
  // never crosses the next ◆, the track's ends or the 24 px gutter before now; the viewed one is named by the bubble. ──
  const flags = useMemo(() => {
    const out: { i: number; x: number; name: string; full: boolean; l: number; r: number }[] = [];
    if (!labels) return out;
    let lastRight = -Infinity;
    const idx = ordered.map((e, i) => (e.checkpoints.length ? i : -1)).filter((i) => i >= 0);
    idx.forEach((i, k) => {
      const name = ordered[i].checkpoints.map((c) => c.name).join(', ');
      const x = xs[i];
      const w = Math.min(160, textW(name));
      const l = x - w / 2;
      const r = x + w / 2;
      const nextX = k + 1 < idx.length ? xs[idx[k + 1]] : Infinity;
      const fits = l >= 2 && l > lastRight + 12 && r < nextX - 8 && r <= nowX - NOW_GUTTER - 7 && i !== viewedIdx;
      out.push({ i, x, name, full: fits, l, r });
      if (fits) lastRight = r;
    });
    return out;
  }, [ordered, xs, nowX, viewedIdx, labels]);

  // ── retention zones: older zone dashed + a dashed boundary; captions in their own lane above the flags ──
  const boundary = retentionBoundary(ordered);
  const zones = useMemo(() => {
    const out: { text: string; l: number; r: number }[] = [];
    if (!n || !labels) return out;
    const startX = offset;
    const bx = boundary > 0 ? offset + boundary * slot : boundary === 0 ? startX : contentW - PAD_R;
    // The older zone's caption ends at the boundary; the recent zone's starts just after it.
    const cands: { text: string; l: number; min: number; max: number }[] = [];
    if (boundary !== 0) cands.push({ text: ZONE_OLD, l: bx - textW(ZONE_OLD, 6.6) - 8, min: startX, max: bx });
    if (boundary >= 0) cands.push({ text: ZONE_RECENT, l: bx + 8, min: bx, max: contentW - 4 });
    for (const c of cands) {
      const l = Math.max(c.l, Math.max(2, c.min));
      const r = l + textW(c.text, 6.6);
      if (r > Math.min(contentW - 4, c.max)) continue;
      if (out.some((o) => l < o.r + 8 && r > o.l - 8)) continue;
      out.push({ text: c.text, l, r });
    }
    return out;
  }, [n, boundary, offset, slot, contentW, labels, PAD_R]);
  const oldBand = n && boundary !== 0 ? { l: offset + 2, r: boundary > 0 ? offset + boundary * slot : xs[n - 1] + slot / 2 } : null;

  // ── day ticks and labels (bottom lane; day numbers only on phones) ────
  const days = useMemo(() => {
    const out: { x: number; label: string | null; tick: boolean }[] = [];
    if (!n) return out;
    let lastRight = -Infinity;
    const push = (x: number, full: string, tick: boolean, align: 'center' | 'left') => {
      const label = phone ? (full.match(/\d+/)?.[0] ?? full) : full;
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
  }, [ordered, n, offset, slot, contentW, phone]);

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

  // The viewed version's bubble: "v18 · Client review", kept inside the track.
  const viewedName = viewedEntry?.checkpoints.map((c) => c.name).join(', ') ?? '';
  const bubble = tt && viewedIdx >= 0 && !dragging ? `v${viewedIdx + 1}${viewedName && !phone ? ` · ${viewedName}` : ''}` : null;
  const bubbleW = bubble ? textW(bubble, 7) + 16 : 0;
  const bubbleX = bubble ? Math.max(bubbleW / 2 + 2, Math.min(contentW - bubbleW / 2 - 2, playX)) : 0;

  return (
    <div ref={rootRef} className="h-[var(--vx-strip-h)] min-w-0 select-none" aria-label="Time strip">
      <div className="flex h-full min-w-0 items-stretch">
        {/* readout */}
        <div className="flex w-[220px] shrink-0 flex-col justify-center gap-px border-r border-vx-hair pl-[18px] pr-4 max-[1100px]:w-[196px] max-[720px]:w-auto max-[720px]:max-w-[46%] max-[720px]:pl-3.5 max-[720px]:pr-3">
          <div className="flex items-center gap-2">
            <span aria-hidden className="vxv-dot" data-past={tt ? 'true' : undefined} />
            <span className={cx('vx-eyebrow max-[720px]:!text-[11px]', tt && '!text-vx-past')}>{tt ? 'Viewing' : 'Now'}</span>
          </div>
          <span
            className="truncate text-[16px] font-semibold leading-[22px] tabular-nums text-vx-text-1 max-[720px]:text-[14px] max-[720px]:leading-[18px]"
            title={new Date(codeAt).toString()}
          >
            <span className="max-[720px]:hidden">{timecode(codeAt)}</span>
            <span className="hidden max-[720px]:inline">{shortTimecode(codeAt)}</span>
          </span>
          <span className="vx-meta flex min-w-0 items-center gap-1 truncate text-vx-text-3">
            {ordinal > 0 ? (
              <span className="shrink-0 tabular-nums">
                <b className="font-medium text-vx-text-2">v{ordinal}</b>
                {tt ? <span className="max-[720px]:hidden"> of {n}</span> : null}
              </span>
            ) : null}
            {ordinal > 0 && shownCommit ? (
              <span aria-hidden className="max-[720px]:hidden">
                ·
              </span>
            ) : null}
            {shownCommit ? (
              <span key={stamp?.n ?? 0} className={cx('-mx-1 rounded-vx-xs px-1 max-[720px]:hidden', flashing && !tt && 'vxv-stamp')}>
                <CommitId id={shownCommit} />
              </span>
            ) : ordinal > 0 ? null : (
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
                    <span key={i} className="skeleton absolute w-0.5" style={{ left: contentW - PAD_R - 8 - i * 20, top: LINE_Y - 7, height: 14 }} />
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
                    <div className="pointer-events-none absolute h-0 border-t border-dashed border-vx-hair-dash" style={{ left: PAD_L / 2, width: oldBand.r - PAD_L / 2, top: LINE_Y }} />
                  ) : null}
                  <div
                    className="pointer-events-none absolute h-px bg-vx-hair-strong"
                    style={{ left: oldBand && oldBand.r > oldBand.l ? oldBand.r : PAD_L / 2, width: Math.max(0, nowX - (oldBand && oldBand.r > oldBand.l ? oldBand.r : PAD_L / 2)), top: LINE_Y }}
                  />
                  {boundary > 0 && labels ? (
                    <div
                      className="pointer-events-none absolute w-0 border-l border-dashed border-vx-hair-dash"
                      style={{ left: offset + boundary * slot, top: ZONE_Y, height: LINE_Y - ZONE_Y + 6 }}
                    />
                  ) : null}
                  {zones
                    .filter((z) => !(bubble && z.l < bubbleX + bubbleW / 2 + 8 && z.r > bubbleX - bubbleW / 2 - 8))
                    .map((z) => (
                    <span
                      key={z.text}
                      className="pointer-events-none absolute whitespace-nowrap font-mono text-[11px] leading-[14px] text-vx-text-3"
                      style={{ left: z.l, top: ZONE_Y }}
                    >
                      {z.text}
                    </span>
                  ))}

                  {/* day boundaries (a short tick under the line) + Mono day labels */}
                  {days.map((d, k) => (
                    <div key={`${k}-${d.x}`}>
                      {d.tick ? <span className="pointer-events-none absolute w-px bg-vx-hair-strong" style={{ left: d.x, top: LINE_Y + 5, height: 5 }} /> : null}
                      {d.label ? (
                        <span
                          className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap font-mono text-[11.5px] leading-[14px] text-vx-text-3 max-[720px]:text-[11px]"
                          style={{ left: d.x, top: DAY_Y }}
                        >
                          {d.label}
                        </span>
                      ) : null}
                    </div>
                  ))}

                  {/* the future you are "before": cobalt hatch from the grip to now */}
                  {past ? (
                    <div className="vxv-future pointer-events-none absolute" style={{ left: playX, width: Math.max(0, nowX - playX), top: LINE_Y - 12, height: 24 }} />
                  ) : null}

                  {/* checkpoint labels, centred over their ◆ */}
                  {flags.map((f) =>
                    f.full && !(bubble && f.l < bubbleX + bubbleW / 2 + 8 && f.r > bubbleX - bubbleW / 2 - 8) ? (
                      <span
                        key={f.i}
                        className="pointer-events-none absolute -translate-x-1/2 truncate whitespace-nowrap font-mono text-[11.5px] font-medium leading-4 text-vx-text-1"
                        style={{ left: f.x, top: FLAG_Y, maxWidth: f.r - f.l + 2 }}
                        title={`Checkpoint: ${f.name}`}
                      >
                        {f.name}
                      </span>
                    ) : null,
                  )}

                  {/* marks: ticks (size bucket; agents in cobalt), ◆ checkpoints, hollow restore rings, the now disc */}
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
                      mark = <span key={isNew ? `new-${stamp?.n}` : 'mark'} className={cx('vxv-head', anim)} style={{ ...pos, opacity: 1 }} />;
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
                          data-agent={e.agent && !lit ? 'true' : undefined}
                          className={cx('vxv-tick transition-[background-color,width] duration-[120ms]', anim)}
                          style={{ ...pos, height: h, width: hovered ? 3 : 2, background: lit ? 'var(--vx-text-1)' : undefined }}
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

                  {/* "now", beside the ember disc */}
                  {n ? (
                    <span
                      className="pointer-events-none absolute whitespace-nowrap font-mono text-[12px] font-medium leading-[18px] text-vx-text-1"
                      style={{ left: nowX + 15, top: LINE_Y - 9 }}
                    >
                      now
                    </span>
                  ) : null}

                  {n === 0 ? (
                    <span className="vx-micro pointer-events-none absolute whitespace-nowrap bg-vx-surface pl-2 text-vx-text-3" style={{ right: PAD_R + 16, top: LINE_Y + 6 }}>
                      Every upload, rename or delete adds a version here
                    </span>
                  ) : n === 1 && labels ? (
                    <span className="vx-micro pointer-events-none absolute whitespace-nowrap bg-vx-surface pr-2 text-vx-text-3" style={{ right: contentW - xs[0] + 16, top: LINE_Y - 9 }}>
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

                  {/* the viewed version, named in a cobalt bubble over the grip */}
                  {bubble ? (
                    <span
                      className={cx('vxv-bubble pointer-events-none absolute z-[3] -translate-x-1/2', gliding && 'vxv-glide')}
                      style={{ left: bubbleX, top: phone ? LINE_Y - 30 : LINE_Y - 34 }}
                    >
                      {bubble}
                    </span>
                  ) : null}
                  {/* the grip: a 20 px cobalt ring in the past; an invisible focus target on the now disc */}
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
                      style={past ? { left: playX - 10, top: LINE_Y - 10, width: 20, height: 20 } : { left: playX - 8, top: LINE_Y - 8, width: 16, height: 16 }}
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

        {/* tools: Checkpoint · Compare (labelled on wide screens) · History; phones keep History (+ Now in the past) */}
        <div className="flex shrink-0 items-center gap-1 border-l border-vx-hair px-3 max-[720px]:gap-0.5 max-[720px]:px-1.5">
          <Tooltip label={tt ? 'Checkpoint this version' : 'New checkpoint'} kbd="P">
            <Button variant="ghost" size="sm" aria-label="Checkpoint" icon={<Diamond size={16} strokeWidth={1.75} aria-hidden />} onClick={checkpoint} className="max-[720px]:!hidden max-[1279px]:!px-2">
              <span className="max-[1279px]:hidden">Checkpoint</span>
            </Button>
          </Tooltip>
          <Tooltip label={tt ? 'Compare with now' : 'You are already at now'} kbd={tt ? 'C' : undefined}>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Compare with now"
              disabled={!tt}
              icon={<ArrowLeftRight size={16} strokeWidth={1.75} aria-hidden />}
              onClick={compare}
              className="max-[720px]:!hidden max-[1279px]:!px-2"
            >
              <span className="max-[1279px]:hidden">Compare</span>
            </Button>
          </Tooltip>
          <Tooltip label={timelineOpen ? 'Hide history' : 'History'} kbd="H">
            <IconButton label={timelineOpen ? 'Hide history' : 'History'} nativeTitle={false} toggled={timelineOpen} onClick={history}>
              <ClockFading size={18} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </Tooltip>
          {tt ? (
            <Button size="sm" variant="past-primary" onClick={() => exitTimeTravel()} className="!hidden max-[720px]:!inline-flex">
              Now
            </Button>
          ) : null}
        </div>
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

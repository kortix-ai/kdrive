// Where an open fan's version labels go (LANDING-SPEC §5.6). One pure layout,
// used both by the direction chooser (to judge a plan) and by the label layer
// (to draw it), so what the chooser approved is exactly what is drawn.
// - column: vertical and depth fans; one column beside the stack, rows in
//   anchor order (so leaders never cross), sliding at most ±48px;
// - row: fans that run sideways on screen; each label sits over (or under) its
//   own slice with a short vertical leader, staggered over up to 3 rows.
// Every row must stay inside the safe rect, below the nav, clear of the copy,
// the hint and every other cube. No layout → null (the chooser moves on).
import { overlaps, segmentHits, type Rect, type Zones } from './exclusion';
import type { FanLabel } from './fan-labels';

export const ADV = 7.25; // JetBrains Mono 12px advance
export const ROW_H = 20;
const GAP = 22;
const SLIDE = 48;
const STEP = 21;

export interface Pt { x: number; y: number }
export type Attach = 'side' | 'top' | 'bottom';

export interface PlacedRow {
  label: number;
  slice: number;
  /** The row's attach point: its start edge, vertically centred. */
  x: number;
  y: number;
  /** 1: the text runs right from x; -1: it ends at x. */
  align: 1 | -1;
}

export interface FanLayout {
  mode: 'column' | 'row';
  attach: Attach;
  side: 1 | -1;
  rows: PlacedRow[];
  rect: Rect;
}

export const labelWidth = (l: FanLabel) => l.text.length * ADV + 12;

/** The corner of a slice that a leader starts from. */
export function anchorOf(corners: Pt[], attach: Attach, side: 1 | -1): Pt {
  let best = corners[0];
  let score = -Infinity;
  for (const c of corners) {
    const s = attach === 'top' ? -c.y : attach === 'bottom' ? c.y : c.x * side - c.y * 0.2;
    if (s > score) { score = s; best = c; }
  }
  return best;
}

const rowRect = (r: PlacedRow, w: number): Rect => ({
  x0: r.align > 0 ? r.x : r.x - w,
  x1: r.align > 0 ? r.x + w : r.x,
  y0: r.y - ROW_H / 2,
  y1: r.y + ROW_H / 2,
});

function clear(r: Rect, z: Zones, obstacles: Rect[]): boolean {
  return r.x0 >= z.safe.x0 && r.x1 <= z.safe.x1 && r.y0 >= z.nav.y1 && r.y1 <= z.safe.y1 &&
    !z.copy.some((c) => overlaps(r, c)) && !obstacles.some((o) => overlaps(r, o));
}

const union = (rs: Rect[]): Rect => rs.reduce((a, r) => ({ x0: Math.min(a.x0, r.x0), y0: Math.min(a.y0, r.y0), x1: Math.max(a.x1, r.x1), y1: Math.max(a.y1, r.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });

/** Do segments p1–p2 and q1–q2 properly cross? */
function crosses(p1: Pt, p2: Pt, q1: Pt, q2: Pt): boolean {
  const o = (a: Pt, b: Pt, c: Pt) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return o(p1, p2, q1) * o(p1, p2, q2) < 0 && o(q1, q2, p1) * o(q1, q2, p2) < 0;
}

/**
 * A column beside the stack on `side`; null when nothing clears. Rows first sit
 * at their anchors' heights (resolved 22px apart, sliding ≤48px); failing that
 * they pack together (sliding ≤64px). Rows are ordered by anchor height or by
 * position along the stack, whichever leaves no two leaders crossing.
 */
export function columnLayout(labels: FanLabel[], slices: Pt[][], side: 1 | -1, stack: Rect, z: Zones, obstacles: Rect[]): FanLayout | null {
  if (!labels.length) return null;
  const w = Math.max(...labels.map(labelWidth));
  const x = side > 0 ? stack.x1 + 28 : stack.x0 - 28;
  if ((side > 0 && x + w > z.safe.x1) || (side < 0 && x - w < z.safe.x0)) return null;
  const lx = x - 6 * side;
  const anchors = labels.map((l) => anchorOf(slices[l.slice], 'side', side));
  const byY = labels.map((_, k) => k).sort((a, b) => anchors[a].y - anchors[b].y || a - b);
  const byStack = labels.map((_, k) => k).sort((a, b) => labels[a].slice - labels[b].slice);
  const orders = [byY, byStack, [...byStack].reverse()];
  const tries: { order: number[]; ys: number[]; slide: number }[] = [];
  for (const order of orders) {
    let prev = -Infinity;
    const spread = order.map((k) => (prev = Math.max(anchors[k].y, prev + GAP)));
    const mid = order.reduce((a, k) => a + anchors[k].y, 0) / order.length;
    const packed = order.map((_, i) => mid + (i - (order.length - 1) / 2) * GAP);
    if (order === byY) tries.push({ order, ys: spread, slide: SLIDE });
    tries.push({ order, ys: packed, slide: SLIDE + 16 });
  }
  for (const t of tries) {
    for (let k = 0; k <= t.slide / 4; k++)
      for (const dy of k === 0 ? [0] : [-4 * k, 4 * k]) {
        const rows = t.order.map((l, i): PlacedRow => ({ label: l, slice: labels[l].slice, x, y: t.ys[i] + dy, align: side }));
        const rect = union(rows.map((r) => rowRect(r, w)));
        if (!clear(rect, z, obstacles)) continue;
        if (rows.some((r) => z.copy.some((c) => segmentHits(anchors[r.label].x, anchors[r.label].y, lx, r.y, c)))) continue;
        const tangled = rows.some((r, i) => rows.slice(i + 1).some((q) =>
          crosses(anchors[r.label], { x: lx, y: r.y }, anchors[q.label], { x: lx, y: q.y })));
        if (tangled) continue;
        return { mode: 'column', attach: 'side', side, rows, rect };
      }
  }
  return null;
}

/** Labels over (or under) their own slices, for sideways fans; null if they cannot clear. */
export function rowLayout(labels: FanLabel[], slices: Pt[][], attach: 'top' | 'bottom', z: Zones, obstacles: Rect[]): FanLayout | null {
  if (!labels.length) return null;
  const anchors = labels.map((l) => anchorOf(slices[l.slice], attach, 1));
  const first = anchorOf(slices[0], attach, 1);
  const last = anchorOf(slices[slices.length - 1], attach, 1);
  const align: 1 | -1 = last.x >= first.x ? 1 : -1;
  const order = labels.map((l, k) => k).sort((a, b) => (anchors[a].x - anchors[b].x) * align);
  const ws = labels.map(labelWidth);
  let R = 0;
  for (let n = 1; n <= 3 && !R; n++) {
    let ok = true;
    for (let i = 0; i + n < order.length && ok; i++) ok = Math.abs(anchors[order[i + n]].x - anchors[order[i]].x) >= ws[order[i]] + 6;
    if (ok) R = n;
  }
  if (!R) return null;
  const edge = attach === 'top'
    ? Math.min(...slices.flat().map((p) => p.y)) - 14
    : Math.max(...slices.flat().map((p) => p.y)) + 14;
  const rows = order.map((k, i): PlacedRow => {
    const r = i % R;
    return { label: k, slice: labels[k].slice, x: anchors[k].x - 4 * align, y: attach === 'top' ? edge - r * STEP : edge + r * STEP, align };
  });
  const rects = rows.map((r) => rowRect(r, ws[r.label]));
  if (!rects.every((r) => clear(r, z, obstacles))) return null;
  return { mode: 'row', attach, side: align, rows, rect: union(rects) };
}

/** Width of each label, by label index (the layer sizes its rows from these). */
export const widthsOf = (labels: FanLabel[]) => labels.map(labelWidth);

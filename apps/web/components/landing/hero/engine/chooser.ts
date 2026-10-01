// The fan direction chooser (LANDING-SPEC §5.6). Plans are made at the rest
// pose (home position, base orientation, rest camera), so the same click always
// gives the same fan; the interaction caches one plan per volume per layout.
// Candidates: vertical away from the nearer edge, horizontal outward, back into
// depth (not for far volumes or the keyboard path), the opposite vertical, and
// horizontal inward (never for the ghost, which always opens away from the
// copy); each at full then half spacing, with the full stack then a short one
// (three slices). Every slice drawn is labelled. Hard rules: the slices and every label clear the copy, the nav, the
// hint and the frame, and labels never sit on another cube. Among the plans
// that pass, overlap of the slices with other cubes costs by area, so a clean
// direction wins; those cubes are nudged aside while the fan is open.
import * as THREE from 'three';
import { fanZones, overlapArea, overlaps, screenBox, violation, type Rect, type Zones } from './exclusion';
import { fanLabels, type FanLabel } from './fan-labels';
import { ADV, columnLayout, rowLayout, type FanLayout, type Pt } from './fan-layout';
import { makePlan, sliceCorners, type FanPlan } from './fan-plan';
import type { Volume } from './volume';

const DEPTH = new THREE.Vector3(0, Math.SQRT1_2, -Math.SQRT1_2);
/** The ghost's way back: into depth and away from the copy (it sits at the left edge). */
const GHOST_BACK = new THREE.Vector3(-0.5, 0.5, -Math.SQRT1_2);
const _p = new THREE.Vector3();
/** A short stack: the head, the next version and the first checkpoint. */
const SHORT = 3;

export interface Yield { vol: Volume; x: number; y: number }
export interface Choice {
  plan: FanPlan;
  yields: Yield[];
  /** Screen box of the open slices and the volume, at rest (the fan holds while hovered). */
  stack: Rect;
}

/** A rect scaled about a point: the hover pop (×1.04) grows the cube and its slices about its centre. */
const POP = 1.05;
const grow = (r: Rect, c: Pt, k = POP): Rect => ({ x0: c.x + (r.x0 - c.x) * k, y0: c.y + (r.y0 - c.y) * k, x1: c.x + (r.x1 - c.x) * k, y1: c.y + (r.y1 - c.y) * k });
const popped = (r: Rect, z: Zones) => r.y0 < z.nav.y1 || r.x0 < 24 || r.x1 > z.w - 24 || r.y1 > z.h - 24;
const union = (rs: Rect[]): Rect => rs.reduce((a, r) => ({ x0: Math.min(a.x0, r.x0), y0: Math.min(a.y0, r.y0), x1: Math.max(a.x1, r.x1), y1: Math.max(a.y1, r.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
const bbox = (ps: Pt[]): Rect => union(ps.map((p) => ({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })));

export function choosePlan(vol: Volume, vols: Volume[], count: number, zones: Zones, camera: THREE.Camera, noDepth = false): Choice {
  const z = fanZones(zones);
  const project = (p: THREE.Vector3): Pt => {
    _p.copy(p).project(camera);
    return { x: (_p.x * 0.5 + 0.5) * z.w, y: (-_p.y * 0.5 + 0.5) * z.h };
  };
  const others = vols.filter((o) => o !== vol);
  const obstacles = others.map((o) => screenBox(o.outline(o.home, o.fit), camera, z.w, z.h));
  const c = project(vol.home);
  const own = screenBox(vol.outline(vol.home, vol.fit).slice(0, 8), camera, z.w, z.h);
  const named = z.w >= 640;
  const up = new THREE.Vector3(0, c.y > z.h / 2 ? 1 : -1, 0);
  const out = new THREE.Vector3(c.x > z.w / 2 ? 1 : -1, 0, 0);
  const ghost = vol.spec.kind === 'ghost';
  const dirs: [THREE.Vector3, boolean][] = ghost
    ? [[out, false], [GHOST_BACK, true], [up, false], [up.clone().negate(), false]]
    : [[up, false], [out, false], ...(noDepth || vol.home.z < -3 ? [] : [[DEPTH, true] as [THREE.Vector3, boolean]]), [up.clone().negate(), false], [out.clone().negate(), false]];
  const towardMiddle: 1 | -1 = c.x > z.w / 2 ? -1 : 1;

  // the full stack, then a short one: a short stack costs more than any change of direction
  const counts = count > SHORT ? [count, SHORT] : [count];
  let best: { plan: FanPlan; score: number; rects: Rect[] } | null = null;
  dirs.forEach(([dir, isDepth], di) => {
    for (const half of [false, true]) {
      const plan = makePlan(vol, dir, 1, half, isDepth);
      for (const n of counts) {
        const compact = n < count;
        const slices = corners(vol, plan, n, project);
        const rects = slices.map(bbox);
        // at rest every slice clears the copy, the nav and the frame; popped (×1.05,
        // with its lit rim) it still clears the nav band and keeps 24px off the viewport
        if (rects.some((r) => violation(r, z) > 0 || popped(grow(r, c), z))) continue;
        const stack = union([...rects, own]);
        const labels = fanLabels(vol.spec, n, false, named);
        let layout = placeLabels(labels, slices, rects, stack, towardMiddle, z, [...obstacles, own]);
        let moved = 0;
        if (!layout) {
          // labels may cover a neighbour only if that neighbour can step aside (it does, while open)
          const free = placeLabels(labels, slices, rects, stack, towardMiddle, z, [own]);
          const fan = free && union([...rects, free.rect]);
          if (!free || !fan) continue;
          const ys = yields(others, obstacles, fan, zones, camera);
          const blocked = obstacles.some((o, i) => overlaps(o, free.rect) && !ys.some((y) => y.vol === others[i]));
          if (blocked) continue;
          layout = free;
          moved = 60;
        }
        const soft = obstacles.reduce((a, o) => a + rects.reduce((b, r) => b + overlapArea(r, o), 0), 0);
        const score = (soft / 1000) * 50 + di * 20 + (half ? 30 : 0) + (compact ? 200 : 0) + moved;
        if (!best || score < best.score) best = { plan: { ...plan, side: layout.side, slices: n, compact, labels, layout }, score, rects };
        break;
      }
    }
  });
  const chosen = best as { plan: FanPlan; rects: Rect[] } | null;
  const plan = chosen?.plan ?? fallback(vol, count, project, own, towardMiddle, z, obstacles, named);
  plan.centre = c;
  const rects = chosen?.rects ?? corners(vol, plan, plan.slices, project).map(bbox);
  const fan = union(plan.layout ? [...rects, plan.layout.rect] : rects);
  return { plan, stack: union([...rects, own]), yields: yields(others, obstacles, fan, zones, camera) };
}

function corners(vol: Volume, plan: FanPlan, count: number, project: (p: THREE.Vector3) => Pt): Pt[][] {
  const pts = sliceCorners(vol, plan, count).map(project);
  const out: Pt[][] = [];
  for (let i = 0; i < pts.length; i += 4) out.push(pts.slice(i, i + 4));
  return out;
}

/** Sideways fans label each slice from above (or below); the rest use a column. */
function placeLabels(labels: FanLabel[], slices: Pt[][], rects: Rect[], stack: Rect, toward: 1 | -1, z: Zones, obstacles: Rect[]): FanLayout | null {
  const a = rects[0];
  const b = rects[rects.length - 1];
  const dx = (b.x0 + b.x1 - a.x0 - a.x1) / 2;
  const dy = (b.y0 + b.y1 - a.y0 - a.y1) / 2;
  const sideways = Math.abs(dx) > 1.2 * Math.abs(dy);
  const cols = () => columnLayout(labels, slices, toward, stack, z, obstacles) ?? columnLayout(labels, slices, -toward as 1 | -1, stack, z, obstacles);
  if (!sideways) return cols();
  return rowLayout(labels, slices, 'top', z, obstacles) ?? rowLayout(labels, slices, 'bottom', z, obstacles) ?? cols();
}

/** Nothing passes: back into depth at half spacing as a short stack, or the head alone; else a caption. */
function fallback(vol: Volume, count: number, project: (p: THREE.Vector3) => Pt, own: Rect, toward: 1 | -1, z: Zones, obstacles: Rect[], named: boolean): FanPlan {
  const plan = makePlan(vol, DEPTH, toward, true, true);
  for (const n of [Math.min(SHORT, count), 1]) {
    const slices = corners(vol, plan, n, project);
    const stack = union([...slices.map(bbox), own]);
    const labels = fanLabels(vol.spec, n, false, named);
    const layout = columnLayout(labels, slices, toward, stack, z, obstacles) ?? columnLayout(labels, slices, -toward as 1 | -1, stack, z, obstacles);
    if (layout) return { ...plan, side: layout.side, slices: n, compact: true, labels, layout };
  }
  const labels = fanLabels(vol.spec, count);
  const slices = corners(vol, plan, count, project);
  const stack = union([...slices.map(bbox), own]);
  return { ...plan, slices: count, labels, layout: null, caption: true, captionAt: captionSpot(vol.spec.name, labels, stack, z, obstacles) };
}

/**
 * The caption's text (as labels.ts writes it): two lines in the hint's place,
 * or, beside its stack (where the band is short), one line of the drive, its
 * head and its first checkpoint.
 */
export function captionLines(name: string, labels: FanLabel[], placed = false): [string, string] {
  const [head, ...rest] = labels;
  if (placed) {
    const cp = rest.find((l) => l.checkpoint);
    return [[name, head?.text.split(' · ')[0], cp?.text].filter(Boolean).join(' · '), ''];
  }
  return [`${name} · ${head?.text ?? ''}`, rest.map((l) => (l.checkpoint ? l.text : l.text.split(' · ')[0])).join('  ·  ')];
}

/**
 * Beside the stack it describes: under a volume in the upper half (between it
 * and the copy), over one in the lower half; the first spot clear of the copy,
 * the hint, the frame and the other cubes. Null keeps the hint's place.
 */
function captionSpot(name: string, labels: FanLabel[], stack: Rect, z: Zones, obstacles: Rect[]): { x: number; y: number } | null {
  const [a] = captionLines(name, labels, true);
  const w = a.length * ADV * (11.5 / 12) + 16;
  const h = 24;
  const cx = (stack.x0 + stack.x1) / 2;
  const x = Math.min(Math.max(cx - w / 2, z.safe.x0), z.safe.x1 - w);
  const upper = (stack.y0 + stack.y1) / 2 < z.h / 2;
  const ys = upper ? [stack.y1 + 6, stack.y0 - 6 - h] : [stack.y0 - 6 - h, stack.y1 + 6];
  for (const y of ys) {
    const r: Rect = { x0: x, y0: y, x1: x + w, y1: y + h };
    if (violation(r, z) > 0 || obstacles.some((o) => overlaps(o, r))) continue;
    return { x, y };
  }
  return null;
}

/**
 * Neighbours under the open fan step aside: pushed out along the separating
 * axis by overlap / px-per-unit + .15u, kept inside the frame and off the copy.
 */
function yields(others: Volume[], rects: Rect[], fan: Rect, zones: Zones, camera: THREE.Camera): Yield[] {
  const out: Yield[] = [];
  const cam = camera as THREE.PerspectiveCamera;
  const f: Rect = { x0: fan.x0 - 16, y0: fan.y0 - 16, x1: fan.x1 + 16, y1: fan.y1 + 16 };
  const fc = { x: (f.x0 + f.x1) / 2, y: (f.y0 + f.y1) / 2 };
  others.forEach((o, i) => {
    const r = rects[i];
    if (!overlaps(r, f)) return;
    const ppu = zones.h / (2 * (cam.position.z - o.home.z) * Math.tan((cam.fov * Math.PI) / 360));
    const sx = (r.x0 + r.x1) / 2 > fc.x ? 1 : -1;
    const sy = (r.y0 + r.y1) / 2 > fc.y ? 1 : -1;
    const ox = sx > 0 ? f.x1 - r.x0 : r.x1 - f.x0;
    const oy = sy > 0 ? f.y1 - r.y0 : r.y1 - f.y0;
    const tries: [number, number][] = ox < oy ? [[sx * ox, 0], [0, sy * oy]] : [[0, sy * oy], [sx * ox, 0]];
    for (const [px, py] of tries) {
      if (Math.hypot(px, py) / ppu > 1.4) continue;
      const moved: Rect = { x0: r.x0 + px, y0: r.y0 + py, x1: r.x1 + px, y1: r.y1 + py };
      if (violation(moved, zones) > 0 || overlaps(moved, f)) continue;
      const k = 1 / ppu;
      out.push({ vol: o, x: px * k + Math.sign(px) * 0.15, y: -(py * k + Math.sign(py) * 0.15) });
      return;
    }
  });
  return out;
}

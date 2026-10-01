// Exclusion zones, enforced at runtime (LANDING-SPEC §5.4): nothing floats
// under the lockup, in the nav band or off the frame. Measured on init and on
// every resize (after fonts), never inside the render loop.
import * as THREE from 'three';

export interface Rect { x0: number; y0: number; x1: number; y1: number }

export interface Zones {
  w: number;
  h: number;
  /** One padded rect per copy line (eyebrow, wordmark, tagline, subline, CTAs, agents). */
  copy: Rect[];
  /** The same lines with a hairline pad: what fan slices and labels must clear. */
  tight: Rect[];
  nav: Rect;
  hint: Rect;
  safe: Rect;
}

const COPY_PAD = 32;
const TIGHT_PAD = 10;

export const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
export const within = (a: Rect, b: Rect) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/** How badly a screen rect breaks the zones (0 = clear). */
export function violation(r: Rect, z: Zones): number {
  let v = overlapArea(r, z.nav);
  for (const c of z.copy) v += overlapArea(r, c);
  const area = (r.x1 - r.x0) * (r.y1 - r.y0);
  v += area - overlapArea(r, z.safe);
  return v;
}

/** Content rect of an element (text range for text blocks, so centred lines are tight). */
function contentRect(el: Element): DOMRect {
  if (el.children.length === 0 || el.matches('h1 > span, p')) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    if (r.width > 0) return r;
  }
  return el.getBoundingClientRect();
}

export function measureZones(hero: HTMLElement, copyEls: Element[], navH: number): Zones {
  const hr = hero.getBoundingClientRect();
  const w = hr.width;
  const h = hr.height;
  const lines = copyEls
    .map((el) => {
      const r = contentRect(el);
      // display type: the text box runs well past the glyphs (ascent/descent); trim to the ink
      const trim = el.matches('.kd-wordmark, .kd-tagline') ? parseFloat(getComputedStyle(el).fontSize) || 0 : 0;
      const up = el.matches('.kd-wordmark') ? 0.2 : 0.12;
      const down = el.matches('.kd-wordmark') ? 0.2 : 0.08;
      return { x0: r.left - hr.left, y0: r.top - hr.top + trim * up, x1: r.right - hr.left, y1: r.bottom - hr.top - trim * down };
    })
    .filter((r) => r.x1 > r.x0 && r.y1 > r.y0);
  const pad = (p: number) => (r: Rect): Rect => ({ x0: r.x0 - p, y0: r.y0 - p, x1: r.x1 + p, y1: r.y1 + p });
  // phones: the bands above and below the copy are short, so every margin is a little tighter
  const phone = w < 640;
  const copy = lines.map(pad(phone ? 20 : COPY_PAD));
  const tight = lines.map(pad(TIGHT_PAD));
  const inset = phone ? 20 : 40;
  return {
    w,
    h,
    copy,
    tight,
    nav: { x0: 0, y0: 0, x1: w, y1: phone ? navH + 14 : Math.max(88, navH + 24) },
    hint: { x0: 0, y0: h - (phone ? 52 : 64), x1: w, y1: h },
    safe: { x0: inset, y0: inset, x1: w - inset, y1: h - inset },
  };
}

/** Zones for the fan: slices and labels clear the copy lines (hairline pad) and the hint band. */
export const fanZones = (z: Zones): Zones => ({ ...z, copy: [...z.tight, z.hint] });

/** Does the segment (x0,y0)–(x1,y1) cross rect r? (Liang–Barsky clip.) */
export function segmentHits(x0: number, y0: number, x1: number, y1: number, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const edges: [number, number][] = [[-dx, x0 - r.x0], [dx, r.x1 - x0], [-dy, y0 - r.y0], [dy, r.y1 - y0]];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

const _c = new THREE.Vector3();
const warned = new Set<string>();

/** Screen AABB (hero px) of field-space points projected through the camera. */
export function screenBox(pts: THREE.Vector3[], camera: THREE.Camera, w: number, h: number): Rect {
  const r: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of pts) {
    _c.copy(p).project(camera);
    const x = (_c.x * 0.5 + 0.5) * w;
    const y = (-_c.y * 0.5 + 0.5) * h;
    r.x0 = Math.min(r.x0, x);
    r.x1 = Math.max(r.x1, x);
    r.y0 = Math.min(r.y0, y);
    r.y1 = Math.max(r.y1, y);
  }
  return r;
}

export interface Fittable {
  home: THREE.Vector3;
  fit: number;
  readonly spec: { name: string; pos: [number, number, number] };
  /** Field-space outline points at a given home and scale (cube corners plus trails, shells). */
  outline(home: THREE.Vector3, scale: number): THREE.Vector3[];
}

/**
 * Move each home from its layout position in 0.1u steps along one axis (x on
 * wide frames, y on tall ones), with a little play on the other, until its screen box
 * clears the copy, the nav band, the frame edge and the volumes placed before
 * it. Small pushes are tried first at shrinking scales, then long pushes;
 * failing all that, the least bad position wins (and a dev warning says so).
 */
export function fitHomes(vols: Fittable[], zones: Zones, camera: THREE.Camera, pushY: boolean, dev: boolean): void {
  const placed: Rect[] = [];
  // the hint line keeps its band too
  const z: Zones = { ...zones, copy: [...zones.copy, zones.hint] };
  for (const v of vols) {
    const base = new THREE.Vector3(...v.spec.pos);
    let best: { home: THREE.Vector3; fit: number; bad: number; d: number; box: Rect } | null = null;
    const search = (maxSteps: number): boolean => {
      for (const fit of [1, 0.92, 0.84, 0.76])
        for (let step = 0; step <= maxSteps; step++)
          for (const sgn of step === 0 ? [1] : [1, -1])
            for (const e of [0, -0.2, 0.2, -0.4, 0.4]) {
              const d = step * 0.1 * sgn;
              const home = base.clone();
              if (pushY) { home.y += d; home.x += e; }
              else { home.x += d; home.y += e; }
              const box = screenBox(v.outline(home, fit), camera, zones.w, zones.h);
              const bad = violation(box, z) + placed.reduce((a, r) => a + overlapArea(box, r) * 0.5, 0);
              const cost = Math.abs(d) + Math.abs(e) + (1 - fit) * 4;
              if (!best || bad < best.bad - 1 || (bad <= best.bad && cost < best.d)) best = { home, fit, bad, d: cost, box };
              if (bad === 0) return true;
            }
      return false;
    };
    if (!search(12)) search(40);
    const b = best as { home: THREE.Vector3; fit: number; bad: number; d: number; box: Rect } | null;
    if (!b) continue;
    v.home.copy(b.home);
    v.fit = b.fit;
    placed.push(b.box);
    const key = `${v.spec.name}:${b.d.toFixed(1)}:${Math.round(b.bad)}`;
    if (dev && (b.d > 0.8 || b.bad > 0) && !warned.has(key)) {
      warned.add(key);
      console.warn(`[hero] ${v.spec.name}: moved ${b.d.toFixed(1)} (push + scale), fit ${b.fit}, overlap ${Math.round(b.bad)}px²`);
    }
  }
}

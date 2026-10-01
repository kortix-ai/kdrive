// The SSR poster (LANDING-SPEC §5.7): the same composition as the WebGL scene,
// from the same layout.ts, through the same camera projection, drawn as flat
// isometric voxel art in graphite tones. Shown at first paint and kept as the
// illustration when WebGL is unavailable. Pure TS (no three.js), server-side.
import { TRAIL, boxesOf, cellsOf, extentsOf, type Layout, type VolumeSpec } from './engine/layout';
import { SCENE_DARK, type ScenePalette } from './engine/palette';

type V3 = [number, number, number];
type M3 = [V3, V3, V3];

/** Rotation matrix for Euler angles in XYZ order (as three.js composes it). */
function eulerXYZ([x, y, z]: V3): M3 {
  const [a, b, c, d, e, f] = [Math.cos(x), Math.sin(x), Math.cos(y), Math.sin(y), Math.cos(z), Math.sin(z)];
  return [
    [c * e, -c * f, d],
    [a * f + b * e * d, a * e - b * f * d, -b * c],
    [b * f - a * e * d, b * e + a * f * d, a * c],
  ];
}
const mul = (m: M3, v: V3): V3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

const LIGHT = norm([-0.45, 1, 0.35]);

/** The stack's two shells behind it (as decor.ts). */
const STACK_K = [0.6, 0.4];
const TRAIL_DIR: V3 = norm(TRAIL.dir);

interface Cam { z: number; t: number; aspect: number; W: number; H: number; near: number; far: number; p: ScenePalette; bg: V3 }
interface Item { depth: number; svg: string }

function proj(c: Cam, p: V3): [number, number] {
  const d = c.z - p[2];
  return [((p[0] / (d * c.t * c.aspect)) * 0.5 + 0.5) * c.W, (0.5 - (p[1] / (d * c.t)) * 0.5) * c.H];
}
const fogK = (c: Cam, p: V3) => Math.min(1, Math.max(0, (c.z - p[2] - c.near) / (c.far - c.near)));
const pts = (c: Cam, ps: V3[]) => ps.map((p) => proj(c, p).map((n) => n.toFixed(1)).join(',')).join(' ');
const rgb = (v: V3) => `rgb(${v.map((n) => Math.round(n)).join(',')})`;

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Graphite face tone, fogged toward the ground colour. The scene's faces are
 * brushed metal, so their tone follows what they reflect: the view ray
 * mirrored in the face, whose height picks the studio dome (softbox above,
 * graphite floor below). Fitted to the live render's measured tones (a top
 * face about #7c808a, a side face #2c2e3a, a face turned down #21222e), so
 * the hand-off from poster to canvas has no jump in tone.
 */
function tone(c: Cam, n: V3, fog: number, view: V3): string {
  const t = c.p.poster;
  const dn = dot(view, n);
  const ry = view[1] - 2 * dn * n[1];
  const L = t.lo + t.mid * Math.min(1, Math.max(0, (ry + 1) / 0.55)) + t.hi * smooth(-0.45, 0.95, ry);
  // a whisper of variation with the light, so neighbouring faces are not flat paint
  const k = 0.96 + 0.08 * Math.max(0, dot(n, LIGHT));
  const base: V3 = [L * 0.98 * k, L * k, Math.min(255, (L + t.tint) * k)];
  return rgb(base.map((b, i) => b + (c.bg[i] - b) * fog) as V3);
}

const FACES: { n: V3; q: V3[] }[] = [
  { n: [1, 0, 0], q: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
  { n: [-1, 0, 0], q: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
  { n: [0, 1, 0], q: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
  { n: [0, -1, 0], q: [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]] },
  { n: [0, 0, 1], q: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], q: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];

function boxFaces(c: Cam, m: M3, at: V3, centre: V3, h: V3, fill: (n: V3, fog: number, view: V3) => string, skip: (i: number) => boolean, out: Item[], bias = 0) {
  FACES.forEach((f, i) => {
    if (skip(i)) return;
    const n = mul(m, f.n);
    const fc = add(at, mul(m, [centre[0] + f.n[0] * h[0], centre[1] + f.n[1] * h[1], centre[2] + f.n[2] * h[2]]));
    if (dot(n, [-fc[0], -fc[1], c.z - fc[2]]) <= 0) return; // back face
    const ps = f.q.map((q) => add(at, mul(m, [centre[0] + q[0] * h[0], centre[1] + q[1] * h[1], centre[2] + q[2] * h[2]])));
    const fog = fogK(c, fc);
    const view = norm([fc[0], fc[1], fc[2] - c.z]);
    // a top face's edges carry the live bevel's highlight as a 1px lighter stroke
    const lit = bias === 0 && n[1] > 0.6;
    const stroke = lit ? `stroke="${c.p.poster.edge}" stroke-opacity="${(c.p.poster.edgeK * (1 - fog)).toFixed(2)}" stroke-width="1"` : `stroke="${c.p.poster.plate}" stroke-width=".5"`;
    out.push({ depth: c.z - fc[2] + bias, svg: `<polygon points="${pts(c, ps)}" fill="${fill(n, fog, view)}" ${stroke} stroke-linejoin="round"/>` });
  });
}

const EDGES: [number, number][] = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
function outline(c: Cam, m: M3, at: V3, h: V3, style: string, depthBias: number, out: Item[]) {
  const corners: V3[] = [];
  for (const sz of [-1, 1]) for (const sy of [-1, 1]) for (const sx of [-1, 1]) corners.push(add(at, mul(m, [sx * h[0], sy * h[1], sz * h[2]])));
  const d = EDGES.map(([a, b]) => `M${pts(c, [corners[a]])}L${pts(c, [corners[b]])}`).join('');
  out.push({ depth: c.z - at[2] + depthBias, svg: `<path d="${d}" fill="none" ${style}/>` });
}

/** A solid's grid as fine panel lines on its camera-facing faces, as in the scene. */
function panelLines(c: Cam, m: M3, at: V3, h: V3, cells: V3, out: Item[]) {
  for (const f of FACES) {
    const n = mul(m, f.n);
    const fc = add(at, mul(m, [f.n[0] * h[0], f.n[1] * h[1], f.n[2] * h[2]]));
    if (dot(n, [-fc[0], -fc[1], c.z - fc[2]]) <= 0) continue;
    const axis = f.n.findIndex((x) => x !== 0);
    let d = '';
    for (const a of [(axis + 1) % 3, (axis + 2) % 3]) {
      const b = 3 - axis - a;
      for (let i = 1; i < cells[a]; i++) {
        const p0: V3 = [0, 0, 0];
        p0[axis] = f.n[axis] * h[axis] * 1.002;
        p0[a] = -h[a] + (2 * h[a] * i) / cells[a];
        const p1: V3 = [...p0];
        p0[b] = -h[b];
        p1[b] = h[b];
        d += `M${pts(c, [add(at, mul(m, p0))])}L${pts(c, [add(at, mul(m, p1))])}`;
      }
    }
    if (d) out.push({ depth: c.z - fc[2] - 0.01, svg: `<path d="${d}" fill="none" stroke="${c.p.poster.panel}" stroke-width="1"/>` });
  }
}

/** The trail at rest: three '>' chevrons behind the volume (the sketch's "»"), as in the scene. */
function trail(c: Cam, v: VolumeSpec, out: Item[]) {
  TRAIL.k.forEach((o, k) => {
    const sc = v.size * Math.pow(0.88, k);
    const tip = add(v.pos, TRAIL_DIR.map((t) => t * v.size * (TRAIL.first + k * TRAIL.step * TRAIL.rest)) as V3);
    const arm = (s: number) => add(tip, [-TRAIL.back * sc, s * TRAIL.half * sc, 0]);
    out.push({ depth: c.z - tip[2] + 0.5, svg: `<polyline points="${pts(c, [arm(1), tip, arm(-1)])}" fill="none" stroke="${c.p.poster.trail}" stroke-width="1" stroke-linejoin="round" opacity="${o}"/>` });
  });
}

function volume(c: Cam, v: VolumeSpec, out: Item[]) {
  const m = eulerXYZ(v.rot);
  const at = v.pos;
  const h = extentsOf(v);
  const fog = fogK(c, at);
  const dash = (k: number) => `stroke="${c.p.poster.dash}" stroke-width="1" stroke-dasharray="5 4" opacity="${(k * (1 - fog)).toFixed(2)}"`;
  if (v.kind === 'ghost') return outline(c, m, at, h, dash(0.42), 0, out);
  // contact shade
  const [sx, sy] = proj(c, [at[0], at[1] - v.size * 0.85, at[2] - 0.2]);
  const [ex] = proj(c, [at[0] + v.size * 0.85, at[1] - v.size * 0.85, at[2] - 0.2]);
  const rx = Math.abs(ex - sx);
  out.push({ depth: 1e3, svg: `<ellipse cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${(rx * 0.42).toFixed(1)}" fill="url(#kdps-${c.p.name})" opacity="${((1 - fog) * c.p.poster.shadeK).toFixed(2)}"/>` });
  if (v.kind === 'stack') for (const k of [2, 1]) outline(c, m, add(at, [0.08 * v.size * k * 2.2, 0.05 * v.size * k * 2.2, -0.18 * v.size * k * 2.2]), h, dash(STACK_K[k - 1]), 0.5, out);
  if (v.kind === 'trail') trail(c, v, out);
  // the boxes (cells, a seam's two plates, a slab's key); faces against a neighbour stay hidden
  for (const b of boxesOf(v)) boxFaces(c, m, at, b.c, b.h, (n, f, view) => tone(c, n, f, view), (i) => b.nb[i], out);
  if (v.kind === 'solid' && v.n > 1) panelLines(c, m, at, h, cellsOf(v), out);
  // the dark core behind the grout, so the gaps read as shadow, never as see-through
  // (drawn before every face of this volume: it sits inside them). A seam
  // volume's core is split at the seam, and its lit plate is drawn first of all,
  // so the plate shows only through the gap between the layers: a hairline.
  const core = (centre: V3, half: V3) => boxFaces(c, m, at, centre, half, () => c.p.poster.core, () => false, out, v.size);
  if (v.kind === 'seam') {
    const gap = v.size * 0.025;
    boxFaces(c, m, at, [0, 0, 0], [v.size * 0.45, 0.004, v.size * 0.45], () => c.p.poster.seam, () => false, out, v.size * 1.5);
    const hy = (h[1] * 0.9 - gap) / 2;
    for (const s of [-1, 1]) core([0, s * (gap + hy), 0], [h[0] * 0.9, hy, h[2] * 0.9]);
  } else core([0, 0, 0], h.map((x) => x * 0.9) as V3);
}

/** The whole composition as an SVG string at a reference viewport, in one theme's palette. */
export function posterSvg(layout: Layout, W: number, H: number, p: ScenePalette = SCENE_DARK): string {
  const aspect = W / H;
  const t = Math.tan((layout.fov * Math.PI) / 360);
  const z = Math.max(layout.camZ, layout.halfW / (t * aspect));
  const bg: V3 = [(p.ground >> 16) & 255, (p.ground >> 8) & 255, p.ground & 255];
  const c: Cam = { z, t, aspect, W, H, near: z + p.fogNear, far: z + p.fogFar, p, bg };
  const items: Item[] = [];
  for (const v of layout.volumes) volume(c, v, items);
  items.sort((a, b) => b.depth - a.depth);
  const defs =
    `<defs><radialGradient id="kdps-${p.name}"><stop offset="0" stop-color="${p.poster.shade}" stop-opacity=".45"/><stop offset=".5" stop-color="${p.poster.shade}" stop-opacity=".2"/><stop offset="1" stop-color="${p.poster.shade}" stop-opacity="0"/></radialGradient></defs>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${defs}${items.map((i) => i.svg).join('')}</svg>`;
}

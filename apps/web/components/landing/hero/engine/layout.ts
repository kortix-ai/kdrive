// The hero composition (LANDING-SPEC §5.4), after the owner's sketch: loose
// volumes around the name, the centre kept clear for the lockup. Pure data with
// no three.js import, so the SSR poster renders from the very same numbers.

export type VolumeKind = 'solid' | 'monolith' | 'seam' | 'trail' | 'ghost' | 'slab' | 'stack';

export interface VolumeSpec {
  name: string;
  kind: VolumeKind;
  /**
   * Voxels per edge for a solid or ghost (the one subdivided volume: fine panel
   * lines, never a puzzle grid). A slab is one plate size/n thick; a seam is
   * two plates; every other kind is a single bevelled block.
   */
  n: number;
  size: number;
  pos: [number, number, number];
  rot: [number, number, number];
  head: number;
  checkpoint: string | null;
  /** Hover tag, line 1 after the name and head version. */
  edited: string;
  /** A slab's one raised key, centred on its top face; it breathes (lifts 0–.06u every 6 s). */
  key?: boolean;
}

export type LayoutKind = 'desktop' | 'tablet' | 'mobile';

export interface Layout {
  kind: LayoutKind;
  /** Phones: 4 volumes, 4 slices, tap only (no hover, proximity or orbit). */
  mobile: boolean;
  /** Tall frames push homes along y (above / below the copy), wide ones along x. */
  pushY: boolean;
  fov: number;
  camZ: number;
  /** World half-width that must stay in frame; camZ grows on narrow screens. */
  halfW: number;
  volumes: VolumeSpec[];
}

// Isometric base tilt: atan(1/√2) around x after 45° around y (Euler XYZ).
const ISO_X = 0.6155;
const ISO_Y = Math.PI / 4;
const r = (dx: number, dy: number, dz: number): [number, number, number] => [ISO_X + dx, ISO_Y + dy, dz];

type V3 = [number, number, number];

/** Grid counts along x, y, z: a solid's panel lines (and its ghost's dashed grid, its fan's face). */
export function cellsOf(v: Pick<VolumeSpec, 'kind' | 'n'>): V3 {
  if (v.kind === 'solid' || v.kind === 'ghost') return [v.n, v.n, v.n];
  return v.kind === 'seam' ? [1, 2, 1] : [1, 1, 1];
}

/** Half extents of the volume's body (a slab is a plate size/n thick). */
export function extentsOf(v: Pick<VolumeSpec, 'kind' | 'n' | 'size'>): V3 {
  const h = v.size / 2;
  return [h, v.kind === 'slab' ? h / v.n : h, h];
}

/**
 * The motion trail (the sketch's "»"): three '>' chevrons behind Photos, toward
 * −x, fading .42 → .14. Chevron k's tip sits (first + k·step·reach) × size from
 * the centre; its arms reach back `back` and out ±`half` (× size, × .88^k).
 */
export const TRAIL = { dir: [-1, -0.08, 0.05] as V3, k: [0.42, 0.26, 0.14], first: 0.84, step: 0.2, half: 0.3, back: 0.16, rest: 0.8 };

/** The gap between a seam's two plates' grout, as a fraction of the plate: under the bevel radius. */
export const VOXEL_GAP = 0.015;
/** How far exposed core faces sit inside a box (fraction of its size from its centre). */
const CORE_INSET = 0.4;

/** One drawn box of a volume, in local units; `nb` marks faces hidden by a neighbour (+x −x +y −y +z −z). */
export interface VoxelBox { c: V3; h: V3; nb: boolean[]; breath: boolean; coreC: V3; coreH: V3 }

/**
 * Every box a volume draws: one bevelled block (a solid's grid is drawn as fine
 * panel lines on it, never as separate voxels), a seam's two plates (apart by
 * 5% of the size, the lit joint between them) and a slab's raised key. Pure
 * data, shared by the WebGL scene and the SSR poster.
 */
export function boxesOf(v: VolumeSpec): VoxelBox[] {
  if (v.kind === 'ghost') return [];
  const [nx, ny, nz] = v.kind === 'seam' ? [1, 2, 1] : [1, 1, 1];
  const ext = extentsOf(v);
  const p: V3 = [(2 * ext[0]) / nx, (2 * ext[1]) / ny, (2 * ext[2]) / nz];
  const g = VOXEL_GAP * Math.min(...p);
  const seam = v.kind === 'seam' ? v.size * 0.025 : 0;
  const has = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz;
  const out: VoxelBox[] = [];
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const c: V3 = [(x - (nx - 1) / 2) * p[0], (y - (ny - 1) / 2) * p[1] + (seam ? (y < ny / 2 ? -seam : seam) : 0), (z - (nz - 1) / 2) * p[2]];
        const nb = [has(x + 1, y, z), has(x - 1, y, z), has(x, y + 1, z) && !seam, has(x, y - 1, z) && !seam, has(x, y, z + 1), has(x, y, z - 1)];
        // core: meets the neighbour's core across a shared face, inset on exposed faces
        const lo = [has(x - 1, y, z), has(x, y - 1, z), has(x, y, z - 1)].map((n, i) => (n ? 0.5 : CORE_INSET) * p[i]);
        const hi = [has(x + 1, y, z), has(x, y + 1, z), has(x, y, z + 1)].map((n, i) => (n ? 0.5 : CORE_INSET) * p[i]);
        out.push({
          c,
          h: [(p[0] - g) / 2, (p[1] - g) / 2, (p[2] - g) / 2],
          nb,
          breath: false,
          coreC: [c[0] + (hi[0] - lo[0]) / 2, c[1] + (hi[1] - lo[1]) / 2, c[2] + (hi[2] - lo[2]) / 2],
          coreH: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
        });
      }
  if (v.key) {
    // a square key a third of the plate wide, standing .34 of the plate's thickness proud
    const t = 2 * ext[1];
    const kh = 0.34 * t + 0.06 * t;
    const c: V3 = [0, ext[1] + kh / 2 - 0.06 * t, 0];
    out.push({ c, h: [(v.size / 3 - g) / 2, kh / 2, (v.size / 3 - g) / 2], nb: [false, false, false, true, false, false], breath: true, coreC: c, coreH: [0.001, 0.001, 0.001] });
  }
  return out;
}

// Studio: the one subdivided volume, a whole block with a 2 × 2 grid of fine
// panel lines (no grooves, no carve, no twitching voxel): never a puzzle cube.
const STUDIO: VolumeSpec = { name: 'Studio', kind: 'solid', n: 2, size: 1.12, pos: [-4.75, -0.9, -0.4], rot: r(0.05, 0.12, 0.04), head: 44, checkpoint: 'before launch', edited: '2 min ago' };
const THESIS: VolumeSpec = { name: 'Thesis', kind: 'monolith', n: 1, size: 1.05, pos: [4.6, 2.1, 0.2], rot: r(-0.08, -0.22, -0.05), head: 18, checkpoint: 'submitted', edited: '3 days ago' };
const RESEARCH: VolumeSpec = { name: 'Research', kind: 'seam', n: 2, size: 1.5, pos: [5.1, -1.45, -1.4], rot: r(0.02, 0.35, 0.06), head: 31, checkpoint: 'draft 2 sent', edited: '1 h ago' };
const PHOTOS: VolumeSpec = { name: 'Photos', kind: 'trail', n: 1, size: 0.62, pos: [-3.1, -2.3, 1.0], rot: r(0.1, -0.3, 0), head: 12, checkpoint: 'trip sorted', edited: 'uploading' };
const GHOST: VolumeSpec = { name: 'Studio · Tue copy', kind: 'ghost', n: 2, size: 1.24, pos: [-6.1, 1.75, -4.0], rot: r(-0.05, 0.2, 0), head: 38, checkpoint: null, edited: 'duplicate of Studio at v38' };
const BRAND: VolumeSpec = { name: 'Brand', kind: 'slab', n: 3, size: 0.9, pos: [2.9, -2.6, -0.8], rot: r(-0.1, -0.1, 0.12), head: 9, checkpoint: 'v1 brand', edited: '5 days ago', key: true };
const ARCHIVE: VolumeSpec = { name: 'Archive', kind: 'stack', n: 1, size: 0.85, pos: [-2.95, 3.25, -5.2], rot: r(0, 0.3, -0.06), head: 57, checkpoint: 'year end', edited: 'last month' };

// Positions are the spec's, settled by the runtime exclusion pass at the 1440×900
// reference, so the SSR poster and the first WebGL frame agree.
export const DESKTOP: Layout = {
  kind: 'desktop',
  mobile: false,
  pushY: false,
  fov: 30,
  camZ: 14,
  halfW: 6.0,
  volumes: [STUDIO, THESIS, RESEARCH, PHOTOS, GHOST, BRAND, ARCHIVE],
};

// Tablets and tall windows (≥640px wide, aspect .6–.9): five volumes in a loose
// scatter at varied heights, out toward the frame edges, clear of the hint
// (settled by the exclusion pass at the 820×1180 reference).
export const TABLET: Layout = {
  kind: 'tablet',
  mobile: false,
  pushY: true,
  fov: 32,
  camZ: 15,
  halfW: 3.3,
  volumes: [
    { ...STUDIO, size: 1.1, pos: [-2.15, 2.6, -0.4] },
    { ...BRAND, size: 0.8, pos: [2.45, 3.3, -1.2] },
    // two above the copy, three below: Research sits low right, clear of the wordmark
    { ...RESEARCH, size: 0.76, pos: [2.95, -2.25, -1.6] },
    { ...THESIS, size: 0.85, pos: [-2.35, -2.75, -0.6] },
    { ...PHOTOS, size: 0.58, pos: [0.75, -2.95, 0.6] },
  ],
};

// Phones: the spec's four, settled by the exclusion pass at the 390×844
// reference: a band of cubes above and below the copy, all inside 100svh.
export const MOBILE: Layout = {
  kind: 'mobile',
  mobile: true,
  pushY: true,
  fov: 32,
  camZ: 17,
  halfW: 2.2,
  volumes: [
    { ...STUDIO, size: 0.9, pos: [-1.05, 3.45, -0.2] },
    { ...RESEARCH, size: 1.0, pos: [1.05, 3.75, -1.8] },
    { ...PHOTOS, size: 0.5, pos: [1.2, -3.4, 0.6] },
    { ...THESIS, size: 0.74, pos: [-1.1, -3.75, -0.6] },
  ],
};

/**
 * Wide frames get the desktop field, tall ones the tablet field (≥640px) or the
 * phone field. Hysteresis at 0.85 / 0.95 around the 0.9 aspect switch.
 */
export function pickLayout(width: number, aspect: number, current: Layout | null): Layout {
  const wide = current?.kind === 'desktop' ? aspect >= 0.85 : aspect > 0.95 || (!current && aspect >= 0.9);
  if (wide) return DESKTOP;
  return width >= 640 && aspect >= 0.6 ? TABLET : MOBILE;
}

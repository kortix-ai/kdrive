// Isometric voxel geometry for the landing's SVG art (LANDING-SPEC §6.5, §6.8).
// Pure functions: boxes in grid units in, projected polygons out, painter-sorted.
// Greys only; strokes stay at 1px or more with at least 3:1 contrast.

export type Vec3 = readonly [number, number, number];
export type BoxStyle = 'solid' | 'hi' | 'lit' | 'ghost' | 'dim' | 'graphite';

export interface IsoBox {
  at: Vec3;
  size: Vec3;
  style?: BoxStyle;
}

export interface Face {
  kind: 'top' | 'left' | 'right';
  points: string;
}

export interface ProjectedBox {
  style: BoxStyle;
  faces: Face[];
  /** Front-top rim (the lit edges), as a polyline. */
  rim: string;
  /** Hidden back edges, drawn only for ghosts. */
  back: string;
}

const C30 = Math.cos(Math.PI / 6);
export const UNIT = 20;

export function project([x, y, z]: Vec3, u = UNIT): [number, number] {
  return [(x - z) * C30 * u, (x + z) * 0.5 * u - y * u];
}

const fmt = (pts: [number, number][]) => pts.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');

export class Bounds {
  x0 = Infinity;
  y0 = Infinity;
  x1 = -Infinity;
  y1 = -Infinity;
  add([x, y]: [number, number]) {
    this.x0 = Math.min(this.x0, x);
    this.y0 = Math.min(this.y0, y);
    this.x1 = Math.max(this.x1, x);
    this.y1 = Math.max(this.y1, y);
  }
  viewBox(pad = 8) {
    const w = this.x1 - this.x0 + pad * 2;
    const h = this.y1 - this.y0 + pad * 2;
    return `${(this.x0 - pad).toFixed(1)} ${(this.y0 - pad).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`;
  }
}

export function projectBox(b: IsoBox, bounds: Bounds): ProjectedBox {
  const [x, y, z] = b.at;
  const [w, h, d] = b.size;
  const v = (a: number, c: number, e: number) => {
    const p = project([a, c, e]);
    bounds.add(p);
    return p;
  };
  const top = [v(x, y + h, z), v(x + w, y + h, z), v(x + w, y + h, z + d), v(x, y + h, z + d)];
  const left = [v(x, y, z + d), v(x + w, y, z + d), v(x + w, y + h, z + d), v(x, y + h, z + d)];
  const right = [v(x + w, y, z), v(x + w, y, z + d), v(x + w, y + h, z + d), v(x + w, y + h, z)];
  const back = [v(x, y, z), v(x + w, y, z), v(x, y, z + d)];
  return {
    style: b.style ?? 'solid',
    faces: [
      { kind: 'left', points: fmt(left) },
      { kind: 'right', points: fmt(right) },
      { kind: 'top', points: fmt(top) },
    ],
    rim: fmt([top[3], top[0], top[1]]),
    back: `${fmt([back[1], back[0], back[2]])}|${fmt([back[0], top[0]])}`,
  };
}

/** Painter's order for this projection: back (small x+z) first, then low y first. */
export function sortBoxes(boxes: IsoBox[]): IsoBox[] {
  return [...boxes].sort((a, b) => {
    const da = a.at[0] + a.size[0] / 2 + a.at[2] + a.size[2] / 2;
    const db = b.at[0] + b.size[0] / 2 + b.at[2] + b.size[2] / 2;
    return da - db || a.at[1] - b.at[1];
  });
}

/** An n×n×n (or w×h×d) block of voxels with a thin grout gap. `style(i,j,k)` picks each voxel's look; null skips it. */
export function voxelBlock(
  dims: Vec3,
  origin: Vec3 = [0, 0, 0],
  style: (x: number, y: number, z: number) => BoxStyle | null = () => 'solid',
  gap = 0.08,
): IsoBox[] {
  const out: IsoBox[] = [];
  for (let k = 0; k < dims[2]; k++)
    for (let j = 0; j < dims[1]; j++)
      for (let i = 0; i < dims[0]; i++) {
        const s = style(i, j, k);
        if (!s) continue;
        out.push({
          at: [origin[0] + i + gap / 2, origin[1] + j + gap / 2, origin[2] + k + gap / 2],
          size: [1 - gap, 1 - gap, 1 - gap],
          style: s,
        });
      }
  return out;
}

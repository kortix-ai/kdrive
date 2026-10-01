// Static parts of each volume (LANDING-SPEC §5.4): the voxel slots drawn by the
// shared InstancedMesh, their dark cores, and the local line geometry for rims,
// ghosts, stack shells and trails (drawn by the two line batches).
import * as THREE from 'three';
import { boxesOf, extentsOf, type VolumeSpec } from './layout';
import { rng } from './springs';

export interface Slot {
  /** Local centre, before any lift. */
  p: THREE.Vector3;
  /** Box size along x, y, z (a seam's plates and a slab's key are not cubes). */
  s: THREE.Vector3;
  tone: number;
  breath: boolean;
  /** Dark core box behind the grout: local centre and size. */
  coreP: THREE.Vector3;
  coreS: THREE.Vector3;
}

/** The volume's boxes (layout.ts boxesOf) as instanced slots, each with a whisper of tone variation. */
export function voxelSlots(v: VolumeSpec, seed: number): Slot[] {
  const r = rng(seed);
  return boxesOf(v).map((b) => ({
    p: new THREE.Vector3(...b.c),
    s: new THREE.Vector3(...b.h).multiplyScalar(2),
    tone: 1 + (r() - 0.5) * 0.08,
    breath: b.breath,
    coreP: new THREE.Vector3(...b.coreC),
    coreS: new THREE.Vector3(...b.coreH).multiplyScalar(2),
  }));
}

/** Half extents of a volume's body, in local units. */
export function halfExtents(v: VolumeSpec): THREE.Vector3 {
  return new THREE.Vector3(...extentsOf(v));
}

type Seg = number[];

/** The 12 edges of a box centred at c with half extents h, as segment pairs. */
export function boxEdges(h: THREE.Vector3, c = new THREE.Vector3()): Seg {
  const out: Seg = [];
  const pt = (sx: number, sy: number, sz: number) => [c.x + sx * h.x, c.y + sy * h.y, c.z + sz * h.z];
  const s = [-1, 1];
  for (const a of s)
    for (const b of s) {
      out.push(...pt(-1, a, b), ...pt(1, a, b));
      out.push(...pt(a, -1, b), ...pt(a, 1, b));
      out.push(...pt(a, b, -1), ...pt(a, b, 1));
    }
  return out;
}

/**
 * Inner grid lines on every face of the box (the n-grid of a ghost, a solid's panel lines). `endInset` (a fraction
 * of each half extent) stops every line where the face stops being flat, so on a bevelled block no line end pokes
 * out past the rounded silhouette.
 */
export function faceGrid(h: THREE.Vector3, cells: [number, number, number], endInset = 0): Seg {
  const out: Seg = [];
  const ext = [h.x, h.y, h.z];
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const w = (axis + 2) % 3;
    for (const side of [-1, 1]) {
      // lines of constant u across the face, then constant w
      for (const [a, b] of [
        [u, w],
        [w, u],
      ]) {
        for (let i = 1; i < cells[a]; i++) {
          const q = -ext[a] + (2 * ext[a] * i) / cells[a];
          const p0 = [0, 0, 0];
          const p1 = [0, 0, 0];
          p0[axis] = p1[axis] = side * ext[axis];
          p0[a] = p1[a] = q;
          p0[b] = -ext[b] * (1 - endInset);
          p1[b] = ext[b] * (1 - endInset);
          out.push(...p0, ...p1);
        }
      }
    }
  }
  return out;
}

/** Cumulative dash distances for a segment list (restart per segment). */
export function segDistances(seg: Seg): Float32Array {
  const d = new Float32Array(seg.length / 3);
  for (let i = 0; i < d.length; i += 2) {
    const o = i * 3;
    d[i] = 0;
    d[i + 1] = Math.hypot(seg[o + 3] - seg[o], seg[o + 4] - seg[o + 1], seg[o + 5] - seg[o + 2]);
  }
  return d;
}

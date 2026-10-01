// Fan geometry (LANDING-SPEC §5.6), shared by the fan and its chooser: which
// local axis a stack runs along, where each slice sits and how big it is.
import * as THREE from 'three';
import type { FanLabel } from './fan-labels';
import type { FanLayout } from './fan-layout';
import type { Volume } from './volume';

export const AXES = [
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
];
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/** A planned fan: the local axis it runs along, spacing, the label side. */
export interface FanPlan {
  axis: THREE.Vector3;
  /** World -z in the volume's frame: slice i also recedes .18·i that way. */
  recede: THREE.Vector3;
  spacing: number;
  /**
   * A local turn applied to every plate: a fan running sideways or up/down
   * would show its plates edge-on, so they lean toward the camera (≥35° of face).
   */
  tilt: THREE.Quaternion;
  side: 1 | -1;
  /** How many slices the fan shows; every one of them is labelled. */
  slices: number;
  /** A short stack (fewer slices than the full history) where the full one cannot clear. */
  compact: boolean;
  /** The labels drawn, and where (fixed at plan time); null draws no labels. */
  labels: FanLabel[];
  layout: FanLayout | null;
  /** No room beside the stack: the labels read as one caption instead. */
  caption: boolean;
  /** The caption's top-left, beside its stack (under a top-band cube, over a bottom-band one); null: the hint's place. */
  captionAt?: { x: number; y: number } | null;
  /** The volume's planned screen centre: the labels follow its small drift from here. */
  centre: { x: number; y: number };
}

/** The volume's local axis that best faces a field-space direction; its face leads the stack. */
export function axisFor(vol: Volume, dir: THREE.Vector3): THREE.Vector3 {
  _q.copy(vol.baseQuaternion);
  let best = AXES[0];
  let bestDot = -2;
  for (const a of AXES) {
    const d = _v.copy(a).applyQuaternion(_q).dot(dir);
    if (d > bestDot) { bestDot = d; best = a; }
  }
  return best.clone();
}

/** Spacing between slices: .34 × size, wider into depth (so the slices read), halved when tight. */
export function makePlan(vol: Volume, dir: THREE.Vector3, side: 1 | -1, half = false, depth = false): FanPlan {
  const axis = axisFor(vol, dir);
  // "the past recedes": world -z expressed in the volume's local frame
  const recede = new THREE.Vector3(0, 0, -1).applyQuaternion(_q.copy(vol.baseQuaternion).invert());
  const spacing = (depth ? 0.5 : 0.34) * vol.size * (half ? 0.5 : 1);
  return { axis, recede, spacing, tilt: tiltFor(axis, recede), side, slices: 6, compact: false, labels: [], layout: null, caption: false, centre: { x: 0, y: 0 } };
}

/** cos 55°: a plate turned further from the view than this shows too little face. */
const MIN_FACE = Math.cos((55 * Math.PI) / 180);

/** Turn the plate normal (the axis) toward the camera just enough that it shows at least 35° of face. */
function tiltFor(axis: THREE.Vector3, recede: THREE.Vector3): THREE.Quaternion {
  const toCam = recede.clone().negate();
  const dn = axis.dot(toCam);
  if (Math.abs(dn) >= MIN_FACE) return new THREE.Quaternion();
  const c = toCam.multiplyScalar(dn >= 0 ? 1 : -1);
  const r = new THREE.Vector3().crossVectors(axis, c);
  if (r.lengthSq() < 1e-6) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromAxisAngle(r.normalize(), Math.acos(Math.abs(dn)) - Math.acos(MIN_FACE));
}

/** The volume's half extent along a local axis. */
const halfAlong = (vol: Volume, a: THREE.Vector3) => Math.abs(a.x) * vol.half.x + Math.abs(a.y) * vol.half.y + Math.abs(a.z) * vol.half.z;

/**
 * Local centre of slice i at open progress k. A slice starts at the face (never
 * inside the cube) and travels out to d_i = .6·size + i·spacing, receding .18·i.
 */
export function sliceCentre(vol: Volume, plan: FanPlan, i: number, k: number, out: THREE.Vector3): THREE.Vector3 {
  const face = halfAlong(vol, plan.axis);
  const d = face + (0.6 * vol.size - face + i * plan.spacing) * k;
  return out.copy(plan.axis).multiplyScalar(d).addScaledVector(plan.recede, 0.18 * i * k);
}

/** The face across the axis: its two in-plane directions and full sizes (× .985). */
export function faceExtents(vol: Volume, axis: THREE.Vector3) {
  const h = vol.half;
  const u = axis.x !== 0 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const w = axis.y !== 0 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  return { u, w, a: 2 * (u.x ? h.x : h.z) * 0.985, b: 2 * (w.y ? h.y : h.z) * 0.985 };
}

/** Field-space corners (4 per slice) of every slice of the fully open fan. */
export function sliceCorners(vol: Volume, plan: FanPlan, count: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const m = vol.homeMatrix(_m);
  const e = faceExtents(vol, plan.axis);
  for (let i = 0; i < count; i++) {
    const c = sliceCentre(vol, plan, i, 1, _w);
    const s = 0.5 * (1 - 0.03 * i);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      out.push(new THREE.Vector3().addScaledVector(e.u, sx * e.a * s).addScaledVector(e.w, sy * e.b * s).applyQuaternion(plan.tilt).add(c).applyMatrix4(m));
    }
  }
  return out;
}

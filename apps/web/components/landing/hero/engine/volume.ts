// One floating volume (LANDING-SPEC §5.4–5.6): its voxels in the shared
// instanced meshes and the springs for idle drift, proximity, hover, the click
// squash and the way home. Drag/throw lives in throw.ts, lines in decor.ts.
import * as THREE from 'three';
import { halfExtents, voxelSlots, type Slot } from './build';
import { Decor } from './decor';
import type { ScenePalette } from './palette';
import type { VolumeSpec } from './layout';
import type { LineBatch } from './lines';
import { Spring1, Spring3, clamp, rng, smoothstep, wander } from './springs';
import { Throw } from './throw';

export interface VolumeCtx {
  field: THREE.Group;
  alloc: (n: number) => number;
}

export interface Frame {
  t: number;
  dt: number;
  /** Idle amplitude: 0 under reduced motion, ramps 0 → 1 after the first frame. */
  amp: number;
  reduced: boolean;
  /** Pointer in hero px, or null when not hovering with a fine pointer. */
  pointer: { x: number; y: number } | null;
}

export type Mode = 'idle' | 'drag' | 'flight' | 'home';
export interface Box2 { minX: number; maxX: number; minY: number; maxY: number }
/** Where a volume's centre may go: the safe frame, and the copy lines it bounces off. */
export interface Bounds extends Box2 { blocks: Box2[] }

const _m = new THREE.Matrix4();
const _vm = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _e = new THREE.Euler();
const _bq = new THREE.Quaternion();

export class Volume {
  readonly size: number;
  readonly half: THREE.Vector3;
  readonly home: THREE.Vector3;
  readonly pivot = new THREE.Object3D();
  /** Projected centre in hero px, updated by the field each frame. */
  readonly screen = new THREE.Vector2();
  readonly throw = new Throw();
  fit = 1;
  hover = false;
  fanned = 0;
  mode: Mode = 'idle';
  /** Set when a throw has come home; the input re-picks hover then. */
  settled = false;
  readonly off = new Spring3(16, 0.92);
  /** Stepping aside while a neighbour's fan is open (released on close). */
  readonly yieldOff = new Spring3(40, 0.9);
  /** 1 while another volume's fan is open: this one steps back in tone. */
  readonly dim = new Spring1(0, 60, 1);
  readonly rot = new Spring3(40, 0.8);
  readonly lift = new Spring1(0, 60, 0.85);
  private readonly bright = new Spring1(1, 90, 1);
  private readonly rim = new Spring1(0, 90, 1);
  private readonly pop = new Spring1(1, 260, 0.6);
  private readonly squash = new Spring1(0, 900, 1);
  private squashUntil = -1;
  private readonly slots: Slot[];
  private readonly start: number;
  private readonly ph: number[];
  private readonly per: number[];
  private readonly decor: Decor;
  private readonly base: THREE.Euler;

  constructor(readonly spec: VolumeSpec, i: number, ctx: VolumeCtx) {
    this.size = spec.size;
    this.half = halfExtents(spec);
    this.home = new THREE.Vector3(...spec.pos);
    this.base = new THREE.Euler(...spec.rot, 'XYZ');
    this.pivot.matrixAutoUpdate = false;
    this.pivot.quaternion.setFromEuler(this.base);
    ctx.field.add(this.pivot);
    this.slots = voxelSlots(spec, 101 + i * 17);
    this.start = ctx.alloc(this.slots.length);
    // seeded phases and incommensurate periods: the idle never visibly loops
    const r = rng(31 + i * 7);
    this.ph = [0, 1, 2, 3, 4].map(() => r() * Math.PI * 2);
    this.per = [7 + r() * 4, 13 + r() * 4, 9 + r() * 3, 11 + r() * 3, 0.1 + r() * 0.04];
    this.decor = new Decor(spec, this.half, this.pivot);
  }

  /** Live theme switch: this volume's lines and seam. */
  retheme(p: ScenePalette): void {
    this.decor.retheme(p);
  }

  /** Field-space outline for the exclusion pass: cube corners plus trail copies and stack shells. */
  outline(home: THREE.Vector3, scale: number): THREE.Vector3[] {
    const q = new THREE.Quaternion().setFromEuler(this.base);
    const pts: THREE.Vector3[] = [];
    for (const o of [new THREE.Vector3(), ...this.decor.extraOffsets])
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const p = new THREE.Vector3(sx * this.half.x, sy * this.half.y, sz * this.half.z).multiplyScalar(scale * 1.06);
        pts.push(p.applyQuaternion(q).add(home).add(o));
      }
    return pts;
  }

  /** Base pose (no idle, no springs): the exclusion pass measures here. */
  rest(): void {
    this.pivot.quaternion.setFromEuler(this.base);
  }

  /** The base orientation (fans are planned against it, not the momentary turn). */
  get baseQuaternion(): THREE.Quaternion {
    return _bq.setFromEuler(this.base);
  }

  /** Home position with the base orientation and fit scale: fans are planned here, so a plan never depends on the momentary pose. */
  homeMatrix(out: THREE.Matrix4): THREE.Matrix4 {
    return out.compose(this.home, this.baseQuaternion, _s.setScalar(this.fit));
  }

  /** The click: squash to y .94 / xz 1.03 over 90ms, then overshoot back once. */
  anticipate(t: number): void {
    this.squash.set(900, 1).target = 1;
    this.squashUntil = t + 0.09;
  }

  /** Motion for one frame; writes the pivot matrix. */
  update(f: Frame, bounds: Bounds): void {
    const { t, dt, amp } = f;
    // proximity (fine pointer only; zero under reduced motion)
    let prox = 0;
    let rx = 0;
    let ry = 0;
    if (f.pointer && !f.reduced && this.mode === 'idle') {
      const dx = f.pointer.x - this.screen.x;
      const dy = f.pointer.y - this.screen.y;
      // wide enough that a cube reacts before the pointer is on it (space-aware, not hover-only)
      prox = 1 - smoothstep(80, 340, Math.hypot(dx, dy));
      rx = clamp(dx / 340, -1, 1);
      ry = clamp(dy / 340, -1, 1);
    }
    // an open fan holds its volume square to the plan (no proximity turn)
    const turn = this.fanned > 0 ? 0 : prox;
    if (this.mode === 'idle') this.rot.setTarget(ry * 0.26 * turn, rx * 0.32 * turn, 0);
    if (this.mode === 'drag') this.throw.hold(this, dt);
    this.lift.target = this.mode === 'drag' ? 0.3 : 0.35 * prox;
    this.bright.target = 1 + 0.18 * prox;
    this.rim.target = this.hover && this.mode !== 'drag' ? 0.5 : 0;
    this.pop.target = this.hover ? 1.04 : 1;
    if (this.squashUntil > 0 && t >= this.squashUntil) {
      this.squashUntil = -1;
      this.squash.set(260, 0.36).target = 0;
    }
    if (this.mode === 'flight') this.throw.fly(this, dt, bounds);
    else if (this.mode !== 'drag') {
      this.off.step(dt);
      // a nudged neighbour stays in frame: it reflects off the edge with restitution .35
      if (this.mode === 'home') this.keepIn(bounds);
    }
    for (const s of [this.rot, this.lift, this.bright, this.rim, this.pop, this.squash, this.dim]) s.step(dt);
    this.yieldOff.step(dt);
    if (this.mode === 'home' && this.off.energy + this.rot.energy < 0.01) {
      this.mode = 'idle';
      this.rot.set(40, 0.8);
      this.settled = true;
    }

    const [p0, p1, p2, p3, p4] = this.ph;
    const [T0, T1, T2, T3, A0] = this.per;
    // Photos drifts along +x (≈.05 u/s at its fastest), oscillating
    const drift = this.spec.kind === 'trail' ? wander(t, 0.16, 20, p1) : 0;
    const o = this.off.x;
    const y = this.yieldOff.x;
    this.pivot.position.set(
      this.home.x + o[0] + y[0] + (wander(t, 0.05, T1, p1) + drift) * amp,
      this.home.y + o[1] + y[1] + wander(t, A0, T0, p0) * amp,
      this.home.z + o[2] + this.lift.x,
    );
    _e.set(
      this.base.x + this.rot.x[0] + wander(t, 0.035, T2, p2) * amp,
      this.base.y + this.rot.x[1] + wander(t, 0.05, T3, p3) * amp,
      this.base.z + this.rot.x[2] + wander(t, 0.012, T3 * 1.3, p4) * amp,
      'XYZ',
    );
    this.pivot.quaternion.setFromEuler(_e);
    const sq = this.squash.x;
    const sc = this.pop.x * this.fit;
    this.pivot.scale.set(sc * (1 + 0.03 * sq), sc * (1 - 0.06 * sq), sc * (1 + 0.03 * sq));
    this.pivot.updateMatrix();
  }

  private keepIn(bb: Box2): void {
    const o = this.off;
    // never tighter than home itself (else the spring would fight the clamp forever)
    const h = this.home;
    const b = { minX: Math.min(bb.minX, h.x), maxX: Math.max(bb.maxX, h.x), minY: Math.min(bb.minY, h.y), maxY: Math.max(bb.maxY, h.y) };
    const x = this.home.x + o.x[0];
    const y = this.home.y + o.x[1];
    if (x < b.minX || x > b.maxX) { o.x[0] = clamp(x, b.minX, b.maxX) - this.home.x; o.v[0] *= -0.35; }
    if (y < b.minY || y > b.maxY) { o.x[1] = clamp(y, b.minY, b.maxY) - this.home.y; o.v[1] *= -0.35; }
  }

  /** Write voxels (with the 6 s breath), their cores and this volume's lines. */
  draw(f: Frame, voxels: THREE.InstancedMesh, cores: THREE.InstancedMesh, solid: LineBatch, dashed: LineBatch): void {
    const M = this.pivot.matrix;
    const breath = (0.03 + 0.03 * Math.sin((f.t * Math.PI * 2) / 6 + this.ph[0])) * f.amp;
    _q.identity();
    for (let k = 0; k < this.slots.length; k++) {
      const sl = this.slots[k];
      _v.copy(sl.p);
      if (sl.breath) _v.y += breath;
      _vm.compose(_v, _q, sl.s);
      voxels.setMatrixAt(this.start + k, _m.multiplyMatrices(M, _vm));
      voxels.setColorAt(this.start + k, _c.setScalar(sl.tone * this.bright.x * (1 - 0.45 * this.dim.x)));
      _vm.compose(sl.coreP, _q, sl.coreS);
      cores.setMatrixAt(this.start + k, _m.multiplyMatrices(M, _vm));
    }
    this.decor.draw(this.pivot, this.rim.x, this.fanned, 1 - 0.45 * this.dim.x, f, solid, dashed);
  }

  get energy(): number {
    const busy = this.mode !== 'idle' ? 1 : 0;
    return busy + this.off.energy + this.yieldOff.energy + this.dim.energy + this.rot.energy + this.lift.energy + this.bright.energy + this.rim.energy + this.pop.energy + this.squash.energy;
  }
}

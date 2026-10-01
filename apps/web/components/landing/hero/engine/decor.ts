// A volume's line and glow details (LANDING-SPEC §5.4): the hover rim, the
// dashed ghost and stack shells, the lit seam and the motion trail (the "»").
import * as THREE from 'three';
import { boxEdges, faceGrid } from './build';
import { TRAIL, cellsOf, type VolumeSpec } from './layout';
import { LineBatch, type LineItem } from './lines';
import { clamp, damp } from './springs';

/** The trail streams toward -x, behind the drifting Photos volume. */
export const TRAIL_DIR = new THREE.Vector3(...TRAIL.dir).normalize();
/** A '>' chevron: tip at the origin, arms back along -x (unit size). */
const CHEVRON = [-TRAIL.back, TRAIL.half, 0, 0, 0, 0, 0, 0, 0, -TRAIL.back, -TRAIL.half, 0];
/** The stack's still shells, a step brighter than a ghost's: they carry "versions behind" at rest. */
const STACK_K = [0.6, 0.4];
const _q0 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

interface Dashed { item: LineItem; k: number; offset: THREE.Vector3 }
interface DrawFrame { t: number; dt: number; amp: number }

export class Decor {
  private readonly rim: LineItem;
  /** A solid's grid as fine dark panel lines on its faces (the one subdivided volume). */
  private readonly panel: LineItem | null = null;
  private readonly trailFace: LineItem | null = null;
  private readonly dashed: Dashed[] = [];
  private readonly trail: THREE.Vector3[] = [];
  private readonly glow: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> | null = null;
  private readonly last = new THREE.Vector3();
  private speed = 0;

  constructor(private readonly spec: VolumeSpec, half: THREE.Vector3, pivot: THREE.Object3D) {
    // on the bevel itself, not a cage around it: the block is a unit rounded box
    // (radius .06 of each edge, so .12 of each half extent); just outside the
    // arc's 45° point the edge line lies on the rounded edge it brightens, and
    // the back edges stay hidden behind the faces
    this.rim = LineBatch.item(boxEdges(half.clone().multiplyScalar(RIM_INSET)), 0xe3e6ec);
    const zero = new THREE.Vector3();
    if (spec.kind === 'solid' && spec.n > 1) {
      // a hair off the faces (no z-fighting); the block hides the ones on its far side
      this.panel = LineBatch.item(faceGrid(half.clone().multiplyScalar(1.002), cellsOf(spec)), PANEL);
    }
    if (spec.kind === 'ghost') {
      // dashed edges plus the inner n-grid at 30%
      this.dashed.push({ item: LineBatch.item(boxEdges(half), 0x9aa0ab), k: 0.42, offset: zero });
      this.dashed.push({ item: LineBatch.item(faceGrid(half, cellsOf(spec)), 0x9aa0ab), k: 0.42 * 0.3, offset: zero });
    }
    if (spec.kind === 'stack') {
      // two still shells behind: "versions behind"
      const edges = LineBatch.item(boxEdges(half), 0x9aa0ab);
      for (const k of [1, 2]) {
        const offset = new THREE.Vector3(0.08, 0.05, -0.18).multiplyScalar(spec.size * k * 2.2);
        this.dashed.push({ item: edges, k: STACK_K[k - 1], offset });
      }
    }
    if (spec.kind === 'trail') {
      // three '>' chevrons (the sketch's "»"), not outlines of the cube
      this.trailFace = LineBatch.item(CHEVRON, 0xe3e6ec);
      const home = new THREE.Vector3(...spec.pos);
      this.last.copy(home);
      for (let k = 0; k < TRAIL.k.length; k++) this.trail.push(home.clone().addScaledVector(TRAIL_DIR, this.reach(k, TRAIL.rest)));
    }
    if (spec.kind === 'seam') {
      // a lit hairline between the layers, and a thin additive plate as its bloom
      // (depth-tested, so it never shows through the cube)
      // near white and faded toward its ends: a lit joint (as the poster draws it),
      // thick enough to hold at DPR 1
      const fade = jointFade();
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(spec.size * 0.9, 0.01, spec.size * 0.9),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0xeef1f7).multiplyScalar(0.85), alphaMap: fade, transparent: true, depthWrite: false, toneMapped: false }),
      );
      this.glow = new THREE.Mesh(
        new THREE.BoxGeometry(spec.size * 0.99, 0.03, spec.size * 0.99),
        new THREE.MeshBasicMaterial({ color: 0xcfd6e6, alphaMap: fade, transparent: true, opacity: GLOW, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      );
      pivot.add(line, this.glow);
    }
  }

  /** Field-space offsets whose outlines also count for the exclusion pass. */
  get extraOffsets(): THREE.Vector3[] {
    const out = this.dashed.filter((d) => d.offset.lengthSq() > 0).map((d) => d.offset);
    if (this.spec.kind === 'trail') out.push(TRAIL_DIR.clone().multiplyScalar((TRAIL.first + TRAIL.step) * this.spec.size));
    return out;
  }

  /** Distance of chevron k's tip from the centre, at a given stretch (rest .8, thrown up to 1.8). */
  private reach(k: number, stretch: number): number {
    return this.spec.size * (TRAIL.first + k * TRAIL.step * stretch);
  }

  /** tone: 1, or less while another volume's fan is open. */
  draw(pivot: THREE.Object3D, rim: number, fanned: number, tone: number, f: DrawFrame, solid: LineBatch, dashed: LineBatch): void {
    const M = pivot.matrix;
    solid.push(this.rim, M, rim);
    if (this.panel) solid.push(this.panel, M, tone);
    for (const d of this.dashed) {
      _m.makeTranslation(d.offset.x, d.offset.y, d.offset.z).multiply(M);
      dashed.push(d.item, _m, (d.k + (d.offset.lengthSq() === 0 ? rim * 0.5 : 0)) * tone, pivot.scale.x);
    }
    if (this.trailFace) {
      // the trail stretches with motion (thrown) and sits at .8 of its spacing at rest;
      // each chevron lags the one before, so a throw draws the "»" out
      const v = f.dt > 0 ? _v.copy(pivot.position).sub(this.last).length() / f.dt : 0;
      this.last.copy(pivot.position);
      this.speed = damp(this.speed, v, 6, f.dt);
      const stretch = clamp(this.speed / 0.4, TRAIL.rest, 1.8);
      const sc = pivot.scale.x;
      for (let k = 0; k < this.trail.length; k++) {
        _v.copy(pivot.position).addScaledVector(TRAIL_DIR, this.reach(k, stretch) * sc);
        const tp = this.trail[k];
        const l = 9 - 2 * k;
        tp.set(damp(tp.x, _v.x, l, f.dt), damp(tp.y, _v.y, l, f.dt), damp(tp.z, _v.z, l, f.dt));
        _m.compose(tp, _q0, _s.setScalar(this.spec.size * sc * Math.pow(0.88, k)));
        solid.push(this.trailFace, _m, TRAIL.k[k] * (1 - fanned) * tone);
      }
    }
    if (this.glow) this.glow.material.opacity = (GLOW + 0.016 * Math.sin(f.t * 0.8) * f.amp + rim * 0.05) * tone;
  }
}

/** Panel lines: a dark graphite hairline, a step above the core's near-black. */
const PANEL = 0x16171c;

/** The seam's glow plate. */
const GLOW = 0.18;

/** Rim edges at h × (1 − .187 × .12): just proud of the bevel arc's 45° point. */
const RIM_INSET = 1 - 0.187 * 0.12;

/** Alpha along a joint's length: 0 at the corners, full over the middle 60%. */
function jointFade(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 1;
  const g = c.getContext('2d');
  if (g) {
    const grd = g.createLinearGradient(0, 0, 64, 0);
    grd.addColorStop(0, '#000');
    grd.addColorStop(0.2, '#fff');
    grd.addColorStop(0.8, '#fff');
    grd.addColorStop(1, '#000');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

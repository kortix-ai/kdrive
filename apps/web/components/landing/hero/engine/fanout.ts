// Click a volume → its version stack fans out as thin slices carrying the
// cube's own voxel face (LANDING-SPEC §5.6): open/close timing, hold, the
// switch to another volume, and the slice edges. Geometry is in fan-plan.ts,
// the direction choice in chooser.ts.
import * as THREE from 'three';
import { cellsOf } from './layout';
import { fanLabels, type FanLabel } from './fan-labels';
import { anchorOf, type Pt } from './fan-layout';
import { LineBatch, type LineItem } from './lines';
import { boxEdges } from './build';
import { faceTexture } from './materials';
import { palette, type ScenePalette } from './palette';
import { AXES, faceExtents, sliceCentre, type FanPlan } from './fan-plan';
import { Spring1, clamp, smoothstep } from './springs';
import type { Volume } from './volume';

const Z = new THREE.Vector3(0, 0, 1);
const _w = new THREE.Vector3();
const _m = new THREE.Matrix4();

interface Slice {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  s: Spring1;
  delay: number;
  edges: LineItem;
}

export class Fanout {
  vol: Volume | null = null;
  /** One entry per shown slice: which slices are the head and checkpoints. */
  labels: FanLabel[] = [];
  /** Slices the open plan shows (a short stack shows fewer, every one labelled). */
  private shown = 0;
  plan: FanPlan | null = null;
  target = 0;
  private pending: { vol: Volume; plan: FanPlan } | null = null;
  private readonly slices: Slice[];
  private readonly textures = new Map<string, THREE.CanvasTexture>();
  private readonly geo = new THREE.BoxGeometry(1, 1, 1);

  constructor(private readonly count: number, private readonly reduced: boolean) {
    this.slices = Array.from({ length: count }, (_, i) => {
      const mesh = new THREE.Mesh(
        this.geo,
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
      );
      mesh.renderOrder = 10 + count - i;
      mesh.visible = false;
      mesh.matrixAutoUpdate = true;
      return { mesh, s: new Spring1(0, 150, 0.62), delay: 0, edges: LineBatch.item(boxEdges(new THREE.Vector3(0.5, 0.5, 0.5)), i === 0 ? palette().slice.head : palette().slice.edge) };
    });
  }

  /**
   * Live theme switch: re-bake the face textures (≈ 2 ms) in the new tones and re-colour the edges.
   * Slices showing a texture now get its re-baked twin.
   */
  retheme(p: ScenePalette, vols: Volume[]): void {
    const old = new Map(this.textures);
    this.textures.clear();
    this.prebuild(vols);
    for (const sl of this.slices) {
      const was = sl.mesh.material.map;
      if (was) for (const [k, t] of old) if (t === was) sl.mesh.material.map = this.textures.get(k) ?? null;
      sl.edges.color.set(p.slice.edge);
    }
    this.slices.forEach((sl, i) => this.labels[i]?.bright && sl.edges.color.set(p.slice.head));
    for (const t of old.values()) t.dispose();
  }

  /** Every face texture a volume can need, baked up front (warm-up). */
  prebuild(vols: Volume[]): void {
    for (const v of vols) for (const a of AXES) this.texFor(v, a);
  }

  private texFor(vol: Volume, axis: THREE.Vector3): THREE.CanvasTexture {
    const [nx, ny, nz] = cellsOf(vol.spec);
    const dims = axis.x !== 0 ? [nz, ny] : axis.y !== 0 ? [nx, nz] : [nx, ny];
    const key = `${dims[0]}x${dims[1]}`;
    let t = this.textures.get(key);
    if (!t) this.textures.set(key, (t = faceTexture(dims[0], dims[1], dims[0] * 7 + dims[1])));
    return t;
  }

  /** Show every slice on a volume for one compile pass, then hide again. */
  warm(vol: Volume, compile: () => void): void {
    for (const sl of this.slices) {
      sl.mesh.material.map = this.texFor(vol, AXES[2]);
      sl.mesh.material.opacity = 0.01;
      sl.mesh.visible = true;
      vol.pivot.add(sl.mesh);
    }
    compile();
    for (const sl of this.slices) { sl.mesh.visible = false; sl.mesh.removeFromParent(); }
  }

  toggle(vol: Volume, plan: FanPlan, t: number): void {
    if (this.vol === vol && this.target === 1) return this.close(t);
    if (this.vol && this.vol !== vol) {
      this.pending = { vol, plan };
      this.close(t, true);
      return;
    }
    this.open(vol, plan, t);
  }

  open(vol: Volume, plan: FanPlan, t: number): void {
    this.detach();
    this.vol = vol;
    this.plan = plan;
    this.target = 1;
    this.shown = Math.min(plan.slices, this.count);
    this.labels = fanLabels(vol.spec, this.shown);
    if (!this.reduced) vol.anticipate(t);
    // the plates lean toward the camera (plan.tilt) so a sideways fan never shows knife edges
    const orient = new THREE.Quaternion().copy(plan.tilt).multiply(new THREE.Quaternion().setFromUnitVectors(Z, plan.axis));
    const tex = this.texFor(vol, plan.axis);
    const e = faceExtents(vol, plan.axis);
    const depth = Math.max(0.02 * vol.size, 0.018);
    this.slices.forEach((sl, i) => {
      if (i >= this.shown) return;
      vol.pivot.add(sl.mesh);
      sl.mesh.visible = true;
      sl.mesh.quaternion.copy(orient);
      const sc = 1 - 0.03 * i;
      // the plate's local x/y map onto the face's u/w after the orientation
      sl.mesh.scale.set(e.a * sc, e.b * sc, depth);
      sl.mesh.material.map = tex;
      sl.edges.color.set(this.labels[i]?.bright ? palette().slice.head : palette().slice.edge);
      sl.delay = t + 0.09 + i * 0.045;
      if (this.reduced) sl.s.set(900, 1);
      else sl.s.set(150, 0.62);
    });
  }

  close(t: number, fast = false): void {
    this.target = 0;
    const n = this.shown || this.slices.length;
    this.slices.forEach((sl, i) => {
      sl.delay = t + (fast ? 0 : (n - 1 - i) * 0.03);
      sl.s.set(this.reduced || fast ? 600 : 120, 1);
    });
  }

  detach(): void {
    for (const sl of this.slices) { sl.mesh.removeFromParent(); sl.mesh.visible = false; sl.s.snap(0); }
    if (this.vol) this.vol.fanned = 0;
    this.vol = null;
    this.plan = null;
  }

  /** Open and every shown slice at rest (reduced motion lets the loop sleep then). */
  get settled(): boolean {
    if (!this.vol || this.target !== 1) return false;
    for (let i = 0; i < this.shown; i++) if (this.slices[i].s.energy > 0.004) return false;
    return true;
  }

  /** Progress 0..1 of slice i (for its label). */
  progress(i: number): number { return clamp(this.slices[i]?.s.x ?? 0, 0, 1); }

  /** Slice i's matrix in field space. */
  private sliceMatrix(i: number): THREE.Matrix4 {
    return _m.multiplyMatrices(this.vol!.pivot.matrix, this.slices[i].mesh.matrix);
  }

  /** Screen anchor (hero px) of slice i: the corner its label's leader starts from. */
  anchor(i: number, project: (p: THREE.Vector3) => THREE.Vector3): Pt {
    const L = this.plan?.layout;
    if (!this.vol || !L || !this.slices[i]) return { x: 0, y: 0 };
    const m = this.sliceMatrix(i);
    const cs: Pt[] = [];
    for (const cx of [-0.5, 0.5]) for (const cy of [-0.5, 0.5]) {
      const p = project(_w.set(cx, cy, 0.5).applyMatrix4(m));
      cs.push({ x: p.x, y: p.y });
    }
    return anchorOf(cs, L.attach, L.side);
  }

  update(t: number, dt: number, solid: LineBatch): void {
    const vol = this.vol;
    const plan = this.plan;
    if (!vol || !plan) return;
    let sum = 0;
    this.slices.forEach((sl, i) => {
      if (i >= this.shown) return;
      if (t >= sl.delay) sl.s.target = this.target;
      const k = Math.max(0, sl.s.step(dt));
      sum += Math.min(k, 1);
      // reduced motion: no travel, the slices only fade in place
      sliceCentre(vol, plan, i, this.reduced ? 1 : k, sl.mesh.position);
      // invisible until the plate has cleared the face it slides out of
      const fade = this.reduced ? clamp(k, 0, 1) : smoothstep(0.08, 0.3, k);
      const lab = this.labels[i];
      const face = lab?.checkpoint ? 0.75 : Math.max(0.3, 0.62 - i * 0.08);
      sl.mesh.material.opacity = face * fade;
      sl.mesh.updateMatrix();
      const edge = lab?.bright ? 1 : Math.max(0.45, 0.85 - i * 0.1);
      solid.push(sl.edges, this.sliceMatrix(i), edge * fade);
    });
    vol.fanned = sum / Math.max(1, this.shown);
    if (this.target === 0 && vol.fanned < 0.004) {
      this.detach();
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        this.open(p.vol, p.plan, t);
      }
    }
  }

  dispose(): void {
    this.detach();
    this.geo.dispose();
    for (const sl of this.slices) sl.mesh.material.dispose();
    for (const t of this.textures.values()) t.dispose();
  }
}

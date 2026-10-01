// One draw call per line style (LANDING-SPEC §5.7): every rim, trail, slice
// edge (solid) or ghost and stack shell (dashed) is a registered item of local
// segments; each frame the visible items are transformed on the CPU into one
// dynamic LineSegments. Opacity is a real per-vertex alpha (RGBA colours,
// transparent, no depth write), so a fading rim or a dimmed shell fades to
// nothing over the cube faces and over the CSS atmosphere behind the canvas,
// never to an opaque dark line.
import * as THREE from 'three';
import { segDistances } from './build';

export interface LineItem {
  local: Float32Array;
  dist: Float32Array;
  color: THREE.Color;
}

const _v = new THREE.Vector3();

export class LineBatch {
  readonly object: THREE.LineSegments;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly dist: Float32Array | null;
  private readonly geo: THREE.BufferGeometry;
  private n = 0;

  constructor(maxVerts: number, dashed: { dash: number; gap: number } | null) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(maxVerts * 3);
    this.col = new Float32Array(maxVerts * 4);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const common = { vertexColors: true, toneMapped: false, transparent: true, depthWrite: false } as const;
    let mat: THREE.LineBasicMaterial;
    if (dashed) {
      this.dist = new Float32Array(maxVerts);
      this.geo.setAttribute('lineDistance', new THREE.BufferAttribute(this.dist, 1).setUsage(THREE.DynamicDrawUsage));
      mat = new THREE.LineDashedMaterial({ ...common, dashSize: dashed.dash, gapSize: dashed.gap });
    } else {
      this.dist = null;
      mat = new THREE.LineBasicMaterial(common);
    }
    this.object = new THREE.LineSegments(this.geo, mat);
    this.object.frustumCulled = false;
    this.geo.setDrawRange(0, 0);
  }

  static item(seg: number[], color: THREE.ColorRepresentation): LineItem {
    return { local: new Float32Array(seg), dist: segDistances(seg), color: new THREE.Color(color) };
  }

  begin(): void {
    this.n = 0;
  }

  /** Transform an item by m (local → world) and draw it at opacity k (0..1). */
  push(item: LineItem, m: THREE.Matrix4, k: number, distScale = 1): void {
    if (k < 0.004) return;
    k = Math.min(k, 1);
    const count = item.local.length / 3;
    if ((this.n + count) * 3 > this.pos.length) return;
    const { r, g, b } = item.color;
    for (let i = 0; i < count; i++) {
      _v.fromArray(item.local, i * 3).applyMatrix4(m);
      const o = (this.n + i) * 3;
      this.pos[o] = _v.x;
      this.pos[o + 1] = _v.y;
      this.pos[o + 2] = _v.z;
      const c = (this.n + i) * 4;
      this.col[c] = r;
      this.col[c + 1] = g;
      this.col[c + 2] = b;
      this.col[c + 3] = k;
      if (this.dist) this.dist[this.n + i] = item.dist[i] * distScale;
    }
    this.n += count;
  }

  end(): void {
    this.geo.setDrawRange(0, this.n);
    this.object.visible = this.n > 0;
    for (const name of ['position', 'color', 'lineDistance']) {
      const a = this.geo.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (!a) continue;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geo.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}

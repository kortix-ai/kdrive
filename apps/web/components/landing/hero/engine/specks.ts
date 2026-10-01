// Distant specks (LANDING-SPEC §5.3): 90 fixed-size points far behind the
// field, drifting .02 u/s. They give the space its depth. Desktop only.
import * as THREE from 'three';
import { rng } from './springs';

export class Specks {
  readonly points: THREE.Points;
  private readonly base: Float32Array;
  private readonly pos: Float32Array;
  private readonly phase: Float32Array;

  constructor(count = 90) {
    const r = rng(11);
    this.base = new Float32Array(count * 3);
    this.phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const z = -6 - r() * 8;
      const spread = 1 + -z * 0.3;
      this.base[i * 3] = (r() * 2 - 1) * 6.5 * spread;
      this.base[i * 3 + 1] = (r() * 2 - 1) * 3.9 * spread;
      this.base[i * 3 + 2] = z;
      this.phase[i] = r() * Math.PI * 2;
    }
    this.pos = this.base.slice();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({
      color: 0x8b82c9,
      size: 1.4,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  /** Slow drift: .02 u/s along a per-speck direction that turns over minutes. */
  update(t: number, amp: number): void {
    const n = this.phase.length;
    for (let i = 0; i < n; i++) {
      const ph = this.phase[i];
      const d = 0.02 * 30 * amp;
      this.pos[i * 3] = this.base[i * 3] + Math.sin(t / 30 + ph) * d;
      this.pos[i * 3 + 1] = this.base[i * 3 + 1] + Math.cos(t / 37 + ph * 1.3) * d * 0.6;
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

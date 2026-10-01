// Camera rig and cursor light (LANDING-SPEC §5.5–5.6): pointer parallax,
// scroll moving the camera through the field, the damped orbit, the slow field
// yaw, the platinum cursor light and its CSS glow twin (transform writes only).
import * as THREE from 'three';
import { Spring3, clamp, damp } from './springs';

// parked over the middle of the field (touch, or the pointer away): it lights the cubes evenly
const PARK = { x: 0.5, y: 0.42 };
// a modelling light, not a flashlight: the key keeps the top > left > right
// hierarchy on a hovered or dragged cube, hover itself reads from the rim
const IDLE = 14;
const ACTIVE = 18;
const _ray = new THREE.Vector3();

export class Rig {
  readonly light: THREE.PointLight;
  private cam = { x: 0, y: 0 };
  private readonly orbit = new Spring3(12, 0.95);
  private orbiting = false;
  private glow = { x: 0, y: 0 };
  private glowLast = '';
  private target = new THREE.Vector3(0, 0, 3);
  camZ = 14;

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly glowEl: HTMLElement | null) {
    // platinum lerped 10% toward the violet accent; a finite reach with a
    // squared falloff, so the nearest cube is not washed out
    const c = new THREE.Color(0xdfe3ea).lerp(new THREE.Color(0xa78bfa), 0.1);
    this.light = new THREE.PointLight(c, IDLE, 14, 2);
    this.light.position.set(0, 0, 3);
  }

  /** Drag on empty canvas: rotate the field directly; release springs home. */
  setOrbit(dx: number, dy: number, active: boolean): void {
    this.orbiting = active;
    if (active) this.orbit.snap(clamp(dy * 0.0018, -0.08, 0.08), clamp(dx * 0.0025, -0.12, 0.12), 0);
    else this.orbit.setTarget(0, 0, 0);
  }

  private lightTarget = IDLE;

  get energy(): number {
    return this.orbit.energy + Math.abs(this.light.intensity - this.lightTarget) * 0.01;
  }

  update(o: {
    dt: number; t: number; amp: number; reduced: boolean; scroll: number;
    pointer: { x: number; y: number; nx: number; ny: number } | null; w: number; h: number; field: THREE.Group;
  }): void {
    const { dt, amp, w, h } = o;
    const par = o.reduced ? 0 : 1;
    const p = o.pointer;
    this.cam.x = damp(this.cam.x, (p ? p.nx : 0) * 0.6 * par, 3, dt);
    this.cam.y = damp(this.cam.y, (p ? p.ny : 0) * 0.36 * par, 3, dt);
    const s = o.scroll * par;
    this.camera.position.set(this.cam.x, this.cam.y - 1.4 * s, this.camZ - 3.2 * s);
    this.camera.lookAt(0, -1.6 * s, 0);
    this.camera.updateMatrixWorld();
    if (!this.orbiting) this.orbit.step(dt);
    const yaw = Math.sin((o.t * Math.PI * 2) / 40) * 0.015 * amp;
    o.field.rotation.set(this.orbit.x[0], this.orbit.x[1] + yaw, 0);
    o.field.updateMatrixWorld();

    // cursor light: the pointer's world position on the z = 0 plane, at z = 3
    const sx = p ? p.x : PARK.x * w;
    const sy = p ? p.y : PARK.y * h;
    _ray.set((sx / w) * 2 - 1, -((sy / h) * 2 - 1), 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    const k = -this.camera.position.z / _ray.z;
    this.target.set(this.camera.position.x + _ray.x * k, this.camera.position.y + _ray.y * k, 3);
    const lp = this.light.position;
    // up and back toward the key light, so it rakes the top faces instead of flattening the fronts
    lp.set(damp(lp.x, this.target.x - 0.8, 5, dt), damp(lp.y, this.target.y + 1.6, 5, dt), 4.5);
    this.lightTarget = p ? ACTIVE : IDLE;
    this.light.intensity = damp(this.light.intensity, this.lightTarget, p ? 12 : 5, dt);

    // the CSS glow follows the same point on screen (720px circle, centred)
    this.glow.x = damp(this.glow.x, sx, 5, dt);
    this.glow.y = damp(this.glow.y, sy, 5, dt);
    if (this.glowEl) {
      const v = `translate3d(${(this.glow.x - 360).toFixed(1)}px,${(this.glow.y - 360).toFixed(1)}px,0)`;
      if (v !== this.glowLast) this.glowEl.style.transform = this.glowLast = v;
    }
  }

  /** Rest pose: no parallax, no scroll, no orbit (the exclusion pass measures here). */
  rest(field: THREE.Group): void {
    this.camera.position.set(0, 0, this.camZ);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    field.rotation.set(0, 0, 0);
    field.updateMatrixWorld();
  }
}

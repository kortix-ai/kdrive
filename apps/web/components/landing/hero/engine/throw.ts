// Drag and throw (LANDING-SPEC §5.6), two phases after release: 480ms of free
// flight with linear drag 2.2/s (reflecting off the safe frame and the copy
// lines with restitution .35), then a critically-leaning home spring. While
// held, the cube rubber-bands past the safe frame. Reduced motion goes straight home.
import * as THREE from 'three';
import { clamp } from './springs';
import type { Bounds, Box2, Volume } from './volume';

const _v = new THREE.Vector3();

export class Throw {
  /** Pointer velocity (u/s): an exponential moving average over ~80ms of samples. */
  readonly vel = new THREE.Vector2();
  private readonly spin = new THREE.Vector2();
  private readonly grab = new THREE.Vector3();
  private flightT = 0;
  /** Released over the copy: the cube eases out from behind the text instead of bouncing inside it. */
  private fromCopy = false;
  private lastSample = 0;

  begin(v: Volume, point: THREE.Vector3, now: number): void {
    v.mode = 'drag';
    this.grab.copy(v.home).add(_v.fromArray(v.off.x)).sub(point);
    this.grab.z = 0;
    this.vel.set(0, 0);
    this.lastSample = now;
    v.rot.set(120, 0.8);
  }

  /** Direct follow: a ray-plane point at the home z plus the grab offset (no lag); rubber-banded past the frame. */
  move(v: Volume, point: THREE.Vector3, now: number, b: Box2): void {
    const dt = Math.max((now - this.lastSample) / 1000, 1 / 240);
    this.lastSample = now;
    const nx = band(point.x + this.grab.x, b.minX, b.maxX) - v.home.x;
    const ny = band(point.y + this.grab.y, b.minY, b.maxY) - v.home.y;
    const a = 1 - Math.exp(-dt / 0.08);
    this.vel.x += ((nx - v.off.x[0]) / dt - this.vel.x) * a;
    this.vel.y += ((ny - v.off.x[1]) / dt - this.vel.y) * a;
    v.off.snap(nx, ny, 0);
  }

  /** While held: tilt follows velocity; a pointer at rest bleeds velocity away. */
  hold(v: Volume, dt: number): void {
    if (performance.now() - this.lastSample > 50) this.vel.multiplyScalar(Math.exp(-dt / 0.08));
    v.rot.setTarget(clamp(-this.vel.y * 0.04, -0.35, 0.35), clamp(this.vel.x * 0.04, -0.35, 0.35), 0);
  }

  end(v: Volume, reduced: boolean): void {
    v.rot.setTarget(0, 0, 0);
    if (reduced) {
      v.mode = 'home';
      v.off.set(60, 1).setTarget(0, 0, 0);
      v.rot.set(60, 1);
      this.vel.set(0, 0);
      return;
    }
    const sp = this.vel.length();
    if (sp > 12) this.vel.multiplyScalar(12 / sp);
    this.spin.set(-this.vel.y * 0.9, this.vel.x * 0.9);
    v.mode = 'flight';
    this.flightT = 0;
  }

  fly(v: Volume, dt: number, b: Bounds): void {
    const first = this.flightT === 0;
    this.flightT += dt;
    const o = v.off.x;
    const decay = Math.exp(-2.2 * dt);
    const px = v.home.x + o[0];
    const py = v.home.y + o[1];
    const inside = (k: Box2, qx: number, qy: number) => qx > k.minX && qx < k.maxX && qy > k.minY && qy < k.maxY;
    if (first) this.fromCopy = b.blocks.some((k) => inside(k, px, py));
    let x = px + this.vel.x * dt;
    let y = py + this.vel.y * dt;
    if (x < b.minX || x > b.maxX) { x = clamp(x, b.minX, b.maxX); this.vel.x *= -0.35; }
    if (y < b.minY || y > b.maxY) { y = clamp(y, b.minY, b.maxY); this.vel.y *= -0.35; }
    for (const k of b.blocks) {
      if (!inside(k, x, y)) continue;
      if (this.fromCopy || inside(k, px, py)) {
        // released over the copy: a soft push out through the nearest edge, never a
        // wall it was dragged through; the flight is also damped hard (about 4×) while
        // over the text, so it glances off the lockup instead of sailing under it
        this.vel.multiplyScalar(Math.exp(-9 * dt));
        const d = [x - k.minX, k.maxX - x, y - k.minY, k.maxY - y];
        const m = Math.min(...d);
        const push = 25 * m * dt;
        if (m === d[0]) this.vel.x -= push;
        else if (m === d[1]) this.vel.x += push;
        else if (m === d[2]) this.vel.y -= push;
        else this.vel.y += push;
        continue;
      }
      // thrown at the copy from outside: bounce off its line, so the copy is never crossed
      if (px <= k.minX || px >= k.maxX) { x = px; this.vel.x *= -0.35; }
      else { y = py; this.vel.y *= -0.35; }
    }
    v.off.snap(x - v.home.x, y - v.home.y, 0);
    this.vel.multiplyScalar(decay);
    v.rot.x[0] += this.spin.x * dt;
    v.rot.x[1] += this.spin.y * dt;
    this.spin.multiplyScalar(decay);
    if (this.flightT > 0.48 || this.vel.length() < 0.5) this.home(v);
  }

  /** Phase 2: position k 22 ζ .82 (about 2% overshoot, settles in about 1.3 s), rotation k 18 ζ .8, carrying the flight's velocity. */
  private home(v: Volume): void {
    v.mode = 'home';
    v.off.set(22, 0.82).setTarget(0, 0, 0);
    v.off.v[0] = this.vel.x;
    v.off.v[1] = this.vel.y;
    v.rot.set(18, 0.8).setTarget(0, 0, 0);
    v.rot.v[0] = this.spin.x;
    v.rot.v[1] = this.spin.y;
    this.vel.set(0, 0);
  }
}

/** Past an edge, a held cube follows at 35%: a rubber band, not a wall. */
function band(x: number, lo: number, hi: number): number {
  if (x < lo) return lo + (x - lo) * 0.35;
  if (x > hi) return hi + (x - hi) * 0.35;
  return x;
}

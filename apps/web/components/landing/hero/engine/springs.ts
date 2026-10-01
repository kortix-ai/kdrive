// Damped springs and smoothing helpers for the hero field (LANDING-SPEC §5.5).
// Constants are written as stiffness k and damping ratio ζ; ζ = 1 is critically
// damped. Integration is semi-implicit Euler, sub-stepped at 240 Hz, so a long
// frame never explodes a stiff spring.

const SUB = 1 / 240;

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential smoothing toward b. */
export const damp = (a: number, b: number, lambda: number, dt: number) => a + (b - a) * (1 - Math.exp(-lambda * dt));

/** Tiny deterministic PRNG, so the composition is identical on every load. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Spring1 {
  x: number;
  v = 0;
  target: number;
  private k = 0;
  private c = 0;

  constructor(x = 0, k = 120, zeta = 1) {
    this.x = x;
    this.target = x;
    this.set(k, zeta);
  }

  set(k: number, zeta: number): this {
    this.k = k;
    this.c = 2 * zeta * Math.sqrt(k);
    return this;
  }

  step(dt: number): number {
    const n = Math.max(1, Math.ceil(dt / SUB));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-this.k * (this.x - this.target) - this.c * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }

  snap(x = this.target): void {
    this.x = this.target = x;
    this.v = 0;
  }

  get energy(): number {
    return Math.abs(this.v) * 0.1 + Math.abs(this.x - this.target);
  }
}

export class Spring3 {
  readonly x: [number, number, number] = [0, 0, 0];
  readonly v: [number, number, number] = [0, 0, 0];
  readonly target: [number, number, number] = [0, 0, 0];
  private k = 0;
  private c = 0;

  constructor(k = 120, zeta = 1) {
    this.set(k, zeta);
  }

  set(k: number, zeta: number): this {
    this.k = k;
    this.c = 2 * zeta * Math.sqrt(k);
    return this;
  }

  setTarget(x: number, y: number, z: number): void {
    this.target[0] = x;
    this.target[1] = y;
    this.target[2] = z;
  }

  kick(x: number, y: number, z: number): void {
    this.v[0] += x;
    this.v[1] += y;
    this.v[2] += z;
  }

  step(dt: number): void {
    const n = Math.max(1, Math.ceil(dt / SUB));
    const h = dt / n;
    for (let s = 0; s < n; s++)
      for (let i = 0; i < 3; i++) {
        this.v[i] += (-this.k * (this.x[i] - this.target[i]) - this.c * this.v[i]) * h;
        this.x[i] += this.v[i] * h;
      }
  }

  snap(x: number, y: number, z: number): void {
    this.setTarget(x, y, z);
    for (let i = 0; i < 3; i++) {
      this.x[i] = this.target[i];
      this.v[i] = 0;
    }
  }

  get energy(): number {
    let e = 0;
    for (let i = 0; i < 3; i++) e += Math.abs(this.v[i]) * 0.1 + Math.abs(this.x[i] - this.target[i]);
    return e;
  }
}

/**
 * Slow idle motion: a sum of two sines with a seeded phase and incommensurate
 * periods, so it never visibly loops. Returns roughly -amp..amp.
 */
export function wander(t: number, amp: number, period: number, phase: number): number {
  const w = (Math.PI * 2) / period;
  return amp * (0.72 * Math.sin(t * w + phase) + 0.28 * Math.sin(t * w * 1.618 + phase * 2.3));
}

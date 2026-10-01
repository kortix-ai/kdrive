// Volumes gently avoid each other (LANDING-SPEC §5.6): pairwise spheres with
// r = .8 × size, measured in the view plane (depth counts a quarter: two cubes
// at different depths still overlap on screen); an overlap adds a velocity
// impulse of 18 × overlap along the separation normal, split by mass (size³);
// a held or thrown cube also pushes its neighbour out of the overlap directly.
// Runs only while something moves.
import type { Volume } from './volume';

export function avoid(vols: Volume[], dt: number): void {
  const k = 18 * 60; // impulse per 60 Hz frame, made frame-rate independent
  for (let i = 0; i < vols.length; i++)
    for (let j = i + 1; j < vols.length; j++) {
      const a = vols[i];
      const b = vols[j];
      const pa = a.pivot.position;
      const pb = b.pivot.position;
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const dz = pa.z - pb.z;
      const dist = Math.hypot(dx, dy, dz * 0.25) || 1e-3;
      const over = 0.8 * (a.size + b.size) - dist;
      if (over <= 0) continue;
      const ma = a.mode === 'drag' ? Infinity : a.size ** 3;
      const mb = b.mode === 'drag' ? Infinity : b.size ** 3;
      const imp = k * over * dt;
      const fa = Number.isFinite(ma) ? (Number.isFinite(mb) ? mb / (ma + mb) : 1) : 0;
      const fb = Number.isFinite(mb) ? 1 - fa : 0;
      push(a, (dx / dist) * imp * fa, (dy / dist) * imp * fa);
      push(b, (-dx / dist) * imp * fb, (-dy / dist) * imp * fb);
      // a held or thrown cube moves faster than any impulse: the one it meets is
      // also moved out of the overlap directly, so they never interpenetrate
      const am = a.mode === 'drag' || a.mode === 'flight';
      const bm = b.mode === 'drag' || b.mode === 'flight';
      if (am && !bm) shove(b, (-dx / dist) * over, (-dy / dist) * over);
      else if (bm && !am) shove(a, (dx / dist) * over, (dy / dist) * over);
    }
}

function shove(v: Volume, x: number, y: number): void {
  v.off.x[0] += x;
  v.off.x[1] += y;
  if (v.mode === 'idle') v.mode = 'home';
}

function push(v: Volume, x: number, y: number): void {
  if (v.mode === 'drag' || (x === 0 && y === 0)) return;
  if (v.mode === 'flight') { v.throw.vel.x += x; v.throw.vel.y += y; return; }
  v.off.kick(x, y, 0);
  if (v.mode === 'idle') v.mode = 'home';
}

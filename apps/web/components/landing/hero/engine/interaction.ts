// Per-frame orchestration of the field (LANDING-SPEC §5.5–5.6): input wiring,
// the hover tag, the fan rules (hold while hovered, 8 s idle close, scroll
// close, switch volumes) and writing every batch once per frame.
import * as THREE from 'three';
import { avoid } from './avoid';
import { choosePlan, type Choice } from './chooser';
import { screenBox, type Rect, type Zones } from './exclusion';
import { Input } from './input';
import type { Labels } from './labels';
import { tagLine } from './fan-labels';
import type { Rig } from './rig';
import { Space } from './space';
import { smoothstep } from './springs';
import type { Stage } from './stage';
import type { Frame, Volume } from './volume';

export interface IxDeps {
  hero: HTMLElement;
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  field: THREE.Group;
  rig: Rig;
  labels: Labels;
  reduced: boolean;
  stage(): Stage;
  zones(): Zones;
  size(): [number, number];
  wake(): void;
  onFan(open: boolean): void;
}

const inRect = (r: Rect | null, x: number, y: number) => !!r && x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

export class Interaction {
  readonly input: Input;
  private readonly space: Space;
  private t = 0;
  private fanOpen = false;
  private lastOver = 0;
  /** Reduced motion: wall-clock twin of lastOver, and the timer that closes an idle fan while the loop sleeps. */
  private lastOverAt = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private col: Rect | null = null;
  /** One plan per volume per layout and size: the same click always gives the same fan. */
  private readonly plans = new Map<Volume, Choice>();
  /** The volume whose rows the label layer shows. */
  private labelled: Volume | null = null;
  /** The volume whose neighbours currently step aside for its fan. */
  private yielding: Volume | null = null;

  constructor(private readonly d: IxDeps) {
    this.space = new Space(d.camera, d.field, d.size);
    this.input = new Input({
      hero: d.hero,
      canvas: d.canvas,
      pick: (x, y) => this.space.pick(d.stage().volumes, x, y),
      onClick: (v) => this.click(v),
      onDragStart: (v, x, y) => {
        const f = d.stage().fanout;
        if (f.vol === v) f.close(this.t, true);
        const p = this.space.dragPoint(v, x, y);
        if (p) v.throw.begin(v, p, performance.now());
      },
      onDragMove: (v, x, y) => {
        const p = this.space.dragPoint(v, x, y);
        if (p) v.throw.move(v, p, performance.now(), this.space.bounds(v, d.zones(), d.rig.camZ));
      },
      onDragEnd: (v) => v.throw.end(v, d.reduced),
      onOrbit: (dx, dy, active) => d.rig.setOrbit(dx, dy, active),
      onLeave: () => this.close(),
      onEscape: () => this.close(),
      onScroll: () => d.wake(),
      wake: () => d.wake(),
    });
  }

  measure(): void {
    this.input.measure();
    this.plans.clear();
  }

  reset(): void {
    this.plans.clear();
    this.yielding = null;
    this.labelled = null;
    this.input.setHover(null);
    this.d.labels.setTag(null);
    this.d.labels.hideFan();
    this.setFanState(false);
  }

  /** Keyboard path: the fan on the first volume (Studio). */
  toggleFirst(): void {
    const v = this.d.stage().volumes[0];
    if (v) this.click(v, true);
  }

  private close(): void {
    const f = this.d.stage().fanout;
    if (f.vol && f.target === 1) f.close(this.t);
  }

  private click(v: Volume | null, keyboard = false): void {
    if (!v) return this.close();
    const st = this.d.stage();
    let c = this.plans.get(v);
    if (!c) {
      // planned at the rest camera (no parallax, scroll or orbit) and the volume's home
      const cam = this.d.camera.clone();
      cam.position.set(0, 0, this.d.rig.camZ);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld();
      c = choosePlan(v, st.volumes, st.layout.mobile ? 4 : 6, this.d.zones(), cam, keyboard);
      this.plans.set(v, c);
    }
    st.fanout.toggle(v, c.plan, this.t);
    this.over();
  }

  /** Neighbours step aside (and step back in tone) while a fan is open; released on close. */
  private setYield(v: Volume | null): void {
    if (v === this.yielding) return;
    const st = this.d.stage();
    // reduced motion: neighbours step aside without travel (a cut, not a glide)
    const move = (o: Volume, x: number, y: number) => (this.d.reduced ? o.yieldOff.snap(x, y, 0) : o.yieldOff.setTarget(x, y, 0));
    for (const o of st.volumes) {
      move(o, 0, 0);
      o.dim.target = v && o !== v ? 1 : 0;
      if (this.d.reduced) o.dim.snap();
    }
    const c = v ? this.plans.get(v) : null;
    for (const y of c?.yields ?? []) move(y.vol, y.x, y.y);
    if (v && st.layout.mobile) {
      // phones: the band neighbour (same row of cubes) slides out along x, so a
      // stack opening toward it has real room instead of a 70px gap
      for (const o of st.volumes) {
        if (o === v || Math.abs(o.screen.y - v.screen.y) > 120) continue;
        const dir = Math.sign(o.screen.x - v.screen.x) || 1;
        const y = c?.yields.find((q) => q.vol === o);
        move(o, (y?.x ?? 0) + dir * 0.85 * v.size * v.fit, y?.y ?? 0);
      }
    }
    this.yielding = v;
    this.d.wake();
  }

  private setFanState(open: boolean): void {
    if (open === this.fanOpen) return;
    this.fanOpen = open;
    this.d.onFan(open);
  }

  /** One frame of simulation and batch writes; returns the scene's energy (0 = at rest). */
  tick(t: number, dt: number, since: number, scroll: number): number {
    this.t = t;
    const d = this.d;
    const st = d.stage();
    const [w, h] = d.size();
    const zones = d.zones();
    const mobile = st.layout.mobile;
    const amp = d.reduced ? 0 : smoothstep(0, 0.8, since);
    this.input.pickIfNeeded();
    const ip = this.input.pointer;
    const pointer = ip.inside && !mobile ? ip : null;
    d.rig.update({ dt, t, amp, reduced: d.reduced, scroll, pointer, w, h, field: d.field });

    const frame: Frame = { t, dt, amp, reduced: d.reduced, pointer: pointer && !this.input.busy ? pointer : null };
    let energy = d.rig.energy;
    for (const v of st.volumes) {
      const s = this.space.project(v.pivot.position);
      v.screen.set(s.x, s.y);
      v.update(frame, this.space.bounds(v, zones, d.rig.camZ));
      energy += v.energy;
      if (v.settled) { v.settled = false; this.input.requestPick(); }
    }
    if (energy > 0.004) avoid(st.volumes, dt);
    st.solid.begin();
    st.dashed.begin();
    st.volumes.forEach((v, i) => {
      v.draw(frame, st.voxels, st.cores, st.solid, st.dashed);
      st.shades.set(i, v.pivot.position, v.size * v.fit, v.lift.x, v.throw.vel.x, v.throw.vel.y, v.spec.kind !== 'ghost');
    });
    st.fanout.update(t, dt, st.solid);
    st.commit();
    st.specks?.update(t, amp);

    this.hoverTag(zones, mobile);
    energy += this.fanFrame(t, scroll, st);
    return energy;
  }

  /** The tag sits on the hovered volume's projected top-right corner, off the copy and the other cubes. */
  private hoverTag(zones: Zones, mobile: boolean): void {
    const st = this.d.stage();
    const f = st.fanout;
    const v = this.input.hovered;
    const show = v && !mobile && v.mode === 'idle' && f.vol !== v ? v : null;
    this.d.labels.setTag(show ? tagLine(show.spec) : null, 'click for versions');
    if (!show) return;
    // the four outer corners of the projected cube: top-right, top-left, bottom-right, bottom-left
    const corners = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
    const best = [-Infinity, -Infinity, -Infinity, -Infinity];
    for (const p of show.outline(show.pivot.position, show.fit).slice(0, 8)) {
      const s = this.space.project(p);
      const score = [s.x - s.y, -s.x - s.y, s.x + s.y, -s.x + s.y];
      for (let i = 0; i < 4; i++) if (score[i] > best[i]) { best[i] = score[i]; corners[i].x = s.x; corners[i].y = s.y; }
    }
    const cubes = st.volumes.filter((o) => o !== show).map((o) => this.screenRect(o));
    this.d.labels.placeTag(corners, zones, cubes, this.screenRect(show));
  }

  private screenRect(v: Volume): Rect {
    const [w, h] = this.d.size();
    return screenBox(v.outline(v.pivot.position, v.fit).slice(0, 8), this.d.camera, w, h);
  }

  private fanFrame(t: number, scroll: number, st: Stage): number {
    const f = st.fanout;
    const open = !!f.vol && f.target === 1;
    if (open && this.labelled !== f.vol) {
      this.labelled = f.vol;
      this.d.labels.setFan(f.plan, f.vol!.spec.name);
    }
    this.setFanState(open);
    this.setYield(open ? f.vol : null);
    if (!f.vol || !f.plan) {
      this.labelled = null;
      this.d.labels.hideFan();
      this.col = null;
      return 0;
    }
    const vol = f.vol;
    const col = this.d.labels.placeFan(
      { x: vol.screen.x, y: vol.screen.y },
      (i) => f.anchor(i, this.space.project),
      (i) => f.target === 1 && f.progress(i) > 0.2,
    );
    this.col = col;
    // hold while the pointer is over the stack or its labels; close after 8 s idle or on scroll
    const ip = this.input.pointer;
    const stack = this.plans.get(vol)?.stack ?? null;
    if (ip.inside && (inRect(stack, ip.x, ip.y) || inRect(col, ip.x, ip.y))) this.over();
    if (open && (t - this.lastOver > 8 || scroll > 0.3)) f.close(t);
    // reduced motion: a settled fan costs nothing; the loop sleeps and a timer closes it after 8 s idle
    if (this.d.reduced && f.settled) {
      this.armIdleClose();
      return 0;
    }
    return 1;
  }

  private over(): void {
    this.lastOver = this.t;
    this.lastOverAt = performance.now();
  }

  private armIdleClose(): void {
    if (this.idleTimer) return;
    const wait = Math.max(50, 8000 - (performance.now() - this.lastOverAt));
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      const f = this.d.stage().fanout;
      if (!f.vol || f.target !== 1) return;
      if (performance.now() - this.lastOverAt >= 7950) f.close(this.t);
      this.d.wake();
    }, wait);
  }

  dispose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.input.dispose();
  }
}

// Pointer model for the field (LANDING-SPEC §5.6): parallax and proximity
// pointer, hover picking (at most once per frame), click → fan, drag → throw,
// empty drag → orbit (fine pointers only), touch intent via pan-y.
import type { Volume } from './volume';

export interface InputHost {
  hero: HTMLElement;
  canvas: HTMLCanvasElement;
  pick(x: number, y: number): Volume | null;
  onClick(vol: Volume | null): void;
  onDragStart(vol: Volume, x: number, y: number): void;
  onDragMove(vol: Volume, x: number, y: number): void;
  onDragEnd(vol: Volume): void;
  onOrbit(dx: number, dy: number, active: boolean): void;
  onLeave(): void;
  onEscape(): void;
  onScroll(): void;
  wake(): void;
}

interface Press { x: number; y: number; t: number; id: number; vol: Volume | null; touch: boolean; moved: boolean; mode: 'none' | 'drag' | 'orbit' }

export class Input {
  /** Pointer in hero px; `inside` while a fine pointer is over the hero. */
  readonly pointer = { x: 0, y: 0, nx: 0, ny: 0, inside: false, touch: false };
  hovered: Volume | null = null;
  private press: Press | null = null;
  private needPick = false;
  private rect: DOMRect;
  private readonly fine: boolean;
  private readonly off: (() => void)[] = [];

  constructor(private readonly h: InputHost) {
    this.rect = h.hero.getBoundingClientRect();
    this.fine = window.matchMedia('(pointer: fine)').matches;
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'pointermove', (e: PointerEvent) => this.move(e), { passive: true });
    on(h.canvas, 'pointerdown', (e: PointerEvent) => this.down(e));
    on(window, 'pointerup', (e: PointerEvent) => this.up(e, false));
    on(window, 'pointercancel', (e: PointerEvent) => this.up(e, true));
    on(h.hero, 'pointerleave', (e: PointerEvent) => {
      if (this.press || e.pointerType === 'touch') return;
      this.pointer.inside = false;
      this.setHover(null);
      h.onLeave();
    });
    on(window, 'keydown', (e: KeyboardEvent) => { if (e.key === 'Escape') h.onEscape(); });
    on(window, 'scroll', () => { this.measure(); this.needPick = true; h.onScroll(); }, { passive: true });
  }

  /** Re-read the hero rect (resize/scroll only, never per frame). */
  measure(): void {
    this.rect = this.h.hero.getBoundingClientRect();
  }

  private locate(e: PointerEvent): void {
    const p = this.pointer;
    p.x = e.clientX - this.rect.left;
    p.y = e.clientY - this.rect.top;
    p.nx = (p.x / this.rect.width) * 2 - 1;
    p.ny = -((p.y / this.rect.height) * 2 - 1);
    p.touch = e.pointerType === 'touch';
  }

  private move(e: PointerEvent): void {
    this.locate(e);
    const p = this.pointer;
    p.inside = !p.touch && this.fine && p.y >= 0 && p.y <= this.rect.height && p.x >= 0 && p.x <= this.rect.width;
    this.h.wake();
    const pr = this.press;
    if (pr && pr.id === e.pointerId) {
      const dx = e.clientX - pr.x;
      const dy = e.clientY - pr.y;
      if (!pr.moved && Math.hypot(dx, dy) > 6) {
        pr.moved = true;
        if (pr.vol && (!pr.touch || Math.abs(dx) > Math.abs(dy))) {
          pr.mode = 'drag';
          this.h.canvas.setPointerCapture?.(e.pointerId);
          this.setHover(null);
          this.h.canvas.classList.add('is-grabbing');
          this.h.onDragStart(pr.vol, p.x, p.y);
        } else if (!pr.vol && !pr.touch && this.fine) {
          pr.mode = 'orbit';
          this.h.canvas.classList.add('is-grabbing');
        }
      }
      if (pr.mode === 'drag' && pr.vol) this.h.onDragMove(pr.vol, p.x, p.y);
      else if (pr.mode === 'orbit') this.h.onOrbit(dx, dy, true);
      return;
    }
    this.needPick = p.inside && e.target === this.h.canvas;
    if (!this.needPick) this.setHover(null);
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.measure();
    this.locate(e);
    const vol = this.h.pick(this.pointer.x, this.pointer.y);
    this.press = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, vol, touch: e.pointerType === 'touch', moved: false, mode: 'none' };
    this.h.wake();
  }

  private up(e: PointerEvent, cancelled: boolean): void {
    const pr = this.press;
    if (!pr || pr.id !== e.pointerId) return;
    this.press = null;
    this.h.canvas.classList.remove('is-grabbing');
    if (pr.mode === 'drag' && pr.vol) this.h.onDragEnd(pr.vol);
    else if (pr.mode === 'orbit') this.h.onOrbit(0, 0, false);
    else if (!cancelled && !pr.moved && performance.now() - pr.t < 350) this.h.onClick(pr.vol);
    // stale-tag fix: re-pick after every release
    this.needPick = this.pointer.inside;
    if (pr.touch) this.setHover(null);
    this.h.wake();
  }

  /** Called once per frame by the loop; picks only when the pointer moved. */
  pickIfNeeded(): void {
    if (!this.needPick || this.press) return;
    this.needPick = false;
    this.setHover(this.pointer.inside ? this.h.pick(this.pointer.x, this.pointer.y) : null);
  }

  requestPick(): void {
    this.needPick = this.pointer.inside;
  }

  get busy(): boolean {
    return !!this.press && this.press.mode !== 'none';
  }

  setHover(v: Volume | null): void {
    if (this.hovered === v) return;
    if (this.hovered) this.hovered.hover = false;
    this.hovered = v;
    if (v) v.hover = true;
    this.h.canvas.classList.toggle('is-grab', !!v);
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off.length = 0;
  }
}

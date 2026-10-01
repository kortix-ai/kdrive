// The render loop's discipline (LANDING-SPEC §5.3, §5.7): run only while the
// hero is on screen and the tab is visible, sleep on request (reduced motion at
// rest), wake on input; and a DPR governor that steps resolution down by .25
// (floor 1) after two 2 s windows averaging over 20ms a frame.
import type * as THREE from 'three';

export class Loop {
  running = false;
  private onScreen = true;
  private disposed = false;
  private prev = 0;
  private readonly io: IntersectionObserver;
  private readonly onVisibility = () => (document.hidden ? this.stop() : this.start());

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    target: Element,
    private readonly frame: (now: number, rawMs: number) => void,
  ) {
    this.io = new IntersectionObserver(([e]) => {
      this.onScreen = e.isIntersecting;
      if (this.onScreen) this.start();
      else this.stop();
    }, { threshold: 0 });
    this.io.observe(target);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private readonly tick = (now: number) => {
    const raw = this.prev ? now - this.prev : 16;
    this.prev = now;
    this.frame(now, raw);
  };

  start(): void {
    if (this.running || this.disposed || !this.onScreen || document.hidden) return;
    this.running = true;
    this.prev = 0;
    this.renderer.setAnimationLoop(this.tick);
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  wake(): void {
    if (!this.running) this.start();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.io.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}

export class DprGovernor {
  private acc = 0;
  private n = 0;
  private slow = 0;

  constructor(public dpr: number, private readonly apply: (dpr: number) => void) {}

  sample(ms: number): void {
    this.acc += ms;
    this.n++;
    if (this.acc < 2000) return;
    const mean = this.acc / this.n;
    this.slow = mean > 20 ? this.slow + 1 : 0;
    this.acc = this.n = 0;
    if (this.slow >= 2 && this.dpr > 1) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.apply(this.dpr);
      this.slow = 0;
    }
  }
}

'use client';

import { useEffect, useRef } from 'react';
import { THEME_EVENT } from '@/lib/theme';

// The paper's ASCII grain: real glyphs whose density follows soft colour blobs, tinted from the nearest folder
// hue and kept to the edges (a hole stays clear for the copy). Strength comes from the theme's --vx-ascii-*
// tokens. Animates at ~12 fps only while on screen and the tab is visible; under reduced motion it renders once.
// Landing only: never mounted inside the app shell.

const RAMP = ' .·:-+*=oahkbdpq#%&8WM';

type Blob = [x: number, y: number, r: number, hue: number];
type Preset = {
  blobs?: Blob[];
  /** [cx, cy, rx, ry] as fractions: an ellipse kept clear for text. */
  hole?: [number, number, number, number];
  /** a horizontal band whose hue sweeps from the first to the second */
  band?: [number, number];
  neutral?: boolean;
  animate?: boolean;
};

const PRESETS = {
  hero: {
    blobs: [[0, 0.12, 0.26, 32], [1, 0.1, 0.26, 162], [0, 0.98, 0.27, 72], [1, 0.98, 0.27, 352]],
    hole: [0.5, 0.5, 0.3, 0.62],
    animate: true,
  },
  final: { neutral: true, blobs: [[0, 0.5, 0.3, 0], [1, 0.5, 0.3, 0]], hole: [0.5, 0.5, 0.38, 0.55] },
} satisfies Record<string, Preset>;

const CELL_W = 9;
const CELL_H = 14;

function oklchToRgb(L: number, C: number, H: number): string {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin
    .map((v) => {
      const c = Math.max(0, Math.min(1, v));
      return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
    })
    .join(',');
}

export function AsciiField({
  preset,
  band,
  className,
}: {
  preset?: keyof typeof PRESETS;
  /** a band between sections, its hue sweeping left to right */
  band?: [number, number];
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const P: Preset = band ? { band } : preset ? PRESETS[preset] : {};
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0;
    let H = 0;
    let t = 0;
    let visible = true;
    let raf = 0;
    const tints = new Map<string, string>();

    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.clientWidth;
      H = cv.clientHeight;
      if (!W || !H) return false;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    };

    const draw = () => {
      if (!W && !size()) return;
      const cs = getComputedStyle(cv);
      const dark = document.documentElement.dataset.vxTheme === 'dark';
      const ink = parseFloat(cs.getPropertyValue('--vx-ascii-ink')) || 0.3;
      const wash = parseFloat(cs.getPropertyValue('--vx-ascii-wash')) || 0.1;
      const chroma = parseFloat(cs.getPropertyValue('--vx-ascii-chroma')) || 0.05;
      const tint = (hue: number) => {
        const k = `${dark}${hue}${chroma}`;
        let c = tints.get(k);
        if (!c) {
          c = P.neutral ? oklchToRgb(0.64, 0.012, 80) : oklchToRgb(dark ? 0.8 : 0.5, chroma * 1.6, hue);
          tints.set(k, c);
        }
        return c;
      };
      const narrow = W < 600;
      const M = Math.min(Math.max(W, H), W * 1.1);
      ctx.clearRect(0, 0, W, H);
      const blobs = (P.blobs ?? []).map(([x, y, r, hu], k) => ({
        x: (x + Math.sin(t * 0.2 + k * 1.9) * 0.015) * W,
        y: (y + Math.cos(t * 0.17 + k) * 0.02) * H,
        r: r * M,
        hu,
      }));
      // the soft colour wash under the glyphs (the blurred field)
      if (!P.neutral && !P.band) {
        for (const b of blobs) {
          const c = oklchToRgb(dark ? 0.45 : 0.8, 0.1, b.hu);
          const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 1.1);
          g.addColorStop(0, `rgba(${c},${wash})`);
          g.addColorStop(1, `rgba(${c},0)`);
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
        }
      }
      ctx.font = `500 ${CELL_H - 3}px ${cs.getPropertyValue('--vx-font-mono') || 'ui-monospace, monospace'}`;
      ctx.textBaseline = 'top';
      const nc = Math.ceil(W / CELL_W);
      const nr = Math.ceil(H / CELL_H);
      const top = RAMP.length - 1;
      for (let j = 0; j < nr; j++) {
        const py = j * CELL_H + CELL_H / 2;
        for (let i = 0; i < nc; i++) {
          const px = i * CELL_W + CELL_W / 2;
          let v = 0;
          let hu = 0;
          if (P.band) {
            const u = px / W;
            const bell = Math.exp(-((py / H - 0.5) ** 2) / 0.045);
            const edge = Math.min(1, Math.min(u, 1 - u) * 5);
            v = bell * edge * (0.55 + 0.45 * Math.sin(u * 13 + Math.sin(u * 5) * 2 + j * 0.4));
            hu = P.band[0] + (P.band[1] - P.band[0]) * u;
          } else {
            let best = 0;
            for (const b of blobs) {
              const dx = px - b.x + Math.sin(py * 0.012 + b.hu) * b.r * 0.25;
              const dy = py - b.y + Math.cos(px * 0.01 + b.hu) * b.r * 0.2;
              const w = Math.exp((-(dx * dx + dy * dy) / (b.r * b.r)) * 2.6);
              if (w > best) {
                best = w;
                hu = b.hu;
              }
              v = Math.max(v, w);
            }
            // a ragged, organic edge
            v *= 0.8 + 0.2 * Math.sin(px * 0.021 + Math.sin(py * 0.017 + hu) * 2.2) * Math.cos(py * 0.019 - px * 0.006);
            if (P.hole) {
              const [hx, hy, rx0, ry] = P.hole;
              const rx = narrow ? Math.max(rx0, 0.5) : rx0;
              const d = Math.hypot((px / W - hx) / rx, (py / H - hy) / ry);
              v *= Math.min(1, Math.max(0, (d - 1) / 0.6));
            }
          }
          v += Math.sin(i * 0.9 + j * 1.7 + t * 0.7) * 0.035;
          if (v < 0.09) continue;
          const q = Math.min(1, v);
          const a = (P.neutral ? 0.3 : ink) * (0.25 + 0.75 * q);
          ctx.fillStyle = `rgba(${tint(hu)},${a.toFixed(3)})`;
          ctx.fillText(RAMP[Math.max(1, Math.round(q * top))], i * CELL_W + 1, j * CELL_H + 2);
        }
      }
    };

    const redraw = () => {
      if (size()) draw();
    };
    const ro = new ResizeObserver(redraw);
    ro.observe(cv);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
    });
    io.observe(cv);
    // the theme changes the ink, tint and wash
    const onTheme = () => requestAnimationFrame(draw);
    window.addEventListener(THEME_EVENT, onTheme);
    const mo = new MutationObserver(onTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-vx-theme'] });
    document.fonts?.ready.then(redraw).catch(() => {});

    if (P.animate && !reduced) {
      const t0 = performance.now();
      let last = 0;
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        if (!visible || document.hidden || now - last < 80) return;
        last = now;
        t = (now - t0) / 1000;
        draw();
      };
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      window.removeEventListener(THEME_EVENT, onTheme);
    };
  }, [preset, band?.[0], band?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  return <canvas ref={ref} className={`kd-ascii${className ? ` ${className}` : ''}`} aria-hidden="true" />;
}

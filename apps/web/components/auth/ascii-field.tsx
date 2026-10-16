'use client';

import { useEffect, useRef } from 'react';
import { cx } from '@/components/ui/cx';

/**
 * The paper's ASCII grain: real glyphs by density over a soft colour wash, tinted from the nearest object's hue,
 * kept to the edges (a clear hole stays behind the card). Strength comes from --vx-ascii-ink / -wash / -chroma, so
 * light and dark tune it in globals.css. Decorative, never inside the app shell. It drifts slowly unless the
 * viewer prefers reduced motion, and pauses while off screen or in a hidden tab.
 */

const RAMP = ' .·:-+*=oahkbdpq#%&8WM';

type Blob = [x: number, y: number, r: number, hue: number];
export interface AsciiPreset {
  cell: [number, number];
  blobs: Blob[];
  /** Ellipse kept clear for text: [cx, cy, rx, ry], as fractions. */
  hole?: [number, number, number, number];
  /** Vertical band the glyphs stay inside (fractions), so the top bar and footer read clean. */
  clearY?: [number, number];
  /** Blobs for narrow (< 600 px) fields, which then ignore the hole. */
  narrow?: Blob[];
  neutral?: boolean;
}

export const ASCII_PRESETS = {
  auth: {
    cell: [9, 14],
    blobs: [[0.06, 0.3, 0.17, 32], [0.94, 0.26, 0.17, 262], [0.08, 0.78, 0.17, 162], [0.94, 0.8, 0.17, 352]],
    hole: [0.5, 0.52, 0.27, 0.5],
    clearY: [0.1, 0.9],
    narrow: [[0.05, 0.9, 0.5, 32], [0.95, 0.92, 0.5, 262]],
  },
  quiet: { cell: [9, 14], neutral: true, blobs: [[0, 0.5, 0.3, 0], [1, 0.5, 0.3, 0]], hole: [0.5, 0.5, 0.38, 0.55] },
} satisfies Record<string, AsciiPreset>;

function oklchToRgb(L: number, C: number, H: number): string {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin
    .map((v) => {
      const c = Math.max(0, Math.min(1, v));
      return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
    })
    .join(',');
}

function draw(cv: HTMLCanvasElement, P: AsciiPreset, t: number) {
  const ctx = cv.getContext('2d');
  const W = cv.clientWidth;
  const H = cv.clientHeight;
  if (!ctx || !W || !H) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const cs = getComputedStyle(cv);
  const dark = document.documentElement.dataset.vxTheme !== 'light';
  const ink = parseFloat(cs.getPropertyValue('--vx-ascii-ink')) || 0.3;
  const wash = parseFloat(cs.getPropertyValue('--vx-ascii-wash')) || 0.1;
  const chroma = parseFloat(cs.getPropertyValue('--vx-ascii-chroma')) || 0.05;
  const [cw, ch] = P.cell;
  const M = Math.min(Math.max(W, H), W * 1.1);
  const narrow = W < 600;
  const tints = new Map<number, string>();
  const tint = (hue: number) => {
    if (P.neutral) return '143,137,126';
    let c = tints.get(hue);
    if (!c) tints.set(hue, (c = oklchToRgb(dark ? 0.8 : 0.5, chroma * 1.6, hue)));
    return c;
  };
  const src = narrow && P.narrow ? P.narrow : P.blobs;
  const blobs = src.map(([x, y, r, hu], k) => ({ x: (x + Math.sin(t * 0.2 + k * 1.9) * 0.015) * W, y: (y + Math.cos(t * 0.17 + k) * 0.02) * H, r: r * M, hu }));

  // the soft colour wash underneath (the blurred field)
  if (!P.neutral) {
    for (const b of blobs) {
      const c = oklchToRgb(dark ? 0.45 : 0.8, 0.1, b.hu);
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 1.1);
      g.addColorStop(0, `rgba(${c},${wash})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  ctx.font = `500 ${ch - 3}px ${cs.fontFamily || 'ui-monospace, monospace'}`;
  ctx.textBaseline = 'top';
  const nc = Math.ceil(W / cw);
  const nr = Math.ceil(H / ch);
  const Lr = RAMP.length - 1;
  const useHole = P.hole && !(narrow && P.narrow);
  for (let j = 0; j < nr; j++) {
    const py = j * ch + ch / 2;
    for (let i = 0; i < nc; i++) {
      const px = i * cw + cw / 2;
      let v = 0;
      let hu = 0;
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
      if (useHole && P.hole) {
        const [hx, hy, rx0, ry] = P.hole;
        const rx = narrow ? Math.max(rx0, 0.5) : rx0;
        const d = Math.hypot((px / W - hx) / rx, (py / H - hy) / ry);
        v *= Math.min(1, Math.max(0, (d - 1) / 0.6));
      }
      if (P.clearY) {
        const y = py / H;
        const [a, b] = narrow ? [0.1, 0.95] : P.clearY;
        v *= Math.min(1, Math.max(0, (y - a) / 0.08), Math.max(0, (b - y) / 0.08));
      }
      v += Math.sin(i * 0.9 + j * 1.7 + t * 0.7) * 0.035;
      if (v < 0.09) continue;
      const q = Math.min(1, v);
      const idx = Math.max(1, Math.round(q * Lr));
      const a = (P.neutral ? 0.3 : ink) * (0.25 + 0.75 * q);
      ctx.fillStyle = `rgba(${tint(hu)},${a.toFixed(3)})`;
      ctx.fillText(RAMP[idx]!, i * cw + 1, j * ch + 2);
    }
  }
}

export function AsciiField({ preset = 'auth', className }: { preset?: keyof typeof ASCII_PRESETS; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const P: AsciiPreset = ASCII_PRESETS[preset];
    let t = 0;
    let visible = true;
    const redraw = () => draw(cv, P, t);
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(cv);
    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
    io.observe(cv);
    // The theme flips data-vx-theme on <html>; the tokens the field reads change with it.
    const mo = new MutationObserver(redraw);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-vx-theme'] });
    document.fonts?.ready.then(redraw).catch(() => {});
    let raf = 0;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!still) {
      const t0 = performance.now();
      let last = 0;
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        if (document.hidden || !visible || now - last < 80) return;
        last = now;
        t = (now - t0) / 1000;
        redraw();
      };
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
    };
  }, [preset]);
  return <canvas ref={ref} aria-hidden className={cx('pointer-events-none absolute inset-0 block h-full w-full font-mono', className)} />;
}

export default AsciiField;

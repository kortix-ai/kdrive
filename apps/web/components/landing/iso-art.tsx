import { Bounds, type IsoBox, project, projectBox, sortBoxes, type Vec3, voxelBlock } from './iso-geom';

// Isometric voxel SVG art for the feature grid, the duplicate mock and the
// final CTA (LANDING-SPEC §6.5, §6.3d, §6.8). Server-renderable, greys only.

type Extra =
  | { kind: 'line'; a: Vec3; b: Vec3; dash?: boolean }
  | { kind: 'seam'; a: Vec3; b: Vec3 }
  | { kind: 'glyph'; at: Vec3; text: string };

const FILL: Record<string, [string, string, string]> = {
  // [left, right, top] gradient ids by style
  solid: ['l', 'r', 't'],
  dim: ['l', 'r', 't'],
  hi: ['l', 'r', 'h'],
  lit: ['ml', 'mr', 'h'],
  // the hero's graphite (the poster's measured tones): top > left > right
  graphite: ['gl', 'gr', 'gt'],
};

function Defs({ id }: { id: string }) {
  const g = (name: string, a: string, b: string, diag = false) => (
    <linearGradient id={`${id}-${name}`} x1="0" y1="0" x2={diag ? 1 : 0} y2="1">
      <stop offset="0" stopColor={a} />
      <stop offset="1" stopColor={b} />
    </linearGradient>
  );
  return (
    <defs>
      {g('t', '#63676f', '#41444b', true)}
      {g('l', '#2e3036', '#1a1b1f')}
      {g('r', '#202126', '#111114')}
      {/* the brightest top in any tile stops at plat-mid, so no tile outshines the rest */}
      {g('h', '#c8ccd4', '#9aa0aa', true)}
      {g('ml', '#9a9faa', '#5c616a')}
      {g('mr', '#50545c', '#23252a')}
      {g('gt', '#878c9b', '#757a89', true)}
      {g('gl', '#525664', '#454956')}
      {g('gr', '#2f3139', '#25272e')}
      <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2.2" />
      </filter>
    </defs>
  );
}

function pt(v: Vec3, bounds: Bounds) {
  const p = project(v);
  bounds.add(p);
  return p;
}

export function Iso({
  id,
  boxes,
  extras = [],
  label,
  className,
}: {
  id: string;
  boxes: IsoBox[];
  extras?: Extra[];
  label?: string;
  className?: string;
}) {
  const bounds = new Bounds();
  const drawn = sortBoxes(boxes).map((b) => projectBox(b, bounds));
  const over = extras.map((e) => {
    if (e.kind === 'glyph') return { e, p: pt(e.at, bounds) };
    return { e, p: pt(e.a, bounds), q: pt(e.b, bounds) };
  });
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <svg viewBox={bounds.viewBox()} className={className} xmlns="http://www.w3.org/2000/svg" {...a11y}>
      <Defs id={id} />
      {drawn.map((b, i) => {
        if (b.style === 'ghost') {
          const [back, up] = b.back.split('|');
          return (
            <g key={i} fill="rgb(160 170 190 / .04)" stroke="rgb(214 219 228 / .55)" strokeWidth="1" strokeDasharray="3.5 3" strokeLinejoin="round">
              <polyline points={back} fill="none" />
              <polyline points={up} fill="none" />
              {b.faces.map((f) => (
                <polygon key={f.kind} points={f.points} />
              ))}
            </g>
          );
        }
        const [l, r, t] = FILL[b.style];
        const rim = b.style === 'solid' || b.style === 'dim' || b.style === 'graphite' ? 'rgb(255 255 255 / .3)' : 'rgb(255 255 255 / .92)';
        return (
          <g key={i} stroke="rgb(255 255 255 / .12)" strokeWidth="1" strokeLinejoin="round" opacity={b.style === 'dim' ? 0.55 : 1}>
            <polygon points={b.faces[0].points} fill={`url(#${id}-${l})`} />
            <polygon points={b.faces[1].points} fill={`url(#${id}-${r})`} />
            <polygon points={b.faces[2].points} fill={`url(#${id}-${t})`} />
            <polyline points={b.rim} fill="none" stroke={rim} />
          </g>
        );
      })}
      {over.map(({ e, p, q }, i) => {
        if (e.kind === 'glyph') {
          // text laid flat on the top face: x follows the iso x axis, y the iso z axis
          const m = `matrix(${Math.cos(Math.PI / 6).toFixed(4)} .5 ${(-Math.cos(Math.PI / 6)).toFixed(4)} .5 ${p[0].toFixed(1)} ${p[1].toFixed(1)})`;
          return (
            <text key={i} transform={m} textAnchor="middle" dominantBaseline="central" fontFamily="var(--kd-font-mono)" fontSize="22" fontWeight="500" fill="#2a2c31">
              {e.text}
            </text>
          );
        }
        const [x1, y1] = p;
        const [x2, y2] = q as [number, number];
        if (e.kind === 'seam') {
          return (
            <g key={i} strokeLinecap="round">
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#dfe3ea" strokeWidth="2.4" opacity=".28" filter={`url(#${id}-glow)`} />
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#dfe3ea" strokeWidth="1" />
            </g>
          );
        }
        return (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgb(214 219 228 / .6)" strokeWidth="1" strokeDasharray={e.dash ? '3 3' : undefined} />
        );
      })}
    </svg>
  );
}

/* ── the art pieces ──────────────────────────────────────────────────── */

const slab = (at: Vec3, size: Vec3, style: IsoBox['style'] = 'solid'): IsoBox => ({ at, size, style });

export const FEATURE_ART = {
  versions: {
    label: 'Three stacked version slabs',
    boxes: [0, 1, 2].map((k) => slab([0, k * 0.62, 0], [3, 0.34, 3], k === 2 ? 'hi' : 'solid')),
  },
  checkpoints: {
    label: 'A slab with a raised checkpoint tab',
    boxes: [slab([0, 0, 0], [4, 0.7, 2.2]), slab([1.5, 0.7, 0.6], [1, 0.42, 1], 'lit')],
  },
  deleted: {
    label: 'A cube with one voxel missing, outlined in dashes',
    boxes: voxelBlock([2, 2, 2], [0, 0, 0], (x, y, z) => (x === 1 && y === 1 && z === 1 ? 'ghost' : 'solid')),
  },
  upload: {
    label: 'A tray holding smaller blocks, one more dropping in',
    // a 3×3 floor (tiles, so the painter sort keeps every block above its tile),
    // three blocks in their cells, one dropping in, and the tray's two near walls
    boxes: [
      ...[0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => slab([i * 1.2, 0, j * 1.2], [1.2, 0.24, 1.2], 'dim'))),
      ...([[0, 0], [1, 0], [0, 1]] as const).map(([i, j]) => slab([i * 1.2 + 0.12, 0.24, j * 1.2 + 0.12], [0.96, 0.84, 0.96], 'graphite')),
      slab([1.32, 1.55, 1.32], [0.96, 0.84, 0.96], 'lit'),
      slab([0, 0, 3.6], [3.8, 0.62, 0.2], 'dim'),
      slab([3.6, 0, 0], [0.2, 0.62, 3.6], 'dim'),
    ],
  },
  history: {
    label: 'A column of three cubes, the top one solid',
    boxes: [slab([0, 0, 0], [1.4, 1.4, 1.4], 'ghost'), slab([0, 1.55, 0], [1.4, 1.4, 1.4], 'dim'), slab([0, 3.1, 0], [1.4, 1.4, 1.4], 'hi')],
  },
  keyboard: {
    label: 'A keycap with the letter K',
    boxes: [slab([0, 0, 0], [2.6, 0.9, 2.6], 'lit')],
    extras: [{ kind: 'glyph', at: [1.3, 0.9, 1.3], text: 'K' }] as Extra[],
  },
} as const;

export type FeatureArtKey = keyof typeof FEATURE_ART;

export function FeatureArt({ name, className }: { name: FeatureArtKey; className?: string }) {
  const art = FEATURE_ART[name];
  return <Iso id={`kd-iso-${name}`} boxes={[...art.boxes]} extras={'extras' in art ? [...art.extras] : []} label={art.label} className={className} />;
}

/** The duplicate mock's cube: dashed ghost until the fork is made, then solid. */
export function ForkCube({ solid, className }: { solid: boolean; className?: string }) {
  return <Iso id={`kd-iso-fork-${solid ? 's' : 'g'}`} boxes={[slab([0, 0, 0], [1, 1, 1], solid ? 'hi' : 'ghost')]} className={className} />;
}

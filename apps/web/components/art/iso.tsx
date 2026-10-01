import { Bounds, type IsoBox, project, projectBox, sortBoxes, type Vec3 } from './iso-geom';

// Isometric voxel SVG art (UNIFY-SPEC §9, §13.5), shared by the landing (feature grid, duplicate mock,
// final call) and the app's empty states. Server-renderable, static, greys only. Every colour reads a
// --vx-iso-* token, so the art flips with the theme with no JS: in light the "hi" and "lit" blocks become
// dark graphite, so the emphasised block is still the highest-contrast element on its ground.

export type IsoExtra =
  | { kind: 'line'; a: Vec3; b: Vec3; dash?: boolean }
  | { kind: 'seam'; a: Vec3; b: Vec3; tone?: 'default' | 'past' }
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

const v = (name: string) => `var(--vx-iso-${name})`;

function Defs({ id }: { id: string }) {
  const g = (name: string, token: string, diag = false) => (
    <linearGradient id={`${id}-${name}`} x1="0" y1="0" x2={diag ? 1 : 0} y2="1">
      <stop offset="0" style={{ stopColor: v(`${token}-a`) }} />
      <stop offset="1" style={{ stopColor: v(`${token}-b`) }} />
    </linearGradient>
  );
  return (
    <defs>
      {g('t', 'top', true)}
      {g('l', 'left')}
      {g('r', 'right')}
      {/* the brightest top in any tile stops at plat-mid, so no tile outshines the rest */}
      {g('h', 'hi', true)}
      {g('ml', 'lit-l')}
      {g('mr', 'lit-r')}
      {g('gt', 'graph-t', true)}
      {g('gl', 'graph-l')}
      {g('gr', 'graph-r')}
      <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2.2" />
      </filter>
    </defs>
  );
}

function pt(p3: Vec3, bounds: Bounds) {
  const p = project(p3);
  bounds.add(p);
  return p;
}

export function Iso({
  id,
  boxes,
  extras = [],
  label,
  className,
  width,
}: {
  /** Unique per distinct drawing on a page (gradient ids). */
  id: string;
  boxes: IsoBox[];
  extras?: IsoExtra[];
  label?: string;
  className?: string;
  width?: number;
}) {
  const bounds = new Bounds();
  const drawn = sortBoxes(boxes).map((b) => projectBox(b, bounds));
  const over = extras.map((e) => {
    if (e.kind === 'glyph') return { e, p: pt(e.at, bounds) };
    return { e, p: pt(e.a, bounds), q: pt(e.b, bounds) };
  });
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <svg viewBox={bounds.viewBox()} width={width} className={className} xmlns="http://www.w3.org/2000/svg" {...a11y}>
      <Defs id={id} />
      {drawn.map((b, i) => {
        if (b.style === 'ghost') {
          const [back, up] = b.back.split('|');
          return (
            <g key={i} style={{ fill: v('ghost-fill'), stroke: v('ghost-line') }} strokeWidth="1" strokeDasharray="3.5 3" strokeLinejoin="round">
              <polyline points={back} fill="none" />
              <polyline points={up} fill="none" />
              {b.faces.map((f) => (
                <polygon key={f.kind} points={f.points} />
              ))}
            </g>
          );
        }
        const [l, r, t] = FILL[b.style];
        const rim = b.style === 'solid' || b.style === 'dim' || b.style === 'graphite' ? v('rim') : v('rim-hi');
        return (
          <g key={i} style={{ stroke: v('edge') }} strokeWidth="1" strokeLinejoin="round" opacity={b.style === 'dim' ? 0.55 : 1}>
            <polygon points={b.faces[0].points} fill={`url(#${id}-${l})`} />
            <polygon points={b.faces[1].points} fill={`url(#${id}-${r})`} />
            <polygon points={b.faces[2].points} fill={`url(#${id}-${t})`} />
            <polyline points={b.rim} fill="none" style={{ stroke: rim }} />
          </g>
        );
      })}
      {over.map(({ e, p, q }, i) => {
        if (e.kind === 'glyph') {
          // text laid flat on the top face: x follows the iso x axis, y the iso z axis
          const m = `matrix(${Math.cos(Math.PI / 6).toFixed(4)} .5 ${(-Math.cos(Math.PI / 6)).toFixed(4)} .5 ${p[0].toFixed(1)} ${p[1].toFixed(1)})`;
          return (
            <text key={i} transform={m} textAnchor="middle" dominantBaseline="central" fontFamily="var(--vx-font-mono)" fontSize="22" fontWeight="500" style={{ fill: v('glyph') }}>
              {e.text}
            </text>
          );
        }
        const [x1, y1] = p;
        const [x2, y2] = q as [number, number];
        if (e.kind === 'seam') {
          const seam = e.tone === 'past' ? 'var(--vx-past-dot)' : v('seam');
          return (
            <g key={i} strokeLinecap="round">
              <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="2.4" style={{ stroke: seam, opacity: e.tone === 'past' ? 0.3 : v('seam-glow') }} filter={`url(#${id}-glow)`} />
              {e.tone === 'past' ? null : <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="2.6" style={{ stroke: v('seam-groove') }} />}
              <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="1" style={{ stroke: seam }} />
            </g>
          );
        }
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} style={{ stroke: v('line') }} strokeWidth="1" strokeDasharray={e.dash ? '3 3' : undefined} />;
      })}
    </svg>
  );
}

export default Iso;

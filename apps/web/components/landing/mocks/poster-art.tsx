// The two versions of hero.png in the compare swipe (LANDING-SPEC §6.3a): the
// same abstract composition, where v44 changes the colour block and the
// headline bar. Greys only, from the --vx-art-* tokens (both themes).
const v = (name: string) => `var(--vx-art-${name})`;

export function PosterArt({ version, className }: { version: 'old' | 'new'; className?: string }) {
  const k = version === 'new' ? 'n' : 'o';
  const isNew = version === 'new';
  return (
    <svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true">
      <rect width="320" height="200" style={{ fill: v(`${k}-bg`) }} />
      <g style={{ stroke: v(`${k}-grid`) }} strokeWidth="1">
        {[40, 80, 120, 160, 200, 240, 280].map((x) => (
          <line key={x} x1={x} y1="0" x2={x} y2="200" />
        ))}
      </g>
      <circle cx="96" cy="92" r="46" style={{ fill: v(`${k}-disc`) }} />
      <rect x={isNew ? 150 : 158} y={isNew ? 46 : 60} width={isNew ? 124 : 96} height={isNew ? 86 : 62} style={{ fill: v(`${k}-block`) }} />
      <rect x="28" y="156" width={isNew ? 196 : 132} height="14" rx="1" style={{ fill: v(`${k}-bar`) }} />
      <rect x="28" y="176" width="88" height="6" rx="1" style={{ fill: v(`${k}-sub`) }} />
    </svg>
  );
}

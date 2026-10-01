// The two versions of hero.png in the compare swipe (LANDING-SPEC §6.3a): the
// same abstract composition, where v44 changes the colour block and the
// headline bar. Greys only.
export function PosterArt({ version, className }: { version: 'old' | 'new'; className?: string }) {
  const isNew = version === 'new';
  return (
    <svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true">
      <rect width="320" height="200" fill={isNew ? '#1b1c20' : '#141417'} />
      <g stroke={isNew ? '#2a2b31' : '#1f2024'} strokeWidth="1">
        {[40, 80, 120, 160, 200, 240, 280].map((x) => (
          <line key={x} x1={x} y1="0" x2={x} y2="200" />
        ))}
      </g>
      <circle cx="96" cy="92" r="46" fill={isNew ? '#d9dce2' : '#3a3c43'} />
      <rect x={isNew ? 150 : 158} y={isNew ? 46 : 60} width={isNew ? 124 : 96} height={isNew ? 86 : 62} fill={isNew ? '#8d929c' : '#2b2d33'} />
      <rect x="28" y="156" width={isNew ? 196 : 132} height="14" rx="1" fill={isNew ? '#f6f7f9' : '#55585f'} />
      <rect x="28" y="176" width="88" height="6" rx="1" fill={isNew ? '#6b6f78' : '#3a3c43'} />
    </svg>
  );
}

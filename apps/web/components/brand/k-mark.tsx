// The KDRIVE mark: a pixel K that is also a USB drive. Four soft pixels make the stem, two sit at the
// corners as the K's arms, and the 2×2 block between them is the plug, its outer pixels carrying the contacts.
// Colours come from --vx-mark-* tokens (body, plug, contact), so it is the same object in both themes.
// Decorative: it always sits next to the "KDRIVE" text.

const U = 10; // cell size in the 40×40 viewBox
const GAP = 1.2;
const BODY: [number, number][] = [[0, 0], [0, 1], [0, 2], [0, 3], [3, 0], [3, 3]];
const PLUG: [number, number][] = [[1, 1], [1, 2], [2, 1], [2, 2]];
const CONTACTS: [number, number][] = [[2, 1], [2, 2]];

function Cell({ x, y, fill }: { x: number; y: number; fill: string }) {
  return <rect x={x * U + GAP / 2} y={y * U + GAP / 2} width={U - GAP} height={U - GAP} rx={2.4} style={{ fill }} />;
}

export function KMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className} aria-hidden="true" focusable="false">
      {BODY.map(([x, y]) => (
        <Cell key={`b${x}${y}`} x={x} y={y} fill="var(--vx-mark-body)" />
      ))}
      {PLUG.map(([x, y]) => (
        <Cell key={`p${x}${y}`} x={x} y={y} fill="var(--vx-mark-plug)" />
      ))}
      {CONTACTS.map(([x, y]) => (
        <rect key={`c${x}${y}`} x={x * U + 3.8} y={y * U + 3.8} width={2.4} height={2.4} rx={0.6} style={{ fill: 'var(--vx-mark-contact)' }} />
      ))}
    </svg>
  );
}

export default KMark;

'use client';

import { useId } from 'react';

// The KDRIVE mark (UNIFY-SPEC §8.1): a 3-face isometric cube, the same three paths as app/icon.svg.
// - "flat" (default): tonal faces separated by a hairline in the ground colour; crisp at 16px.
// - "metal": large lockups (landing hero, final call, sign-in); a gradient top and a hairline edge highlight.
// Face colours come from --vx-mark-* tokens, so the mark is the same object lit the same way in both themes
// (top lightest, right darkest). Decorative: it always sits next to the "KDRIVE" text.
export function CubeMark({ size = 16, variant = 'flat', className }: { size?: number; variant?: 'flat' | 'metal'; className?: string }) {
  const uid = useId().replace(/:/g, '');
  if (variant === 'metal') {
    const top = `vx-mark-top-${uid}`;
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={top} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" style={{ stopColor: 'var(--vx-mark-metal-top-a)' }} />
            <stop offset="1" style={{ stopColor: 'var(--vx-mark-metal-top-b)' }} />
          </linearGradient>
        </defs>
        <path d="M8 1.2 14.2 4.8 8 8.4 1.8 4.8Z" fill={`url(#${top})`} />
        <path d="M1.8 4.8 8 8.4v6.6L1.8 11.4Z" style={{ fill: 'var(--vx-mark-metal-left)' }} />
        <path d="M14.2 4.8 8 8.4v6.6l6.2-3.6Z" style={{ fill: 'var(--vx-mark-metal-right)' }} />
        <path
          d="M1.8 4.8 8 8.4 14.2 4.8M8 8.4V15"
          fill="none"
          style={{ stroke: 'var(--vx-mark-metal-edge)' }}
          strokeWidth="1"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <g style={{ stroke: 'var(--vx-mark-stroke)' }} strokeWidth="0.6" strokeLinejoin="round">
        <path d="M8 1.2 14.2 4.8 8 8.4 1.8 4.8Z" style={{ fill: 'var(--vx-mark-top)' }} />
        <path d="M1.8 4.8 8 8.4v6.6L1.8 11.4Z" style={{ fill: 'var(--vx-mark-left)' }} />
        <path d="M14.2 4.8 8 8.4v6.6l6.2-3.6Z" style={{ fill: 'var(--vx-mark-right)' }} />
      </g>
    </svg>
  );
}

export default CubeMark;

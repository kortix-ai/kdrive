// The KDRIVE mark: a 3-face isometric cube (LANDING-SPEC §4, §8).
// - "flat" (default): the favicon art of app/icon.svg, tonal faces with a hairline
//   separation, crisp at 16px (the nav, small sizes).
// - "metal": the large lockups (hero, final call); no outline, the scene's face
//   tones and a hairline edge highlight, so it reads as one of the scene's cubes.
// Decorative wherever it sits next to the "KDRIVE" text.
export function LogoMark({
  size = 16,
  className,
  variant = 'flat',
}: {
  size?: number;
  className?: string;
  variant?: 'flat' | 'metal';
}) {
  if (variant === 'metal') {
    // the wordmark's metal stops (top plat-mid → #e3e6eb, left plat-lo, right
    // graphite), so its brightest value stays under the word's highlight and
    // the mark reads as part of the lockup, not beside it
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="kd-mark-top" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#c8ccd4" />
            <stop offset="1" stopColor="#e3e6eb" />
          </linearGradient>
        </defs>
        <path d="M8 1.2 14.2 4.8 8 8.4 1.8 4.8Z" fill="url(#kd-mark-top)" />
        <path d="M1.8 4.8 8 8.4v6.6L1.8 11.4Z" fill="#8d929c" />
        <path d="M14.2 4.8 8 8.4v6.6l6.2-3.6Z" fill="#4a4e57" />
        <path
          d="M1.8 4.8 8 8.4 14.2 4.8M8 8.4V15"
          fill="none"
          stroke="#ffffff"
          strokeOpacity=".3"
          strokeWidth="1"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <g stroke="#0a0a0b" strokeWidth="0.6" strokeLinejoin="round">
        <path d="M8 1.2 14.2 4.8 8 8.4 1.8 4.8Z" fill="#e9ebef" />
        <path d="M1.8 4.8 8 8.4v6.6L1.8 11.4Z" fill="#9ea3ac" />
        <path d="M14.2 4.8 8 8.4v6.6l6.2-3.6Z" fill="#5d616a" />
      </g>
    </svg>
  );
}

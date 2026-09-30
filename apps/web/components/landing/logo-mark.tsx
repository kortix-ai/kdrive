// The KDRIVE mark: a 3-face isometric cube (LANDING-SPEC §4, §8). The same art
// as app/icon.svg. Decorative wherever it sits next to the "KDRIVE" text.
export function LogoMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="#0a0a0b" strokeWidth="0.6" strokeLinejoin="round">
        <path d="M8 1.2 14.2 4.8 8 8.4 1.8 4.8Z" fill="#e9ebef" />
        <path d="M1.8 4.8 8 8.4v6.6L1.8 11.4Z" fill="#9ea3ac" />
        <path d="M14.2 4.8 8 8.4v6.6l6.2-3.6Z" fill="#5d616a" />
      </g>
    </svg>
  );
}

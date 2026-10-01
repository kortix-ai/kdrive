import { Iso } from '@/components/art/iso';
import { FEATURE_ART } from '@/components/landing/iso-art';

/**
 * The sign-in illustration (UNIFY-SPEC §14.1): the landing's three version slabs over a landing-style
 * timeline: version ticks, one ◆ checkpoint with its label, one past grip in brass and the head disc in
 * the active ink. Static, decorative, theme-aware through tokens.
 */
export function SignInArt() {
  const ticks = [28, 52, 76, 100, 150, 174, 222, 246, 270, 318, 342];
  return (
    <div className="flex w-full max-w-[400px] flex-col items-center gap-6" aria-hidden>
      <Iso id="vx-signin-versions" boxes={[...FEATURE_ART.versions.boxes]} className="h-auto w-[180px]" />
      <svg viewBox="0 0 400 56" className="h-auto w-full" fill="none">
        <line x1="12" y1="32" x2="388" y2="32" style={{ stroke: 'var(--vx-hair-strong)' }} strokeWidth="1" />
        {ticks.map((x, i) => (
          <line key={x} x1={x} y1={32 - (i % 3 === 0 ? 6 : 4)} x2={x} y2={32 + (i % 3 === 0 ? 6 : 4)} style={{ stroke: 'var(--vx-tick)' }} strokeWidth="1" />
        ))}
        {/* the checkpoint: a diamond with its label above */}
        <rect x="194" y="28" width="8" height="8" transform="rotate(45 198 32)" style={{ fill: 'var(--vx-surface)', stroke: 'var(--vx-text-1)' }} strokeWidth="1" />
        <text x="198" y="14" textAnchor="middle" fontFamily="var(--vx-font-mono)" fontSize="10" style={{ fill: 'var(--vx-text-3)' }}>
          first draft
        </text>
        {/* the past grip: surface centre, brass ring */}
        <circle cx="126" cy="32" r="7" style={{ fill: 'var(--vx-surface)', stroke: 'var(--vx-past-dot)' }} strokeWidth="3" />
        {/* the head: active ink disc with a surface gap ring */}
        <circle cx="372" cy="32" r="8" style={{ fill: 'var(--vx-surface)' }} />
        <circle cx="372" cy="32" r="6" style={{ fill: 'var(--vx-accent)' }} />
      </svg>
    </div>
  );
}

export default SignInArt;

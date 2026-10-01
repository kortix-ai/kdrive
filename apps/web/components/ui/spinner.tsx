import { cx } from './cx';

/** Ring spinner (UNIFY-SPEC §10): 14 px, 1.5 px stroke in currentColor, 800 ms linear. */
export function Spinner({ className, label, size = 14 }: { className?: string; label?: string; size?: number }) {
  return (
    <span role="status" aria-label={label ?? 'Loading'} className={cx('inline-flex shrink-0', className)}>
      <svg className="vx-spin" width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity=".25" strokeWidth="1.75" />
        <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export default Spinner;

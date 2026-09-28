'use client';

import { cx } from './cx';

/**
 * Checkbox (DESIGN-v2 §5): 18 px, r4, 2 px outline; on = accent fill + white check;
 * indeterminate = white bar. Controlled; renders a real <input type=checkbox> for a11y.
 */
export function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
  className,
  disabled,
  tabIndex,
  onClick,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean, e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Raw click (e.g. to read shiftKey or stop row handlers). */
  onClick?: (e: React.MouseEvent<HTMLInputElement>) => void;
  /** Accessible name. */
  label: string;
  className?: string;
  disabled?: boolean;
  tabIndex?: number;
}) {
  const on = checked || indeterminate;
  return (
    <span className={cx('relative inline-flex h-[18px] w-[18px] shrink-0', className)}>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        tabIndex={tabIndex}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate;
        }}
        onChange={(e) => onChange?.(e.target.checked, e)}
        onClick={onClick}
        className="peer absolute inset-0 m-0 cursor-pointer appearance-none rounded-[4px] disabled:cursor-not-allowed"
      />
      <span
        aria-hidden
        className={cx(
          'pointer-events-none flex h-full w-full items-center justify-center rounded-[4px] border-2 transition-colors duration-[120ms] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-vx-accent-edge peer-disabled:opacity-[.38]',
          on ? 'border-vx-accent bg-vx-accent text-vx-on-accent' : 'border-vx-outline bg-vx-surface',
        )}
      >
        {indeterminate ? (
          <svg width="10" height="2" viewBox="0 0 10 2" aria-hidden>
            <rect width="10" height="2" rx="1" fill="currentColor" />
          </svg>
        ) : checked ? (
          <svg width="12" height="10" viewBox="0 0 12 10" fill="none" aria-hidden>
            <path d="M1 5l3.5 3.5L11 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
    </span>
  );
}

export default Checkbox;

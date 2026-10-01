'use client';

import { cx } from './cx';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
  /** Accessible name when the label is an icon. */
  ariaLabel?: string;
}

/**
 * Segmented control (UNIFY-SPEC §10): 30 px, r4, a 1 px hair-strong frame with 1 px hair dividers,
 * Inter 13/500 text-2; the "on" segment is the raise fill + text-1 (no check, no colour). `check` is
 * accepted for old callers and ignored. Used for list/grid, Split/Unified, Dark/Light/System, …
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  label,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  /** md 32 · sm 28 */
  size?: 'sm' | 'md';
  label?: string;
  check?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('inline-flex shrink-0 overflow-hidden rounded-vx-sm border border-vx-hair-strong', size === 'sm' ? 'h-7' : 'h-[30px]', className)}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.ariaLabel}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex items-center justify-center gap-1.5 text-[13px] font-medium leading-5 transition-colors duration-[120ms] ease-vx focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:opacity-[.38]',
              size === 'sm' ? 'px-2.5' : 'px-3',
              i > 0 && 'border-l border-vx-hair',
              on ? 'bg-vx-raise text-vx-text-1' : 'text-vx-text-2 hover:bg-vx-raise/60 hover:text-vx-text-1',
            )}
          >
                        {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default Segmented;

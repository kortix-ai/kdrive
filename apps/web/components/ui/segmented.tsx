'use client';

import { Check } from 'lucide-react';
import { cx } from './cx';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
  /** Accessible name when the label is an icon. */
  ariaLabel?: string;
}

/**
 * Segmented control (DESIGN-v2 §5): a 32 px pill with a 1 px outline and 1 px dividers.
 * The "on" segment is the selection tint with a 16 px check (set `check={false}` for icon-only
 * sets that are too tight). Used for list/grid, Split/Unified, Light/Dark/System, …
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  label,
  check = true,
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
      className={cx('inline-flex shrink-0 overflow-hidden rounded-full border border-vx-outline', size === 'sm' ? 'h-7' : 'h-8', className)}
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
              i > 0 && 'border-l border-vx-outline',
              on ? 'bg-vx-selection text-vx-on-selection' : 'text-vx-text-2 hover:bg-vx-hover hover:text-vx-text-1',
            )}
          >
            {on && check ? <Check size={16} strokeWidth={2} aria-hidden className="shrink-0" /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default Segmented;

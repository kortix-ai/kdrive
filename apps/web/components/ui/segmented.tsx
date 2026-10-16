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
 * Segmented control: a surface-3 well (3 px inset, soft hair edge) holding 13.5/500 text-2 segments; the "on"
 * segment lifts onto the surface with a 1 px shadow and text-1 (no check, no colour). md 36 · sm 32. `check` is
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
  /** md 36 · sm 32 */
  size?: 'sm' | 'md';
  label?: string;
  check?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('inline-flex shrink-0 gap-0.5 rounded-[10px] border border-vx-hair-soft bg-vx-surface-3 p-[3px]', size === 'sm' ? 'h-8' : 'h-9', className)}
    >
      {options.map((o) => {
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
              'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] font-medium leading-5 transition-[background-color,color,box-shadow] duration-[160ms] ease-vx disabled:cursor-not-allowed disabled:opacity-[.38]',
              size === 'sm' ? 'px-2.5 text-[13px]' : 'px-3 text-[13.5px]',
              on ? 'bg-vx-surface text-vx-text-1 shadow-[var(--vx-shadow-1),0_0_0_1px_var(--vx-hair-soft)]' : 'text-vx-text-2 hover:text-vx-text-1',
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

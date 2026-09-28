'use client';

import { cx } from './cx';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
}

/** Platinum `.pt-seg`: collapsed hairlines; the active segment is an inverted chip. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  label,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="pt-seg">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            'border border-vx-hair px-2.5 font-mono text-[11.5px] transition-colors duration-[120ms] disabled:opacity-40',
            size === 'sm' ? 'h-6' : 'h-7',
            o.value === value ? 'relative z-10 border-pt-100 bg-pt-100 text-vx-text-inv' : 'text-vx-text-3 hover:text-vx-text-1',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default Segmented;

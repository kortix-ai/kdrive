'use client';

import { Check } from 'lucide-react';
import { cx } from './cx';

/**
 * Filter chip (DESIGN-v2 §5): 32 px (sm 28), r8, 1 px hair-strong, 13/500 text-2.
 * On: accent wash, no border, a leading 16 px check.
 */
export function Chip({
  on,
  onClick,
  children,
  icon,
  size = 'md',
  disabled,
  className,
  title,
}: {
  on?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on ?? undefined}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-vx-sm px-3 text-[13px] font-medium leading-5 transition-colors duration-[120ms] ease-vx disabled:cursor-not-allowed disabled:opacity-[.38] [&>svg]:shrink-0',
        size === 'sm' ? 'h-7' : 'h-8',
        on ? 'bg-vx-accent-wash text-vx-on-accent-wash hover:bg-vx-accent-wash-2' : 'border border-vx-hair-strong text-vx-text-2 hover:bg-vx-hover hover:text-vx-text-1',
      )}
    >
      {on ? <Check size={16} strokeWidth={2} aria-hidden /> : icon}
      {children}
    </button>
  );
}

export default Chip;

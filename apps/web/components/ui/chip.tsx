'use client';

import { Check } from 'lucide-react';
import { cx } from './cx';

/**
 * Filter chip (UNIFY-SPEC §10): 28 px (sm 24), r2, 1 px hair-strong, Inter 13/500 text-2.
 * On: accent wash, text-1, no border, a leading 14 px check.
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
        'inline-flex shrink-0 items-center gap-1.5 rounded-vx-xs px-2.5 text-[13px] font-medium leading-5 transition-colors duration-[120ms] ease-vx disabled:cursor-not-allowed disabled:opacity-[.38] [&>svg]:shrink-0',
        size === 'sm' ? 'h-6' : 'h-7',
        on ? 'bg-vx-accent-wash text-vx-text-1 hover:bg-vx-accent-wash-2' : 'border border-vx-hair-strong text-vx-text-2 hover:bg-vx-raise hover:text-vx-text-1',
        className,
      )}
    >
      {on ? <Check size={14} strokeWidth={2} aria-hidden /> : icon}
      {children}
    </button>
  );
}

export default Chip;

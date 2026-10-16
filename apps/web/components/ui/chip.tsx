'use client';

import { cx } from './cx';

/**
 * Filter chip: a 32 px pill (sm 28), surface fill, 1 px hair-strong, 14/500 text-2.
 * On: the ink fill (on-primary text, no border); aria-pressed carries the state.
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
        'inline-flex shrink-0 items-center gap-[7px] rounded-vx-pill border font-medium transition-colors duration-[160ms] ease-vx disabled:cursor-not-allowed disabled:opacity-[.38] [&>svg]:shrink-0',
        size === 'sm' ? 'h-7 px-2.5 text-[13px] leading-5' : 'h-8 px-3 text-[14px] leading-5',
        on
          ? 'border-transparent bg-vx-primary text-vx-on-primary hover:bg-vx-primary-hover'
          : 'border-vx-hair-strong bg-vx-surface text-vx-text-2 hover:border-vx-outline hover:text-vx-text-1',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export default Chip;

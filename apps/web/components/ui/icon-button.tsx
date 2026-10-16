'use client';

import { forwardRef } from 'react';
import { cx } from './cx';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name and native tooltip. */
  label: string;
  /** aria-pressed toggle: accent wash when on (Details, History). */
  toggled?: boolean;
  /** md 36 (top bar, dialogs) · sm 28 (rows, panels) · xs 24 (dense). */
  size?: 'xs' | 'sm' | 'md';
  /** Set false when a <Tooltip> already names the button. */
  nativeTitle?: boolean;
}

const SIZES = { xs: 'h-6 w-6', sm: 'h-7 w-7', md: 'h-9 w-9' } as const;

/** Square icon-only button: 8 px corners, text-2; hover fill + text-1. Put a 16-18 px lucide icon inside. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, toggled, size = 'md', nativeTitle = true, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={nativeTitle ? label : undefined}
      aria-pressed={toggled ?? undefined}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-vx-sm transition-colors duration-[160ms] ease-vx disabled:cursor-not-allowed disabled:opacity-[.38]',
        SIZES[size],
        toggled
          ? 'bg-vx-accent-wash text-vx-text-1 hover:bg-vx-accent-wash-2'
          : 'text-vx-text-2 hover:bg-vx-hover hover:text-vx-text-1 active:bg-vx-pressed',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export default IconButton;

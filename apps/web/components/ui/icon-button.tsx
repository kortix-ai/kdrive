'use client';

import { forwardRef } from 'react';
import { cx } from './cx';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name and native tooltip. */
  label: string;
  /** aria-pressed toggle: accent wash when on (Details, History). */
  toggled?: boolean;
  /** md 40 (top bar, dialogs) · sm 32 (rows, panels) · xs 28 (dense). */
  size?: 'xs' | 'sm' | 'md';
  /** Set false when a <Tooltip> already names the button. */
  nativeTitle?: boolean;
}

const SIZES = { xs: 'h-7 w-7', sm: 'h-8 w-8', md: 'h-10 w-10' } as const;

/** Circular icon-only button (DESIGN-v2 §5). Put an 18 px (20 in the top bar) lucide icon inside. */
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
        'inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-[120ms] ease-vx disabled:cursor-not-allowed disabled:opacity-[.38]',
        SIZES[size],
        toggled
          ? 'bg-vx-accent-wash text-vx-on-accent-wash hover:bg-vx-accent-wash-2'
          : 'text-vx-text-2 hover:bg-vx-surface-3 hover:text-vx-text-1 active:bg-vx-pressed',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export default IconButton;

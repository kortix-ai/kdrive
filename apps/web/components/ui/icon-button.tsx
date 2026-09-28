'use client';

import { forwardRef } from 'react';
import { cx } from './cx';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  toggled?: boolean;
  size?: 'sm' | 'md';
}

/** 28 × 28 icon-only button; `label` is its accessible name and tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, toggled, size = 'md', className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={toggled ?? undefined}
      className={cx(
        'inline-flex items-center justify-center text-vx-text-3 transition-colors duration-[120ms] hover:bg-vx-surface-2 hover:text-vx-text-1 disabled:opacity-40',
        size === 'sm' ? 'h-6 w-6' : 'h-7 w-7',
        toggled && 'bg-vx-surface-3 text-vx-text-1',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export default IconButton;

'use client';

import { forwardRef } from 'react';
import { RotateCcw } from 'lucide-react';
import { buttonClass, type ButtonSize, type ButtonVariant } from './button-class';
import { Kbd } from './kbd';
import { Spinner } from './spinner';

export { buttonClass } from './button-class';
export type { ButtonVariant, ButtonSize } from './button-class';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Leading icon (16 px; 14 px in sm/xs). `restore` gets RotateCcw when none is given. */
  icon?: React.ReactNode;
  /** Trailing icon (e.g. ChevronDown). */
  trailing?: React.ReactNode;
  /** Key hint at the right edge, in currentColor. */
  kbd?: string;
  /** Stretch to the container width. */
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'outline', size = 'md', loading, icon, trailing, kbd, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const iconSize = size === 'sm' || size === 'xs' ? 14 : 16;
  const lead = icon ?? (variant === 'restore' ? <RotateCcw size={iconSize} strokeWidth={1.75} aria-hidden /> : null);
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, { block, withIcon: !!lead, className })}
      {...rest}
    >
      {lead ? <span className="inline-flex shrink-0 items-center [&>svg]:shrink-0">{lead}</span> : null}
      {children}
      {trailing ? <span className="inline-flex shrink-0 items-center">{trailing}</span> : null}
      {loading ? <Spinner size={14} /> : null}
      {kbd ? <Kbd inButton>{kbd}</Kbd> : null}
    </button>
  );
});

export default Button;

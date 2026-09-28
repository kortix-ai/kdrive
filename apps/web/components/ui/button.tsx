'use client';

import { forwardRef } from 'react';
import { cx } from './cx';
import { Kbd } from './kbd';
import { Spinner } from './spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid' | 'restore' | 'platinum';

const base =
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-mono text-[12px] font-medium tracking-[0.01em] transition-colors duration-[120ms] active:translate-y-px disabled:pointer-events-none disabled:opacity-40';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-pt-100 text-vx-text-inv hover:brightness-110',
  secondary: 'border border-vx-hair text-vx-text-2 hover:border-vx-hair-strong hover:text-vx-text-1',
  ghost: 'text-vx-text-3 hover:bg-vx-surface-2 hover:text-vx-text-1',
  danger: 'border border-vx-danger-edge text-vx-danger hover:bg-vx-danger-wash',
  'danger-solid': 'bg-[#dc2626] text-white hover:bg-[#ef4444]',
  restore: 'border border-vx-past text-vx-past hover:bg-vx-past-wash',
  platinum: 'btn-platinum',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
  kbd?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, kbd, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const height = variant === 'platinum' ? '' : size === 'sm' ? 'h-7 px-2.5' : size === 'lg' ? 'h-10 px-4' : 'h-8 px-3';
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(base, variants[variant], height, className)}
      {...rest}
    >
      {variant === 'platinum' ? (
        <span className="btn-cta-label">
          {children}
          {loading ? <Spinner /> : null}
        </span>
      ) : (
        <>
          {variant === 'restore' && !icon ? <span aria-hidden>↺</span> : icon}
          {children}
          {loading ? <Spinner /> : null}
          {kbd ? <Kbd className="ml-1">{kbd}</Kbd> : null}
        </>
      )}
    </button>
  );
});

export default Button;

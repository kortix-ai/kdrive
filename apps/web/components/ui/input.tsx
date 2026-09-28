'use client';

import { forwardRef } from 'react';
import { cx } from './cx';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Error text shown under the field (danger frame). */
  invalid?: string | null;
  suffix?: React.ReactNode;
  leading?: React.ReactNode;
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, suffix, leading, mono, className, readOnly, ...rest },
  ref,
) {
  return (
    <div className={cx('w-full', className)}>
      <div
        className={cx(
          'flex h-8 items-center gap-2 border bg-vx-surface-2 px-2.5 transition-colors duration-[120ms] focus-within:border-vx-hair-strong',
          invalid ? 'border-vx-danger' : 'border-vx-hair',
          readOnly && 'border-dashed',
        )}
      >
        {leading ? <span className="text-vx-text-4">{leading}</span> : null}
        <input
          ref={ref}
          readOnly={readOnly}
          aria-invalid={invalid ? true : undefined}
          className={cx(
            'h-full min-w-0 flex-1 bg-transparent text-[13px] text-vx-text-1 outline-none placeholder:text-vx-text-4',
            mono && 'font-mono text-[12px]',
          )}
          {...rest}
        />
        {suffix ? <span className="vx-meta text-vx-text-4">{suffix}</span> : null}
      </div>
      {invalid ? <p className="mt-1 border-l-2 border-vx-danger pl-2 text-[12px] text-vx-danger">{invalid}</p> : null}
    </div>
  );
});

export default Input;

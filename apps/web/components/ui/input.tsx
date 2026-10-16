'use client';

import { forwardRef, useId } from 'react';
import { CircleAlert } from 'lucide-react';
import { cx } from './cx';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Error text shown under the field (2 px danger border). */
  invalid?: string | null;
  /** Unit or trailing content (e.g. `GB`), text-3. */
  suffix?: React.ReactNode;
  /** Leading icon, text-3. */
  leading?: React.ReactNode;
  /** Mono text: ids, hashes, URLs only. */
  mono?: boolean;
  /** Label above the field (14/500 text-2). */
  label?: React.ReactNode;
  /** One line of help under the field. */
  hint?: React.ReactNode;
  /** md 40 (forms) · sm 32 (dense forms, toolbars) · lg 46 (sign-in). */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Text field: field fill, 1 px hair-strong, 8 px corners (12 at lg). Focus inks the edge and adds a soft 4 px halo;
 * invalid turns the edge danger with a danger halo and a message under the field.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, suffix, leading, mono, label, hint, size = 'md', className, readOnly, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const msgId = `${inputId}-msg`;
  return (
    <div className={cx('w-full', className)}>
      {label ? (
        <label htmlFor={inputId} className="mb-2 block text-[14px] font-medium leading-5 text-vx-text-2">
          {label}
        </label>
      ) : null}
      <div
        className={cx(
          'flex items-center gap-2.5 transition-[border-color,box-shadow,background-color] duration-[160ms] ease-vx',
          size === 'sm' ? 'h-8 rounded-vx-sm px-2.5' : size === 'lg' ? 'h-[46px] rounded-vx-md px-3.5' : 'h-10 rounded-vx-sm px-3',
          readOnly
            ? 'border border-vx-hair bg-vx-surface-2'
            : invalid
              ? 'border border-vx-danger-edge bg-vx-field shadow-[0_0_0_4px_var(--vx-danger-wash)]'
              : 'border border-vx-hair-strong bg-vx-field hover:border-vx-outline focus-within:border-vx-text-1 focus-within:shadow-[0_0_0_4px_var(--vx-selection)]',
        )}
      >
        {leading ? <span className="inline-flex shrink-0 text-vx-text-3">{leading}</span> : null}
        <input
          ref={ref}
          id={inputId}
          readOnly={readOnly}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid || hint ? msgId : undefined}
          className={cx(
            'h-full min-w-0 flex-1 bg-transparent text-vx-text-1 outline-none placeholder:text-vx-text-3',
            mono ? 'font-mono text-[13px]' : size === 'sm' ? 'text-[14px]' : 'text-[15px]',
          )}
          {...rest}
        />
        {suffix ? <span className="shrink-0 font-mono text-[12px] text-vx-text-3">{suffix}</span> : null}
      </div>
      {invalid ? (
        <p id={msgId} className="mt-1.5 flex items-center gap-1.5 text-[14px] leading-5 text-vx-danger">
          <CircleAlert size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
          {invalid}
        </p>
      ) : hint ? (
        <p id={msgId} className="mt-1.5 text-[13px] leading-5 text-vx-text-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export default Input;

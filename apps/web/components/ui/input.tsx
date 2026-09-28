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
  /** Label above the field (13/500 text-2). */
  label?: React.ReactNode;
  /** One line of help under the field. */
  hint?: React.ReactNode;
  /** md 44 (forms) · sm 36 (dense forms, toolbars). */
  size?: 'sm' | 'md';
}

/** Text field (DESIGN-v2 §5): r8, surface, 1 px outline; focus 2 px accent; invalid 2 px danger + message. */
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
        <label htmlFor={inputId} className="mb-1 block text-[13px] font-medium leading-5 text-vx-text-2">
          {label}
        </label>
      ) : null}
      <div
        className={cx(
          'flex items-center gap-2 rounded-vx-sm px-3 transition-[border-color,box-shadow] duration-[120ms] ease-vx',
          size === 'sm' ? 'h-9' : 'h-11',
          readOnly
            ? 'bg-vx-surface-2'
            : invalid
              ? 'border border-vx-danger bg-vx-surface shadow-[inset_0_0_0_1px_var(--vx-danger)]'
              : 'border border-vx-outline bg-vx-surface hover:border-vx-text-3 focus-within:border-vx-accent-edge focus-within:shadow-[inset_0_0_0_1px_var(--vx-accent-edge)]',
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
            'h-full min-w-0 flex-1 bg-transparent text-vx-text-1 outline-none placeholder:text-vx-text-4',
            mono ? 'font-mono text-[13px]' : size === 'sm' ? 'text-[14px]' : 'text-[15px]',
          )}
          {...rest}
        />
        {suffix ? <span className="shrink-0 text-[13px] text-vx-text-3">{suffix}</span> : null}
      </div>
      {invalid ? (
        <p id={msgId} className="mt-1 flex items-center gap-1.5 text-[13px] leading-5 text-vx-danger">
          <CircleAlert size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
          {invalid}
        </p>
      ) : hint ? (
        <p id={msgId} className="vx-meta mt-1 text-vx-text-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export default Input;

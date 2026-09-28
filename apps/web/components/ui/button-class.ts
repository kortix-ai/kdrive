// Server-safe: no 'use client', so server components (e.g. not-found) can style links as buttons.
import { cx } from './cx';

/**
 * Action buttons (DESIGN-v2 §5): 8 px rounded rectangles.
 * - primary: near-black, at most one per view
 * - tonal: accent wash
 * - outline: white with a 1 px border (the default)
 * - text: accent text, no frame
 * - ghost: neutral text, no frame (quiet toolbar and Cancel buttons)
 * - restore / past-primary: the past (amber) family
 * - danger / danger-text / ok
 */
export type ButtonVariant =
  | 'primary'
  | 'tonal'
  | 'outline'
  | 'text'
  | 'ghost'
  | 'restore'
  | 'past-primary'
  | 'danger'
  | 'danger-text'
  | 'ok';

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const base =
  'relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-vx-sm text-[14px] font-medium leading-5 transition-colors duration-[120ms] ease-vx disabled:cursor-not-allowed disabled:opacity-[.38]';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-vx-primary text-vx-on-primary hover:bg-vx-primary-hover',
  tonal: 'bg-vx-accent-wash text-vx-on-accent-wash hover:bg-vx-accent-wash-2',
  outline: 'border border-vx-hair-strong bg-vx-surface text-vx-text-1 hover:bg-vx-hover active:bg-vx-pressed',
  text: 'text-vx-accent hover:bg-vx-hover hover:text-vx-accent-strong active:bg-vx-pressed',
  ghost: 'text-vx-text-2 hover:bg-vx-hover hover:text-vx-text-1 active:bg-vx-pressed',
  restore: 'border border-vx-past-edge bg-vx-surface text-vx-past hover:bg-vx-past-wash',
  'past-primary': 'bg-vx-past text-vx-on-past hover:brightness-95',
  danger: 'bg-vx-danger text-vx-on-danger hover:bg-vx-danger-strong',
  'danger-text': 'text-vx-del-fg hover:bg-vx-danger-wash',
  ok: 'bg-vx-ok-wash text-vx-ok',
};

const sizes: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-[13px] gap-1.5',
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-9 px-4',
  lg: 'h-11 px-5',
};
/** Text buttons sit tighter (padding 0 12). */
const textSizes: Partial<Record<ButtonSize, string>> = { md: 'h-9 px-3', lg: 'h-11 px-4' };

/** Button classes for elements that are not <button> (e.g. a Next <Link> or <a download>). */
export function buttonClass(variant: ButtonVariant = 'outline', size: ButtonSize = 'md', opts: { block?: boolean; withIcon?: boolean; className?: string } = {}): string {
  const pad = (variant === 'text' || variant === 'danger-text' || variant === 'ghost') && textSizes[size] ? textSizes[size] : sizes[size];
  return cx(base, variants[variant], pad, opts.withIcon && size !== 'xs' && 'pl-3', opts.block && 'w-full', opts.className);
}

// Server-safe: no 'use client', so server components (e.g. not-found) can style links as buttons.
import { cx } from './cx';

/**
 * Action buttons (UNIFY-SPEC §10): r4 rectangles, Inter 14/500, 16 px icons.
 * - primary: platinum (dark) / graphite (light) fill, at most one per view (the landing "Get started")
 * - tonal: accent wash
 * - outline: transparent with a 1 px hair-strong border (the landing ghost; the default)
 * - text: text-1, underlined on hover, no frame
 * - ghost: neutral text, no frame (quiet toolbar and Cancel buttons)
 * - restore / past-primary: the past (brass) family
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
  'relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-vx-sm text-[14px] font-medium leading-5 transition-colors duration-[120ms] ease-vx disabled:cursor-not-allowed';

const variants: Record<ButtonVariant, string> = {
  // Disabled primary reads as unavailable, not broken: a quiet surface slab with a hair edge (no faded fill).
  // While loading (aria-busy) it keeps its fill and shows the spinner.
  primary:
    'bg-vx-primary text-vx-on-primary hover:bg-vx-primary-hover disabled:not-aria-busy:bg-vx-surface-3 disabled:not-aria-busy:text-vx-text-4 disabled:not-aria-busy:shadow-[inset_0_0_0_1px_var(--vx-hair)]',
  tonal: 'bg-vx-accent-wash text-vx-on-accent-wash hover:bg-vx-accent-wash-2',
  outline: 'border border-vx-hair-strong bg-transparent text-vx-text-1 hover:bg-vx-raise active:bg-vx-pressed',
  text: 'text-vx-text-1 underline-offset-[3px] hover:underline hover:decoration-vx-hair-strong active:bg-vx-pressed',
  ghost: 'text-vx-text-2 hover:bg-vx-raise hover:text-vx-text-1 active:bg-vx-pressed',
  restore: 'border border-vx-past-edge bg-transparent text-vx-past hover:bg-vx-past-wash',
  'past-primary': 'bg-vx-past text-vx-on-past hover:brightness-110',
  danger: 'bg-vx-danger-fill text-vx-on-danger hover:brightness-110',
  'danger-text': 'text-vx-danger hover:bg-vx-danger-wash hover:text-vx-danger-strong',
  ok: 'bg-vx-ok-wash text-vx-ok',
};

const sizes: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-[13px] gap-1.5',
  sm: 'h-[30px] px-3 text-[13px] gap-1.5',
  md: 'h-9 px-3.5',
  lg: 'h-11 px-5',
};
/** Text buttons sit tighter (padding 0 10). */
const textSizes: Partial<Record<ButtonSize, string>> = { md: 'h-9 px-2.5', lg: 'h-11 px-3' };

/** Button classes for elements that are not <button> (e.g. a Next <Link> or <a download>). */
export function buttonClass(variant: ButtonVariant = 'outline', size: ButtonSize = 'md', opts: { block?: boolean; withIcon?: boolean; className?: string } = {}): string {
  const pad = (variant === 'text' || variant === 'danger-text' || variant === 'ghost') && textSizes[size] ? textSizes[size] : sizes[size];
  return cx(base, variants[variant], variant !== 'primary' && 'disabled:opacity-[.38]', pad, opts.withIcon && size !== 'xs' && 'pl-3', opts.block && 'w-full', opts.className);
}

// Server-safe: no 'use client', so server components (e.g. not-found) can style links as buttons.
import { cx } from './cx';

/**
 * Action buttons: 8 px corners (12 at lg), Geist 500, 16 px icons. Heights 28 · 32 · 40 · 48.
 * - primary: the ink fill (text-1 on paper), at most one per view
 * - tonal: ember wash
 * - outline: the soft secondary: surface fill, hair-strong edge, a 1 px shadow (the default)
 * - text: text-1, underlined on hover, no frame
 * - ghost: neutral text, no frame (quiet toolbar and Cancel buttons)
 * - restore / past-primary: the past (cobalt) family; past-primary is white on cobalt
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
  'relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,border-color,color,transform] duration-[160ms] ease-vx enabled:active:translate-y-px disabled:cursor-not-allowed';

const variants: Record<ButtonVariant, string> = {
  // Disabled primary reads as unavailable, not broken: a quiet surface slab with a hair edge (no faded fill).
  // While loading (aria-busy) it keeps its fill and shows the spinner.
  primary:
    'bg-vx-primary text-vx-on-primary shadow-[inset_0_1px_0_rgba(255,255,255,.12),0_1px_2px_rgba(0,0,0,.16)] hover:bg-vx-primary-hover disabled:not-aria-busy:bg-vx-surface-3 disabled:not-aria-busy:text-vx-text-3 disabled:not-aria-busy:shadow-[inset_0_0_0_1px_var(--vx-hair)]',
  tonal: 'bg-vx-accent-wash text-vx-on-accent-wash hover:bg-vx-accent-wash-2',
  outline:
    'border border-vx-hair-strong bg-vx-surface text-vx-text-1 shadow-vx-1 hover:border-vx-outline hover:bg-vx-field-hover active:bg-vx-pressed',
  text: 'text-vx-text-1 underline-offset-[3px] hover:underline hover:decoration-vx-hair-strong active:bg-vx-pressed',
  ghost: 'text-vx-text-2 hover:bg-vx-hover hover:text-vx-text-1 active:bg-vx-pressed',
  restore: 'border border-vx-past-edge bg-transparent text-vx-past hover:bg-vx-past-wash',
  'past-primary': 'bg-[var(--vx-past-fill)] text-vx-on-past shadow-[inset_0_1px_0_rgba(255,255,255,.14)] hover:brightness-110',
  danger: 'bg-vx-danger-fill text-vx-on-danger hover:brightness-110',
  'danger-text': 'text-vx-danger hover:bg-vx-danger-wash hover:text-vx-danger-strong',
  ok: 'bg-vx-ok-wash text-vx-ok',
};

const sizes: Record<ButtonSize, string> = {
  xs: 'h-7 rounded-vx-sm px-2.5 text-[13px] leading-5 gap-1.5',
  sm: 'h-8 rounded-vx-sm px-3 text-[14px] leading-5 gap-1.5',
  md: 'h-10 rounded-vx-sm px-4 text-[15px] leading-5',
  lg: 'h-12 rounded-vx-md px-6 text-[16px] leading-6',
};
/** Text buttons sit tighter. */
const textSizes: Partial<Record<ButtonSize, string>> = { md: 'h-10 rounded-vx-sm px-3 text-[15px] leading-5', lg: 'h-12 rounded-vx-md px-3.5 text-[16px] leading-6' };

/** Button classes for elements that are not <button> (e.g. a Next <Link> or <a download>). */
export function buttonClass(variant: ButtonVariant = 'outline', size: ButtonSize = 'md', opts: { block?: boolean; withIcon?: boolean; className?: string } = {}): string {
  const pad = (variant === 'text' || variant === 'danger-text' || variant === 'ghost') && textSizes[size] ? textSizes[size] : sizes[size];
  return cx(
    base,
    variants[variant],
    variant !== 'primary' && 'disabled:opacity-[.38]',
    pad,
    opts.withIcon && size !== 'xs' && (size === 'lg' ? 'pl-5' : size === 'md' ? 'pl-3.5' : 'pl-2.5'),
    opts.block && 'w-full',
    opts.className,
  );
}

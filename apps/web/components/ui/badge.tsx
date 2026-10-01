import { cx } from './cx';

export type BadgeTone = 'neutral' | 'current' | 'accent' | 'live' | 'past' | 'dashed' | 'danger' | 'add' | 'del';

const TONES: Record<BadgeTone, string> = {
  /** surface-3 + text-2: counts, Pinned, Auto, Admin */
  neutral: 'bg-vx-surface-3 text-vx-text-2',
  /** accent fill + white: Current */
  current: 'bg-vx-accent text-vx-on-accent',
  /** accent wash: checkpoints (pair with a ◆ icon) */
  accent: 'bg-vx-accent-wash text-vx-on-accent-wash',
  /** ok wash + ok: Live (pair with `pip`) */
  live: 'bg-vx-ok-wash text-vx-ok',
  /** the past: amber wash + edge inset */
  past: 'bg-vx-past-wash text-vx-past shadow-[inset_0_0_0_1px_var(--vx-past-edge)]',
  /** dashed hair: Expired, Revoked, Shown as text, Emulated storage */
  dashed: 'border border-dashed border-vx-hair-dash text-vx-text-3',
  danger: 'bg-vx-danger-wash text-vx-danger',
  add: 'bg-vx-add-bg text-vx-add-fg',
  del: 'bg-vx-del-bg text-vx-del-fg',
};

/**
 * Badge (UNIFY-SPEC §10): 20 px, r2, Inter 11/600 sentence case, padding 0 6, optional 12 px icon or a 6 px pip.
 * Tones: neutral · current · accent (checkpoint) · live · past · dashed · danger · add · del.
 */
export function Badge({
  tone = 'neutral',
  icon,
  pip,
  children,
  className,
  title,
}: {
  tone?: BadgeTone;
  icon?: React.ReactNode;
  /** A 6 px dot in currentColor before the label (Live). */
  pip?: boolean;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex h-5 max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-vx-xs px-1.5 text-[11px] font-semibold leading-4 tabular-nums [&>svg]:h-3 [&>svg]:w-3 [&>svg]:shrink-0',
        TONES[tone],
        className,
      )}
    >
      {pip ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" /> : null}
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

export default Badge;

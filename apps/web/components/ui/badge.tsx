import { cx } from './cx';

export type BadgeTone = 'neutral' | 'current' | 'accent' | 'live' | 'past' | 'dashed' | 'danger' | 'add' | 'del';

const TONES: Record<BadgeTone, string> = {
  /** surface-3 + text-2: counts, Pinned, Auto, Admin */
  neutral: 'bg-vx-surface-3 text-vx-text-2',
  /** ember fill: Current */
  current: 'bg-vx-accent text-vx-on-accent',
  /** ember wash: now, checkpoints (pair with a ◆ icon) */
  accent: 'bg-vx-accent-wash-2 text-vx-on-accent-wash',
  /** ok wash + ok: Live (pair with `pip`) */
  live: 'bg-vx-ok-wash text-vx-ok',
  /** the past: cobalt wash */
  past: 'bg-vx-past-wash text-vx-past',
  /** dashed hair: Expired, Revoked, Shown as text, Emulated storage */
  dashed: 'border border-dashed border-vx-hair-dash text-vx-text-3',
  danger: 'bg-vx-danger-wash text-vx-danger',
  add: 'bg-vx-add-bg text-vx-add-fg',
  del: 'bg-vx-del-bg text-vx-del-fg',
};

/**
 * Badge: 22 px, 6 px corners, Geist Mono 11.5/500, padding 0 8, optional 12 px icon or a 6 px pip.
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
        'inline-flex h-[22px] max-w-full shrink-0 items-center gap-[5px] whitespace-nowrap rounded-[6px] px-2 font-mono text-[11.5px] font-medium leading-4 tabular-nums [&>svg]:h-3 [&>svg]:w-3 [&>svg]:shrink-0',
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

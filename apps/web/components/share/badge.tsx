import { cx } from '@/components/ui/cx';

/** Platinum `.badge`: 1 px currentColor frame, 10 px mono caps. `pip` adds the 4 px purple dot (LIVE). */
export function Badge({
  children,
  tone = 'default',
  pip,
  className,
  title,
}: {
  children: React.ReactNode;
  tone?: 'default' | 'dim' | 'accent' | 'danger' | 'ok' | 'past';
  pip?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex h-[18px] shrink-0 items-center gap-1 border border-current px-1.5 font-mono text-[10px] font-medium uppercase leading-none tracking-[0.12em]',
        tone === 'default' && 'text-vx-text-2',
        tone === 'dim' && 'text-vx-text-4',
        tone === 'accent' && 'text-vx-accent',
        tone === 'danger' && 'text-vx-danger',
        tone === 'ok' && 'text-vx-ok',
        tone === 'past' && 'text-vx-past',
        className,
      )}
    >
      {pip ? <span aria-hidden className="inline-block h-1 w-1 bg-vx-accent" /> : null}
      {children}
    </span>
  );
}

export default Badge;

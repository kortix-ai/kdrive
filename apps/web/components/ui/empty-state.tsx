import { cx } from './cx';

/**
 * Flat empty-state illustration (DESIGN-v2 §5, §6.18): 120 px, rounded sheets in surface-3 and
 * accent-wash with one accent dot. `tone="past"` (past or missing things) draws a dashed outline
 * sheet and an amber dot instead. Floats gently unless reduced motion is on.
 */
export function EmptyArt({ className, float = true, tone = 'default', size = 120 }: { className?: string; float?: boolean; tone?: 'default' | 'past'; size?: number }) {
  const past = tone === 'past';
  return (
    <div className={cx('flex flex-col items-center', className)} aria-hidden>
      <div className={float ? 'ea-float' : 'flex'}>
        <svg width={size} height={size} viewBox="0 0 120 120" fill="none">
          <rect x="30" y="20" width="60" height="72" rx="10" transform="rotate(-8 60 56)" fill="var(--vx-surface-3)" />
          <rect x="30" y="22" width="60" height="72" rx="10" transform="rotate(5 60 58)" fill="var(--vx-accent-wash)" />
          {past ? (
            <rect x="30" y="26" width="60" height="72" rx="10" fill="var(--vx-surface)" stroke="var(--vx-hair-dash)" strokeWidth="1.5" strokeDasharray="4 4" />
          ) : (
            <rect x="30" y="26" width="60" height="72" rx="10" fill="var(--vx-surface)" stroke="var(--vx-hair)" strokeWidth="1.5" />
          )}
          <rect x="40" y="40" width="32" height="5" rx="2.5" fill="var(--vx-surface-3)" />
          <rect x="40" y="52" width="40" height="5" rx="2.5" fill="var(--vx-surface-3)" />
          <rect x="40" y="64" width="24" height="5" rx="2.5" fill="var(--vx-surface-3)" />
          <circle cx="80" cy="84" r="7" fill={past ? 'var(--vx-past-dot)' : 'var(--vx-accent)'} />
          <circle cx="80" cy="84" r="11" stroke={past ? 'var(--vx-past-halo)' : 'var(--vx-accent-wash)'} strokeWidth="3" />
        </svg>
      </div>
    </div>
  );
}

/** Teaching empty state: illustration, title (18/600), one line (16 text-3), at most one action. */
export function EmptyState({
  title,
  body,
  actions,
  art = true,
  tone = 'default',
  className,
}: {
  title: React.ReactNode;
  body?: React.ReactNode;
  actions?: React.ReactNode;
  art?: boolean;
  tone?: 'default' | 'past';
  className?: string;
}) {
  return (
    <div className={cx('mx-auto flex max-w-[360px] flex-col items-center justify-center px-6 py-16 text-center', className)}>
      {art ? <EmptyArt className="mb-6" tone={tone} /> : null}
      <div className="vx-title">{title}</div>
      {body ? <p className="vx-body-lg mt-2 text-vx-text-3">{body}</p> : null}
      {actions ? <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

export default EmptyState;

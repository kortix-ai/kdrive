import { cx } from '@/components/ui/cx';

/** A `.pt-band` settings section: label + hairline, then the content. */
export function Section({ id, label, aside, children, className }: { id: string; label: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby={`s-${id}`} className={cx('py-6', className)}>
      <div className="pt-band mb-4">
        <h2 id={`s-${id}`} className="vx-label">
          {label}
        </h2>
        {aside ? <span className="order-last pl-3">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** Square avatar (24 / 32 px) with a 1 px frame and an initials fallback. */
export function Avatar({ name, image, size = 32 }: { name: string; image?: string | null; size?: 24 | 32 }) {
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
  const box = size === 32 ? 'h-8 w-8 text-[11px]' : 'h-6 w-6 text-[10px]';
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" width={size} height={size} referrerPolicy="no-referrer" className={cx('shrink-0 border border-vx-hair object-cover', box)} />;
  }
  return <span className={cx('inline-flex shrink-0 items-center justify-center border border-vx-hair font-mono text-vx-text-2', box)}>{initials || '·'}</span>;
}

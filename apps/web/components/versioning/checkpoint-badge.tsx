import { cx } from '@/components/ui/cx';

/**
 * `◆ name`: a named version (purple diamond, hairline badge, name in text-2).
 * `glyph={false}` drops the diamond where a ◆ node glyph already marks the row.
 */
export function CheckpointBadge({ name, className, bare, glyph = true }: { name: string; className?: string; bare?: boolean; glyph?: boolean }) {
  return (
    <span
      title={`Checkpoint: ${name}`}
      className={cx(
        'vx-micro inline-flex min-w-0 max-w-full items-center gap-1',
        !bare && 'h-[18px] border border-vx-accent-edge px-1.5',
        className,
      )}
    >
      {glyph ? (
        <span aria-hidden className="text-vx-accent">
          ◆
        </span>
      ) : null}
      <span className="truncate text-vx-text-2">{name}</span>
    </span>
  );
}

/** Uppercase hairline badge (CURRENT, AUTO, NOW …). */
export function Badge({ children, tone = 'neutral', className }: { children: React.ReactNode; tone?: 'neutral' | 'past' | 'dim'; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex h-4 shrink-0 items-center border px-1 font-mono text-[9.5px] font-medium uppercase leading-none tracking-[0.14em]',
        tone === 'neutral' && 'border-vx-hair-strong text-vx-text-2',
        tone === 'past' && 'border-vx-past-edge text-vx-past',
        tone === 'dim' && 'border-vx-hair text-vx-text-4',
        className,
      )}
    >
      {children}
    </span>
  );
}

export default CheckpointBadge;

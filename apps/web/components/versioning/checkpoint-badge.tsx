import { Badge } from '@/components/ui/badge';
import { cx } from '@/components/ui/cx';

/**
 * The checkpoint mark (UNIFY-SPEC §10, §12.3): a small rotated square in currentColor.
 * Filled by default; `outline` draws only its 1 px edge (a checkpoint ahead of the viewed version).
 */
export function CheckpointDiamond({ size = 7, outline, className }: { size?: number; outline?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx('inline-block shrink-0 rotate-45', outline ? 'shadow-[inset_0_0_0_1px_currentColor]' : 'bg-current', className)}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Checkpoint badge: an accent-wash r2 tag with a ◆ and the name.
 * `bare` drops the tag (a quiet inline name); `glyph={false}` drops the ◆.
 */
export function CheckpointBadge({ name, className, bare, glyph = true }: { name: string; className?: string; bare?: boolean; glyph?: boolean }) {
  const icon = glyph ? <CheckpointDiamond className="mx-px" /> : undefined;
  if (bare) {
    return (
      <span title={`Checkpoint: ${name}`} className={cx('inline-flex min-w-0 max-w-full items-center gap-1.5 text-vx-text-1', className)}>
        {icon}
        <span className="truncate">{name}</span>
      </span>
    );
  }
  return (
    <Badge tone="accent" icon={icon} title={`Checkpoint: ${name}`} className={cx('min-w-0 gap-1.5', className)}>
      {name}
    </Badge>
  );
}

export default CheckpointBadge;

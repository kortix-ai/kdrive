import { Bookmark } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cx } from '@/components/ui/cx';

/**
 * Checkpoint badge (DESIGN-v2 §5): an accent-wash pill with a filled Bookmark and the name.
 * `bare` drops the pill (a quiet inline name); `glyph={false}` drops the bookmark.
 */
export function CheckpointBadge({ name, className, bare, glyph = true }: { name: string; className?: string; bare?: boolean; glyph?: boolean }) {
  const icon = glyph ? <Bookmark size={12} strokeWidth={2} fill="currentColor" aria-hidden /> : undefined;
  if (bare) {
    return (
      <span title={`Checkpoint: ${name}`} className={cx('inline-flex min-w-0 max-w-full items-center gap-1 text-vx-accent', className)}>
        {icon}
        <span className="truncate">{name}</span>
      </span>
    );
  }
  return (
    <Badge tone="accent" icon={icon} title={`Checkpoint: ${name}`} className={cx('min-w-0', className)}>
      {name}
    </Badge>
  );
}

export default CheckpointBadge;

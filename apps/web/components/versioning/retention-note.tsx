import { RETENTION_COPY } from '@volumes/shared';
import { cx } from '@/components/ui/cx';

/** What history is kept (accurate to Platinum retention for the commits this app makes). */
export function RetentionNote({ className, as: Tag = 'p' }: { className?: string; as?: 'p' | 'span' }) {
  return <Tag className={cx('vx-micro text-vx-text-4', className)}>{RETENTION_COPY}</Tag>;
}

export default RetentionNote;

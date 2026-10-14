'use client';

import { Badge } from '@/components/ui/badge';
import { cx } from '@/components/ui/cx';
import { useConfig } from '@/lib/api/hooks';

/** Small dashed note, only when the API runs on the local storage emulator (secondary to "Get more storage"). */
export function EmulatedBadge({ className }: { className?: string }) {
  const { data } = useConfig();
  if (data?.storageMode !== 'emulated') return null;
  return (
    <Badge tone="dashed" className={cx('h-4 px-1 text-[10px] font-medium', className)} title="Files are kept by the local storage emulator (VOLUMES_STORAGE=emulated).">
      Emulated storage
    </Badge>
  );
}

export default EmulatedBadge;

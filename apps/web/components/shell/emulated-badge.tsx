'use client';

import { Badge } from '@/components/ui/badge';
import { useConfig } from '@/lib/api/hooks';

/** Dashed neutral badge, only when the API runs on the local storage emulator. */
export function EmulatedBadge({ className }: { className?: string }) {
  const { data } = useConfig();
  if (data?.storageMode !== 'emulated') return null;
  return (
    <Badge tone="dashed" className={className} title="Files are kept by the local storage emulator (VOLUMES_STORAGE=emulated).">
      Emulated storage
    </Badge>
  );
}

export default EmulatedBadge;

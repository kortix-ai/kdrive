'use client';

import { useConfig } from '@/lib/api/hooks';

/** Dashed neutral chip, only when the API runs on the local storage emulator. */
export function EmulatedBadge() {
  const { data } = useConfig();
  if (data?.storageMode !== 'emulated') return null;
  return (
    <span
      title="Files are stored by the local emulator (VOLUMES_STORAGE=emulated), not Platinum."
      className="vx-label inline-flex h-6 items-center border border-dashed border-vx-hair-dash px-2 text-[9.5px] text-vx-text-3"
    >
      Emulated storage
    </span>
  );
}

export default EmulatedBadge;

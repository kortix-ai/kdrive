'use client';

// STUB (FOUNDATION). Owner: WEB-versioning. Replace the body; keep the default export name and no-props signature.
import { useVx } from '@/lib/store';

export default function TimeStrip() {
  const tt = useVx((s) => s.timeTravel);
  return (
    <div className="flex h-full items-center px-4 font-mono text-[11.5px] text-vx-text-4">
      TIME STRIP · {tt ? 'past' : 'now'} (WEB-versioning)
    </div>
  );
}

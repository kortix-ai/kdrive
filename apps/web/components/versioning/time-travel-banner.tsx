'use client';

// STUB (FOUNDATION). Owner: WEB-versioning. Replace the body; keep the default export name and no-props signature.
import { useVx } from '@/lib/store';

export default function TimeTravelBanner() {
  const tt = useVx((s) => s.timeTravel);
  const exit = useVx((s) => s.exitTimeTravel);
  if (!tt) return null;
  return (
    <div className="flex h-10 items-center gap-3 border-b border-vx-past-edge bg-vx-past-wash px-4 font-mono text-[12px] text-vx-past">
      Viewing {tt.createdAt} (WEB-versioning) <button onClick={exit} className="underline">Back to now</button>
    </div>
  );
}

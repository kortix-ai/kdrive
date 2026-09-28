'use client';

// STUB (FOUNDATION). Owner: WEB-versioning. Replace the body; keep the default export name and no-props signature.
import { useVx } from '@/lib/store';

export default function CheckpointDialog() {
  const cp = useVx((s) => s.checkpoint);
  const close = useVx((s) => s.closeCheckpoint);
  if (!cp) return null;
  return (
    <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 border border-vx-hair-strong bg-vx-float px-4 py-2 font-mono text-[12px] text-vx-text-3">
      New checkpoint (WEB-versioning) · <button onClick={close} className="text-vx-text-1">close</button>
    </div>
  );
}

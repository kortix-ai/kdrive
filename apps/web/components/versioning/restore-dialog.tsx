'use client';

// STUB (FOUNDATION). Owner: WEB-versioning. Replace the body; keep the default export name and no-props signature.
import { useVx } from '@/lib/store';

export default function RestoreDialog() {
  const restore = useVx((s) => s.restore);
  const close = useVx((s) => s.closeRestore);
  if (!restore) return null;
  return (
    <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 border border-vx-past bg-vx-float px-4 py-2 font-mono text-[12px] text-vx-past">
      Restore {restore.scope} (WEB-versioning) · <button onClick={close} className="text-vx-text-1">close</button>
    </div>
  );
}

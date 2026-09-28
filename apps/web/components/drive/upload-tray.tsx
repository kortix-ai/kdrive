'use client';

// STUB (FOUNDATION). Owner: WEB-drive. Replace the body; keep the default export name and no-props signature.
import { useVx } from '@/lib/store';

export default function UploadTray() {
  const uploads = useVx((s) => s.uploads);
  if (!uploads.length) return null;
  return <div className="fixed bottom-4 right-4 z-40 border border-vx-hair-strong bg-vx-float px-3 py-2 font-mono text-[12px] text-vx-text-3">{uploads.length} upload(s) (WEB-drive)</div>;
}

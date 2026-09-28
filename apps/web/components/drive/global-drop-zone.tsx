'use client';

// STUB (FOUNDATION). Owner: WEB-drive. Replace the body; keep the default export name and no-props signature.
import { useVx } from '@/lib/store';

export default function GlobalDropZone() {
  useVx((s) => s.workspaceId);
  return null;
}

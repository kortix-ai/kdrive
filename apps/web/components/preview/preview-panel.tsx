'use client';

// STUB (FOUNDATION). Owner: WEB-preview-share-settings. Replace the body; keep the default export name and no-props signature.
import { useVx } from '@/lib/store';

export default function PreviewPanel() {
  const panel = useVx((s) => s.panel);
  if (!panel) return null;
  return <div className="p-4 font-mono text-[12px] text-vx-text-3">Preview of {panel.path} (WEB-preview-share-settings)</div>;
}

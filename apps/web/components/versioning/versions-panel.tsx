'use client';

// STUB (FOUNDATION). Owner: WEB-versioning. Replace the body; keep the default export name and no-props signature.
import { useVx } from '@/lib/store';

export default function VersionsPanel() {
  const panel = useVx((s) => s.panel);
  if (!panel) return null;
  return <div className="p-4 font-mono text-[12px] text-vx-text-3">Versions of {panel.path} (WEB-versioning)</div>;
}

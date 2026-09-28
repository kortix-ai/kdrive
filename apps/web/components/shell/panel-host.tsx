'use client';

import PreviewPanel from '@/components/preview/preview-panel';
import VersionsPanel from '@/components/versioning/versions-panel';
import { useVx } from '@/lib/store';
import { IconButton } from '@/components/ui/icon-button';
import { Tabs } from '@/components/ui/tabs';

/** Right-hand panel (440 px): Preview · Versions tabs over the builder-owned panels. */
export function PanelHost() {
  const panel = useVx((s) => s.panel);
  const openPreview = useVx((s) => s.openPreview);
  const openVersions = useVx((s) => s.openVersions);
  const close = useVx((s) => s.closePanel);
  if (!panel) return null;
  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-vx-hair bg-vx-surface" aria-label="Details panel">
      <div className="flex items-center justify-between pr-2">
        <Tabs
          className="flex-1 px-4"
          value={panel.kind}
          onChange={(k) => (k === 'preview' ? openPreview(panel.path, { at: panel.at }) : openVersions(panel.path))}
          items={[
            { id: 'preview', label: 'Preview' },
            { id: 'versions', label: 'Versions' },
          ]}
        />
        <IconButton label="Close panel (Esc)" onClick={close} className="border-b border-vx-hair">
          <span className="font-mono text-[12px]">✕</span>
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{panel.kind === 'preview' ? <PreviewPanel /> : <VersionsPanel />}</div>
    </aside>
  );
}

export default PanelHost;

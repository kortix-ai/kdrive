'use client';

import { X } from 'lucide-react';
import PreviewPanel from '@/components/preview/preview-panel';
import VersionsPanel from '@/components/versioning/versions-panel';
import { useStat } from '@/lib/api/hooks';
import { useVx } from '@/lib/store';
import { IconButton } from '@/components/ui/icon-button';
import { Tabs } from '@/components/ui/tabs';

/** Details panel (400 px sheet): Preview (Details for a folder) · Versions tabs over the area-owned panels, and ✕. */
export function PanelHost() {
  const panel = useVx((s) => s.panel);
  const openPreview = useVx((s) => s.openPreview);
  const openVersions = useVx((s) => s.openVersions);
  const close = useVx((s) => s.closePanel);
  // A folder has nothing to preview: its first tab is its details (the same request the panel makes).
  const { data: stat } = useStat(panel?.path ?? null, panel?.at ?? null);
  if (!panel) return null;
  const folder = stat?.type === 'dir' && stat.path === panel.path;
  return (
    <aside className="flex h-full min-h-0 flex-col" aria-label="Details panel">
      <div className="flex shrink-0 items-center gap-2 pl-3 pr-2 pt-1">
        <Tabs
          className="min-w-0 flex-1 border-b-0"
          value={panel.kind}
          onChange={(k) => (k === 'preview' ? openPreview(panel.path, { at: panel.at }) : openVersions(panel.path))}
          items={[
            { id: 'preview', label: folder ? 'Details' : 'Preview' },
            { id: 'versions', label: 'Versions' },
          ]}
        />
        <IconButton label="Close panel (Esc)" size="sm" onClick={close}>
          <X size={18} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </div>
      <div className="h-px shrink-0 bg-vx-hair-soft" />
      <div className="min-h-0 flex-1 overflow-auto">{panel.kind === 'preview' ? <PreviewPanel /> : <VersionsPanel />}</div>
    </aside>
  );
}

export default PanelHost;

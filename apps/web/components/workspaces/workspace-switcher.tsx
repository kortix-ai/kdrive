'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Copy, Layers, Plus } from 'lucide-react';
import { formatBytes, shortId, type WorkspaceSummary } from '@volumes/shared';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { cx } from '@/components/ui/cx';
import { useVx } from '@/lib/store';
import { NewWorkspaceDialog } from './new-workspace-dialog';

/** "Duplicated from Personal @a41f9c2" (or null for an original workspace). */
export function provenance(ws: Pick<WorkspaceSummary, 'forkedFrom'>): string | null {
  const f = ws.forkedFrom;
  if (!f) return null;
  return `Duplicated from ${f.workspaceName ?? 'a deleted workspace'} ${shortId(f.commitId)}`;
}

/**
 * Sidebar workspace switcher (DESIGN-v2 §5): a 36 px pill (Layers · name · ChevronDown);
 * an icon button in the 72 px sidebar. Menu: workspaces (✓ current, usage), provenance,
 * New workspace, Duplicate current…
 */
export default function WorkspaceSwitcher() {
  const router = useRouter();
  const me = useVx((s) => s.me);
  const wsId = useVx((s) => s.workspaceId);
  const setWorkspace = useVx((s) => s.setWorkspace);
  const openDuplicate = useVx((s) => s.openDuplicate);
  const [creating, setCreating] = useState(false);

  const workspaces = me?.workspaces ?? [];
  const current = workspaces.find((w) => w.id === wsId);
  const origin = current ? provenance(current) : null;

  const items: MenuItem[] = [
    { id: 'h', type: 'label', label: 'Workspaces' },
    ...workspaces.map<MenuItem>((w) => ({
      id: `ws-${w.id}`,
      checked: w.id === wsId,
      icon: <Layers size={18} strokeWidth={1.75} />,
      label: w.name,
      hint: formatBytes(w.usageBytes),
      onSelect: () => {
        if (w.id !== wsId) setWorkspace(w.id);
        router.push('/drive');
      },
    })),
    ...(origin ? [{ id: 'origin', type: 'label' as const, label: <span className="vx-micro text-vx-text-3">{origin}</span> }] : []),
    { id: 'sep', type: 'separator' },
    { id: 'new', label: 'New workspace', icon: <Plus size={18} strokeWidth={1.75} />, onSelect: () => setCreating(true) },
    { id: 'dup', label: 'Duplicate current…', icon: <Copy size={18} strokeWidth={1.75} />, onSelect: () => openDuplicate() },
  ];

  return (
    <div className="w-full">
      <Menu
        items={items}
        minWidth={240}
        trigger={(p) => (
          <button
            type="button"
            {...p}
            title={origin ?? current?.name}
            aria-label={`Workspace: ${current?.name ?? '…'}`}
            className={cx(
              'flex h-9 w-full items-center gap-3 rounded-full px-3 text-left text-vx-text-2 transition-colors duration-[120ms] ease-vx hover:bg-vx-hover hover:text-vx-text-1 aria-expanded:bg-vx-hover',
              'max-[1023px]:mx-auto max-[1023px]:h-10 max-[1023px]:w-10 max-[1023px]:justify-center max-[1023px]:px-0',
              'max-[720px]:mx-0 max-[720px]:h-9 max-[720px]:w-full max-[720px]:justify-start max-[720px]:px-3',
            )}
          >
            <Layers size={18} strokeWidth={1.75} aria-hidden className="shrink-0" />
            <span className="vx-side-full min-w-0 flex-1 truncate text-[14px] font-medium text-vx-text-1">{current?.name ?? '…'}</span>
            <ChevronDown size={16} strokeWidth={1.75} aria-hidden className="vx-side-full shrink-0 text-vx-text-3" />
          </button>
        )}
      />
      <NewWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

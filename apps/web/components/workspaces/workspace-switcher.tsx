'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Copy, Plus } from 'lucide-react';
import { formatBytes, shortId, type WorkspaceSummary } from '@volumes/shared';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { useVx } from '@/lib/store';
import { NewWorkspaceDialog } from './new-workspace-dialog';

/** "Duplicated from Personal @a41f9c2" (or null for an original workspace). */
export function provenance(ws: Pick<WorkspaceSummary, 'forkedFrom'>): string | null {
  const f = ws.forkedFrom;
  if (!f) return null;
  return `Duplicated from ${f.workspaceName ?? 'a deleted workspace'} ${shortId(f.commitId)}`;
}

/** Left-rail workspace switcher: list (✓ current, usage), provenance, New workspace, Duplicate current… */
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
      icon: <span className="inline-block w-3" />,
      label: (
        <span className="flex items-center justify-between gap-3">
          <span className="truncate">{w.name}</span>
          <span className="vx-meta shrink-0 text-vx-text-4">{formatBytes(w.usageBytes)}</span>
        </span>
      ),
      onSelect: () => {
        if (w.id !== wsId) setWorkspace(w.id);
        router.push('/drive');
      },
    })),
    ...(origin ? [{ id: 'origin', type: 'label' as const, label: <span className="normal-case tracking-normal text-vx-text-4">{origin}</span> }] : []),
    { id: 'sep', type: 'separator' },
    { id: 'new', label: 'New workspace', icon: <Plus size={14} />, onSelect: () => setCreating(true) },
    { id: 'dup', label: 'Duplicate current…', icon: <Copy size={14} />, onSelect: () => openDuplicate() },
  ];

  return (
    <div className="px-3 pb-2">
      <Menu
        items={items}
        trigger={(p) => (
          <button
            type="button"
            {...p}
            title={origin ?? current?.name}
            className="flex h-8 w-full items-center gap-2 border border-vx-hair px-2.5 text-left font-mono text-[12px] text-vx-text-2 transition-colors duration-[120ms] hover:border-vx-hair-strong hover:text-vx-text-1 aria-expanded:border-vx-hair-strong"
          >
            <ChevronDown size={14} className="text-vx-text-4" aria-hidden />
            <span className="flex-1 truncate">{current?.name ?? '…'}</span>
            {workspaces.length > 1 ? <span className="vx-meta text-vx-text-4">{workspaces.length}</span> : null}
          </button>
        )}
      />
      <NewWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Copy, Layers, Pencil, Plus, Users } from 'lucide-react';
import { formatBytes, shortId, type WorkspaceSummary } from '@volumes/shared';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { cx } from '@/components/ui/cx';
import { useVx } from '@/lib/store';
import { Invitations } from './invitations';
import { NewWorkspaceDialog } from './new-workspace-dialog';

/** "Duplicated from Personal @a41f9c2" (or null for an original workspace). */
export function provenance(ws: Pick<WorkspaceSummary, 'forkedFrom'>): string | null {
  const f = ws.forkedFrom;
  if (!f) return null;
  return `Duplicated from ${f.workspaceName ?? 'a deleted drive'} ${shortId(f.commitId)}`;
}

/**
 * Sidebar workspace switcher (UNIFY-SPEC §11): a 32 px r4 row (Layers 16 · name 14/500 · chevron);
 * a 40 × 32 icon cell in the collapsed 64 px sidebar. Menu: workspaces (✓ current, usage), provenance,
 * People…, Rename current…, New workspace, Duplicate current…. Drives shared with you are listed
 * under their own label with the owner's name; only the owner renames or duplicates a drive.
 */
export default function WorkspaceSwitcher() {
  const router = useRouter();
  const me = useVx((s) => s.me);
  const wsId = useVx((s) => s.workspaceId);
  const setWorkspace = useVx((s) => s.setWorkspace);
  const openDuplicate = useVx((s) => s.openDuplicate);
  const [creating, setCreating] = useState(false);
  const openRenameDrive = useVx((s) => s.openRenameDrive);
  const openPeople = useVx((s) => s.openPeople);

  const workspaces = me?.workspaces ?? [];
  const current = workspaces.find((w) => w.id === wsId);
  const origin = current ? provenance(current) : null;

  const own = workspaces.filter((w) => w.role === 'owner');
  const shared = workspaces.filter((w) => w.role !== 'owner');
  const owner = current?.role === 'owner';
  const row = (w: WorkspaceSummary): MenuItem => ({
    id: `ws-${w.id}`,
    checked: w.id === wsId,
    icon: w.role === 'owner' ? <Layers size={16} strokeWidth={1.75} /> : <Users size={16} strokeWidth={1.75} />,
    label: w.name,
    hint: w.owner ? `${w.owner.name || w.owner.email} · ${w.role === 'editor' ? 'Editor' : 'Viewer'}` : formatBytes(w.usageBytes),
    onSelect: () => {
      if (w.id !== wsId) setWorkspace(w.id);
      router.push('/drive');
    },
  });

  const items: MenuItem[] = [
    { id: 'h', type: 'label', label: 'Drives' },
    ...own.map(row),
    ...(shared.length ? [{ id: 'hs', type: 'label' as const, label: 'Shared with me' }, ...shared.map(row)] : []),
    ...(origin && owner ? [{ id: 'origin', type: 'label' as const, label: <span className="vx-micro text-vx-text-3">{origin}</span> }] : []),
    { id: 'sep', type: 'separator' },
    ...(current ? [{ id: 'people', label: owner ? 'Share this drive…' : 'People…', icon: <Users size={16} strokeWidth={1.75} />, onSelect: () => openPeople() }] : []),
    ...(current && owner ? [{ id: 'rename', label: 'Rename this drive…', icon: <Pencil size={16} strokeWidth={1.75} />, onSelect: () => openRenameDrive() }] : []),
    { id: 'new', label: 'New drive', icon: <Plus size={16} strokeWidth={1.75} />, onSelect: () => setCreating(true) },
    ...(owner ? [{ id: 'dup', label: 'Duplicate this drive…', icon: <Copy size={16} strokeWidth={1.75} />, onSelect: () => openDuplicate() }] : []),
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
            aria-label={`Drive: ${current?.name ?? '…'}`}
            className={cx(
              'flex h-8 w-full items-center gap-2.5 rounded-vx-sm px-2.5 text-left text-vx-text-2 transition-colors duration-[120ms] ease-vx hover:bg-vx-raise hover:text-vx-text-1 aria-expanded:bg-vx-raise',
              'max-[1023px]:mx-auto max-[1023px]:h-8 max-[1023px]:w-10 max-[1023px]:justify-center max-[1023px]:px-0',
              'max-[720px]:mx-0 max-[720px]:h-8 max-[720px]:w-full max-[720px]:justify-start max-[720px]:px-2.5',
            )}
          >
            <Layers size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
            <span className="vx-side-full min-w-0 flex-1 truncate text-[14px] font-medium text-vx-text-1">{current?.name ?? '…'}</span>
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden className="vx-side-full shrink-0 text-vx-text-3" />
          </button>
        )}
      />
      <Invitations />
      <NewWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

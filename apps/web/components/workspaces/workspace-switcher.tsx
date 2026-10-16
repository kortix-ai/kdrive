'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronsUpDown, Copy, Layers, Pencil, Plus, Users } from 'lucide-react';
import { formatBytes, shortId, type WorkspaceSummary } from '@volumes/shared';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { cx } from '@/components/ui/cx';
import { objectHue } from '@/components/ui/file-icon';
import { useVx } from '@/lib/store';
import { Invitations } from './invitations';
import { NewWorkspaceDialog } from './new-workspace-dialog';

/** "Duplicated from Personal @a41f9c2" (or null for an original workspace). */
export function provenance(ws: Pick<WorkspaceSummary, 'forkedFrom'>): string | null {
  const f = ws.forkedFrom;
  if (!f) return null;
  return `Duplicated from ${f.workspaceName ?? 'a deleted drive'} ${shortId(f.commitId)}`;
}

/** The drive's mark: its initial on a square in the drive's own hue (34 px; white on oklch .48). */
function DriveMark({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] text-[14px] font-semibold text-white"
      style={{ background: `oklch(0.48 0.12 ${objectHue(name)})` }}
    >
      {(name.trim()[0] ?? '·').toUpperCase()}
    </span>
  );
}

/**
 * Sidebar workspace switcher (UNIFY-SPEC §11): a 54 px surface card (the drive's mark · name 15/600 over
 * whose it is and its size · ⇅); the mark alone in the collapsed 64 px sidebar. Menu: workspaces (✓ current, usage), provenance,
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
              'flex h-[54px] w-full items-center gap-3 rounded-vx-md border border-vx-hair bg-vx-surface py-2 pl-2.5 pr-2 text-left text-vx-text-2 transition-[border-color,box-shadow] duration-[120ms] ease-vx hover:border-vx-hair-strong aria-expanded:border-vx-hair-strong aria-expanded:shadow-vx-1',
              'max-[1023px]:mx-auto max-[1023px]:h-10 max-[1023px]:w-10 max-[1023px]:justify-center max-[1023px]:border-0 max-[1023px]:bg-transparent max-[1023px]:p-0',
              'side-collapsed:mx-auto side-collapsed:h-10 side-collapsed:w-10 side-collapsed:justify-center side-collapsed:border-0 side-collapsed:bg-transparent side-collapsed:p-0',
              'max-[720px]:mx-0 max-[720px]:h-[54px] max-[720px]:w-full max-[720px]:justify-start max-[720px]:border max-[720px]:bg-vx-surface max-[720px]:py-2 max-[720px]:pl-2.5 max-[720px]:pr-2',
            )}
          >
            <DriveMark name={current?.name ?? ''} />
            <span className="vx-side-full min-w-0 flex-1">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[15px] font-semibold leading-5 text-vx-text-1">{current?.name ?? '…'}</span>
                <span className="truncate text-[13px] leading-[18px] text-vx-text-3">
                  {current ? (current.owner ? `${current.owner.name || current.owner.email} · ${current.role === 'viewer' ? 'Viewer' : 'Editor'}` : `Yours · ${formatBytes(current.usageBytes)}`) : ''}
                </span>
              </span>
            </span>
            <ChevronsUpDown size={16} strokeWidth={1.75} aria-hidden className="vx-side-full shrink-0 text-vx-text-3" />
          </button>
        )}
      />
      <Invitations />
      <NewWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

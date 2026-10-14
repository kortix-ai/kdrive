'use client';

// Drive sheet head (UNIFY-SPEC §14.2): 52 px, breadcrumbs as r4 crumbs (the current one
// opens the folder menu), then the list/grid segmented control (`v`) and the Details (i)
// button for the current folder. Search and + New live in the shell.
// Phones (≤ 720 px, §7): an up button when not at the root, the current folder name
// 20/600 + ▾, and the list/grid toggle on the right.
import { ArrowLeft, ChevronDown, Info, LayoutGrid, List, Users } from 'lucide-react';
import { basename, dirname } from '@volumes/shared';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { Segmented } from '@/components/ui/segmented';
import { Tooltip } from '@/components/ui/tooltip';
import { useVx } from '@/lib/store';
import Breadcrumbs from './breadcrumbs';

/** In someone else's drive: "Ada's · View only" (or Editor). Opens People. */
function SharedBadge() {
  const ws = useVx((s) => s.me?.workspaces.find((w) => w.id === s.workspaceId) ?? null);
  const openPeople = useVx((s) => s.openPeople);
  if (!ws?.owner) return null;
  const who = ws.owner.name || ws.owner.email;
  const role = ws.role === 'viewer' ? 'View only' : 'Editor';
  return (
    <Tooltip label={`Shared by ${ws.owner.email}. See who has access.`}>
      <button
        type="button"
        onClick={openPeople}
        aria-label={`Shared by ${who}, you are ${ws.role === 'viewer' ? 'a viewer' : 'an editor'}. People`}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-vx-sm border border-vx-hair px-2 text-[12px] font-medium text-vx-text-2 hover:bg-vx-raise hover:text-vx-text-1 max-[720px]:hidden"
      >
        <Users size={14} strokeWidth={1.75} aria-hidden />
        <span className="max-w-[160px] truncate">{who}</span>
        <span aria-hidden className="text-vx-text-4">·</span>
        <span className={ws.role === 'viewer' ? 'text-vx-past' : undefined}>{role}</span>
      </button>
    </Tooltip>
  );
}

export default function Toolbar({
  path,
  rootName,
  past,
  view,
  onView,
  onNavigate,
  onDropItems,
  canDropInto,
  folderMenu,
  detailsOpen,
  onDetails,
  phone,
  missing,
}: {
  path: string;
  rootName: string;
  past: boolean;
  view: 'list' | 'grid';
  onView: (v: 'list' | 'grid') => void;
  onNavigate: (path: string) => void;
  onDropItems: (dest: string) => void;
  canDropInto: (dest: string) => boolean;
  folderMenu: MenuItem[];
  detailsOpen: boolean;
  onDetails: () => void;
  phone?: boolean;
  /** The folder is not there: no folder menu, no view toggle, no details. */
  missing?: boolean;
}) {
  const here = path === '/' ? rootName : basename(path);
  const viewToggle = (
    <Segmented
      label="View"
      value={view}
      onChange={onView}
      options={[
        { value: 'list', ariaLabel: 'List view (V)', label: <List size={16} strokeWidth={1.75} aria-hidden /> },
        { value: 'grid', ariaLabel: 'Grid view (V)', label: <LayoutGrid size={16} strokeWidth={1.75} aria-hidden /> },
      ]}
    />
  );

  if (phone) {
    const up = dirname(path) === '/' ? rootName : basename(dirname(path));
    return (
      <header className="flex h-[52px] shrink-0 items-center gap-1 pl-1.5 pr-3">
        {path !== '/' ? (
          <IconButton label={`Up to ${up}`} onClick={() => onNavigate(dirname(path))}>
            <ArrowLeft size={18} strokeWidth={1.75} aria-hidden />
          </IconButton>
        ) : (
          <span className="w-0.5" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          {missing ? (
            <span className="block truncate px-2 text-[20px] font-semibold leading-[26px] tracking-[-0.02em] text-vx-text-1">{here}</span>
          ) : (
            <Menu
              items={folderMenu}
              trigger={(p) => (
                <button
                  type="button"
                  {...p}
                  aria-label={`${here}: folder actions`}
                  title={path === '/' ? rootName : path}
                  className="inline-flex h-9 max-w-full items-center gap-1 rounded-vx-sm px-2 text-[20px] font-semibold leading-[26px] tracking-[-0.02em] text-vx-text-1 hover:bg-vx-raise"
                >
                  <span className="truncate">{here}</span>
                  <ChevronDown size={16} strokeWidth={2} className="shrink-0 text-vx-text-3" aria-hidden />
                </button>
              )}
            />
          )}
        </div>
        {missing ? null : viewToggle}
      </header>
    );
  }

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-2 pl-2 pr-3">
      <div className="min-w-0 flex-1">
        <Breadcrumbs
          path={path}
          rootName={rootName}
          past={past}
          onNavigate={onNavigate}
          onDropItems={onDropItems}
          canDropInto={canDropInto}
          folderMenu={folderMenu}
          missing={missing}
        />
      </div>
      <SharedBadge />
      {missing ? null : (
        <>
          {viewToggle}
          <Tooltip label="Details">
            <IconButton label="Details" nativeTitle={false} toggled={detailsOpen} onClick={onDetails}>
              <Info size={18} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </Tooltip>
        </>
      )}
    </header>
  );
}

'use client';

// Drive sheet head (DESIGN-v2 §6.2): 64 px, breadcrumbs as pill crumbs (the current one
// opens the folder menu), then the list/grid segmented control (`v`) and the Details (i)
// button for the current folder. Search and + New live in the shell.
// Phones (≤ 720 px, §7): an up button when not at the root, the current folder name
// 22/600 + ▾, and the list/grid toggle on the right.
import { ArrowLeft, ChevronDown, Info, LayoutGrid, List } from 'lucide-react';
import { basename, dirname } from '@volumes/shared';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { Segmented } from '@/components/ui/segmented';
import { Tooltip } from '@/components/ui/tooltip';
import Breadcrumbs from './breadcrumbs';

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
}) {
  const here = path === '/' ? rootName : basename(path);
  const viewToggle = (
    <Segmented
      label="View"
      value={view}
      onChange={onView}
      check={!phone}
      options={[
        { value: 'list', ariaLabel: 'List view (V)', label: <List size={18} strokeWidth={1.75} aria-hidden /> },
        { value: 'grid', ariaLabel: 'Grid view (V)', label: <LayoutGrid size={18} strokeWidth={1.75} aria-hidden /> },
      ]}
    />
  );

  if (phone) {
    const up = dirname(path) === '/' ? rootName : basename(dirname(path));
    return (
      <header className="flex h-16 shrink-0 items-center gap-1 pl-2 pr-4">
        {path !== '/' ? (
          <IconButton label={`Up to ${up}`} onClick={() => onNavigate(dirname(path))}>
            <ArrowLeft size={20} strokeWidth={1.75} aria-hidden />
          </IconButton>
        ) : (
          <span className="w-2" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <Menu
            items={folderMenu}
            trigger={(p) => (
              <button
                type="button"
                {...p}
                aria-label={`${here}: folder actions`}
                title={path === '/' ? rootName : path}
                className="inline-flex h-10 max-w-full items-center gap-1 rounded-full px-2 text-[22px] font-semibold leading-7 tracking-[-0.02em] text-vx-text-1 hover:bg-vx-hover"
              >
                <span className="truncate">{here}</span>
                <ChevronDown size={18} strokeWidth={1.75} className="shrink-0 text-vx-text-2" aria-hidden />
              </button>
            )}
          />
        </div>
        {viewToggle}
      </header>
    );
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 pl-2 pr-3">
      <div className="min-w-0 flex-1">
        <Breadcrumbs
          path={path}
          rootName={rootName}
          past={past}
          onNavigate={onNavigate}
          onDropItems={onDropItems}
          canDropInto={canDropInto}
          folderMenu={folderMenu}
        />
      </div>
      {viewToggle}
      <Tooltip label="Details">
        <IconButton label="Details" nativeTitle={false} toggled={detailsOpen} onClick={onDetails}>
          <Info size={20} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </Tooltip>
    </header>
  );
}

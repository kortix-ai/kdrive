'use client';

// Drive sheet head (UNIFY-SPEC §14.2): a crumb row (ancestors, 15 px) with the shared badge, tag
// filter, the list/grid segmented control (`v`) and the Details (i) button on the right; then the
// folder's name as the page title (32/600, ▾ opens the folder menu) and a meta line
// ("8 files · 4 folders · updated 2 h ago"). Search and + New live in the shell.
// Phones (≤ 720 px, §7): an up button when not at the root, the title 24/600 + ▾, the list/grid
// toggle on the right, and the meta line under it.
import { ArrowLeft, ChevronDown, Info, LayoutGrid, List, Users } from 'lucide-react';
import { basename, dirname } from '@volumes/shared';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { Segmented } from '@/components/ui/segmented';
import { Tooltip } from '@/components/ui/tooltip';
import { cx } from '@/components/ui/cx';
import { useVx } from '@/lib/store';
import Breadcrumbs from './breadcrumbs';
import LabelFilter from '@/components/labels/label-filter';

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
  summary,
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
  /** The meta line under the title. */
  summary?: string;
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

  const title = (size: 'lg' | 'md') => {
    const cls =
      size === 'lg'
        ? 'text-[32px] leading-[38px] tracking-[-0.024em]'
        : 'text-[24px] leading-[30px] tracking-[-0.02em]';
    if (missing) return <h1 className={cx('truncate font-semibold text-vx-text-1', cls)}>{here}</h1>;
    return (
      <Menu
        items={folderMenu}
        trigger={(p) => (
          <button
            type="button"
            {...p}
            aria-label={`${here}: folder actions`}
            title={path === '/' ? rootName : path}
            className="-ml-2 inline-flex max-w-full items-center gap-1.5 rounded-vx-sm px-2 text-left text-vx-text-1 transition-colors duration-[120ms] hover:bg-vx-raise aria-expanded:bg-vx-raise"
          >
            <h1 className={cx('truncate font-semibold', cls)}>{here}</h1>
            <ChevronDown size={size === 'lg' ? 20 : 18} strokeWidth={2} className="mt-1 shrink-0 text-vx-text-3" aria-hidden />
          </button>
        )}
      />
    );
  };

  if (phone) {
    const up = dirname(path) === '/' ? rootName : basename(dirname(path));
    return (
      <header className="shrink-0 px-4 pb-1 pt-3">
        <div className="flex items-center gap-1">
          {path !== '/' ? (
            <IconButton label={`Up to ${up}`} onClick={() => onNavigate(dirname(path))} className="-ml-2">
              <ArrowLeft size={18} strokeWidth={1.75} aria-hidden />
            </IconButton>
          ) : null}
          <div className="min-w-0 flex-1">{title('md')}</div>
          {missing ? null : viewToggle}
        </div>
        {summary ? <p className="mt-0.5 truncate text-[14px] leading-5 text-vx-text-3">{summary}</p> : null}
      </header>
    );
  }

  const tools = (
    <>
      <SharedBadge />
      {past ? null : <LabelFilter />}
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
    </>
  );
  // At the root there is nothing above the title: the tools share its row.
  const root = path === '/';
  return (
    <header className={cx('shrink-0 px-6 pb-1', root ? 'pt-5' : 'pt-3.5')}>
      {root ? null : (
        <div className="flex h-9 items-center gap-2">
          <div className="-ml-2 min-w-0 flex-1">
            <Breadcrumbs
              path={path}
              rootName={rootName}
              past={past}
              onNavigate={onNavigate}
              onDropItems={onDropItems}
              canDropInto={canDropInto}
              missing={missing}
            />
          </div>
          {tools}
        </div>
      )}
      <div className={cx('flex min-w-0 items-center gap-2', !root && 'mt-1')}>
        <div className="min-w-0 flex-1">{title('lg')}</div>
        {root ? tools : null}
      </div>
      {summary ? <p className="mt-0.5 truncate text-[15px] leading-[22px] text-vx-text-3">{summary}</p> : null}
    </header>
  );
}

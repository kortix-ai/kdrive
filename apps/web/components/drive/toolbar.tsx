'use client';

// Top bar (48 px): crumbs · search · view · + Folder · Upload ▾ (DESIGN §6.2).
// In the past the write controls stay visible but disabled, with the reason.
import { ChevronDown, FolderPlus, FolderUp, LayoutGrid, List, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Menu } from '@/components/ui/menu';
import { Segmented } from '@/components/ui/segmented';
import { Tooltip } from '@/components/ui/tooltip';
import Breadcrumbs from './breadcrumbs';
import { READ_ONLY_REASON } from './drive-context';
import { SearchField } from './search-box';

export default function Toolbar({
  path,
  rootName,
  past,
  view,
  onView,
  onNavigate,
  onDropItems,
  canDropInto,
  onOpenSearch,
  onNewFolder,
  onUploadFiles,
  onUploadFolder,
}: {
  path: string;
  rootName: string;
  past: boolean;
  view: 'list' | 'grid';
  onView: (v: 'list' | 'grid') => void;
  onNavigate: (path: string) => void;
  onDropItems: (dest: string) => void;
  canDropInto: (dest: string) => boolean;
  onOpenSearch: () => void;
  onNewFolder: () => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
}) {
  const guard = (el: React.ReactNode, label: string, kbd?: string) =>
    past ? (
      <Tooltip label={READ_ONLY_REASON}>{el}</Tooltip>
    ) : (
      <Tooltip label={label} kbd={kbd}>
        {el}
      </Tooltip>
    );

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-vx-hair px-4 max-[720px]:pl-12">
      <div className="min-w-0 flex-1">
        <Breadcrumbs path={path} rootName={rootName} past={past} onNavigate={onNavigate} onDropItems={onDropItems} canDropInto={canDropInto} />
      </div>
      <SearchField onOpen={onOpenSearch} />
      <Segmented
        label="View"
        value={view}
        onChange={onView}
        options={[
          { value: 'list', label: <List size={14} aria-label="List view (V)" /> },
          { value: 'grid', label: <LayoutGrid size={14} aria-label="Grid view (V)" /> },
        ]}
      />
      {guard(
        <Button variant="secondary" onClick={onNewFolder} disabled={past} kbd="N" icon={<FolderPlus size={14} aria-hidden />} className="max-[900px]:[&>kbd]:hidden">
          Folder
        </Button>,
        'New folder',
        'N',
      )}
      <div className="flex items-stretch">
        {guard(
          <Button variant="primary" onClick={onUploadFiles} disabled={past} kbd="U" icon={<Upload size={14} aria-hidden />} className="[&>kbd]:border-[var(--pt-600)]">
            Upload
          </Button>,
          'Upload files',
          'U',
        )}
        <Menu
          align="end"
          items={[
            { id: 'files', label: 'Upload files', icon: <Upload size={14} />, kbd: 'U', onSelect: onUploadFiles, disabled: past, reason: READ_ONLY_REASON },
            { id: 'folder', label: 'Upload folder', icon: <FolderUp size={14} />, kbd: '⇧U', onSelect: onUploadFolder, disabled: past, reason: READ_ONLY_REASON },
          ]}
          trigger={(p) => (
            <button
              type="button"
              {...p}
              disabled={past}
              aria-label="More upload options"
              className="inline-flex h-8 w-7 items-center justify-center border-l border-[var(--pt-600)] bg-pt-100 text-vx-text-inv transition-[filter] duration-[120ms] hover:brightness-110 disabled:opacity-40"
            >
              <ChevronDown size={14} aria-hidden />
            </button>
          )}
        />
      </div>
    </header>
  );
}

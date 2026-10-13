'use client';

// "+ New" (UNIFY-SPEC §11): the full-width primary button at the top of the sidebar and,
// on phones, the primary FAB. Its menu: New folder N · Upload files U · Upload folder ⇧U.
// Uploads start here (into the open folder on /drive, else the drive root);
// New folder is handed to the drive through lib/shell-intents.
import { usePathname, useRouter } from 'next/navigation';
import { FolderPlus, FolderUp, Plus, Upload } from 'lucide-react';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';
import { cx } from '@/components/ui/cx';
import { sendShellIntent } from '@/lib/shell-intents';
import { currentRole, useVx, VIEW_ONLY_REASON } from '@/lib/store';
import { startUpload } from '@/lib/upload/uploads';
import { pickUploadSources } from '@/lib/upload/walk';

import { READ_ONLY_REASON } from '@/components/drive/drive-context';

const onDriveRoute = (p: string) => p === '/drive' || p.startsWith('/drive/');

function useNewItems(): { past: boolean; reason: string; items: MenuItem[] } {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  // Writes are off in the past and for a viewer of someone else's drive.
  const viewOnly = useVx((s) => currentRole(s) === 'viewer');
  const past = useVx((s) => !!s.timeTravel) || viewOnly;
  const reason = viewOnly ? VIEW_ONLY_REASON : READ_ONLY_REASON;
  const upload = (folder: boolean) => {
    const base = onDriveRoute(pathname) ? useVx.getState().path : '/';
    // The picker must open inside this click, so it is not deferred.
    void pickUploadSources(folder).then((sources) => {
      if (sources) startUpload({ basePath: base, sources });
    });
  };
  const newFolder = () => {
    // On /drive this runs at once; elsewhere it waits for the drive to mount.
    sendShellIntent('new-folder');
    if (!onDriveRoute(pathname)) router.push('/drive');
  };
  const items: MenuItem[] = [
    { id: 'new-folder', label: 'New folder', icon: <FolderPlus size={16} strokeWidth={1.75} />, kbd: 'N', onSelect: newFolder, disabled: past, reason },
    { id: 'sep', type: 'separator' },
    { id: 'upload-files', label: 'Upload files', icon: <Upload size={16} strokeWidth={1.75} />, kbd: 'U', onSelect: () => upload(false), disabled: past, reason },
    { id: 'upload-folder', label: 'Upload folder', icon: <FolderUp size={16} strokeWidth={1.75} />, kbd: '⇧U', onSelect: () => upload(true), disabled: past, reason },
  ];
  return { past, reason, items };
}

/** The sidebar button: primary, 36 px, r4, full width; a 40 × 40 plus in the 64 px sidebar. */
export function NewButton() {
  const { past, reason, items } = useNewItems();
  const button = (p: Record<string, unknown>) => (
    <button
      type="button"
      {...p}
      disabled={past}
      data-testid="new-button"
      aria-label={past ? `New. ${reason}` : 'New'}
      className={cx(
        'inline-flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded-vx-sm bg-vx-primary px-3.5 text-[14px] font-medium text-vx-on-primary transition-[background-color,opacity] duration-[120ms] ease-vx',
        'hover:bg-vx-primary-hover aria-expanded:bg-vx-primary-hover',
        // Unavailable in the past: a quiet surface slab with a hair edge, not a faded fill that looks broken.
        'disabled:cursor-not-allowed disabled:bg-vx-surface-3 disabled:text-vx-text-4 disabled:shadow-[inset_0_0_0_1px_var(--vx-hair)] disabled:hover:bg-vx-surface-3',
        'max-[1023px]:h-10 max-[1023px]:w-10 max-[1023px]:p-0 max-[720px]:h-9 max-[720px]:w-full max-[720px]:px-3.5',
      )}
    >
      <Plus size={16} strokeWidth={2} aria-hidden />
      <span className="vx-side-full">New</span>
    </button>
  );
  // The tooltip wrapper is a block, so the disabled button keeps its full width in the past (no layout jump).
  if (past)
    return (
      <Tooltip label={reason} side="right" className="flex w-full">
        {button({})}
      </Tooltip>
    );
  // Like every menu: 4 px below its anchor, here exactly as wide as the button.
  return <Menu matchWidth minWidth={216} items={items} trigger={(p) => button(p)} />;
}

/** Phone FAB (≤ 720 px, /drive only): primary, 48 px, r4, bottom-right above the strip pill. */
export function NewFab() {
  const { past, reason, items } = useNewItems();
  return (
    <div className="fixed bottom-[calc(16px+var(--vx-strip-h)+16px)] right-4 z-40 hidden max-[720px]:block">
      <Menu
        align="end"
        minWidth={240}
        items={items}
        trigger={(p) => (
          <button
            type="button"
            {...p}
            disabled={past}
            title={past ? reason : undefined}
            className="inline-flex h-12 items-center gap-2 rounded-vx-sm bg-vx-primary pl-4 pr-5 text-[14px] font-medium text-vx-on-primary shadow-vx-3 hover:bg-vx-primary-hover disabled:cursor-not-allowed disabled:bg-vx-surface-3 disabled:text-vx-text-4 disabled:shadow-[inset_0_0_0_1px_var(--vx-hair)]"
          >
            <Plus size={18} strokeWidth={2} aria-hidden />
            New
          </button>
        )}
      />
    </div>
  );
}

export default NewButton;

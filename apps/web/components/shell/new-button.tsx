'use client';

// "+ New" (DESIGN-v2 §5): the raised pill at the top of the sidebar and, on phones,
// the tonal FAB. Its menu: New folder N · Upload files U · Upload folder ⇧U.
// Uploads start here (into the open folder on /drive, else the drive root);
// New folder is handed to the drive through lib/shell-intents.
import { usePathname, useRouter } from 'next/navigation';
import { FolderPlus, FolderUp, Plus, Upload } from 'lucide-react';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';
import { cx } from '@/components/ui/cx';
import { sendShellIntent } from '@/lib/shell-intents';
import { useVx } from '@/lib/store';
import { startUpload } from '@/lib/upload/uploads';
import { pickUploadSources } from '@/lib/upload/walk';

import { READ_ONLY_REASON } from '@/components/drive/drive-context';

const onDriveRoute = (p: string) => p === '/drive' || p.startsWith('/drive/');

function useNewItems(): { past: boolean; items: MenuItem[] } {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const past = useVx((s) => !!s.timeTravel);
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
    { id: 'new-folder', label: 'New folder', icon: <FolderPlus size={18} strokeWidth={1.75} />, kbd: 'N', onSelect: newFolder, disabled: past, reason: READ_ONLY_REASON },
    { id: 'sep', type: 'separator' },
    { id: 'upload-files', label: 'Upload files', icon: <Upload size={18} strokeWidth={1.75} />, kbd: 'U', onSelect: () => upload(false), disabled: past, reason: READ_ONLY_REASON },
    { id: 'upload-folder', label: 'Upload folder', icon: <FolderUp size={18} strokeWidth={1.75} />, kbd: '⇧U', onSelect: () => upload(true), disabled: past, reason: READ_ONLY_REASON },
  ];
  return { past, items };
}

/** The sidebar pill: 56 px, float fill, shadow-2; plus-only in the 72 px sidebar. */
export function NewButton() {
  const { past, items } = useNewItems();
  const button = (p: Record<string, unknown>) => (
    <button
      type="button"
      {...p}
      disabled={past}
      data-testid="new-button"
      aria-label={past ? `New. ${READ_ONLY_REASON}` : 'New'}
      className={cx(
        'inline-flex h-14 shrink-0 items-center gap-3 rounded-full bg-vx-float pl-4 pr-6 text-[14px] font-semibold text-vx-text-1 shadow-vx-2 transition-[background-color,box-shadow] duration-[120ms] ease-vx',
        'hover:bg-vx-surface-2 hover:shadow-vx-3 aria-expanded:bg-vx-surface-2 aria-expanded:shadow-vx-3',
        'disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-vx-1 disabled:hover:bg-vx-float',
        'max-[1023px]:w-14 max-[1023px]:justify-center max-[1023px]:p-0 max-[720px]:w-auto max-[720px]:justify-start max-[720px]:pl-4 max-[720px]:pr-6',
      )}
    >
      <Plus size={24} strokeWidth={2.25} className="text-vx-accent" aria-hidden />
      <span className="vx-side-full">New</span>
    </button>
  );
  if (past) return <Tooltip label={READ_ONLY_REASON} side="right">{button({})}</Tooltip>;
  return <Menu placement="over" minWidth={240} items={items} trigger={(p) => button(p)} />;
}

/** Phone FAB (≤ 720 px, /drive only): tonal, 56 px, r16, bottom-right above the strip pill. */
export function NewFab() {
  const { past, items } = useNewItems();
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
            title={past ? READ_ONLY_REASON : undefined}
            className="inline-flex h-14 items-center gap-2 rounded-vx-lg bg-vx-accent-wash pl-4 pr-5 text-[14px] font-semibold text-vx-on-accent-wash shadow-vx-3 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Plus size={24} strokeWidth={2.25} aria-hidden />
            New
          </button>
        )}
      />
    </div>
  );
}

export default NewButton;

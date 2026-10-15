'use client';

// One row of the Starred and Recent pages (items from any drive): icon + name (+ a hint),
// where it lives (drive › folder), a time, a size and trailing actions. The row opens the
// item in its drive; on phones the location and time fold into a meta line.
import { basename, dirname } from '@volumes/shared';
import { cx } from '@/components/ui/cx';
import { FileIcon } from '@/components/ui/file-icon';
import { Bytes } from '@/components/versioning/readout';

export const CROSS_GRID =
  'grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_148px_88px_76px] items-center gap-x-3 pl-3 pr-2 max-[900px]:grid-cols-[minmax(0,1fr)_148px_88px_76px] max-[720px]:grid-cols-[minmax(0,1fr)_76px] max-[720px]:pr-1';

/** "My Drive › Projects/launch" (the drive alone at its top level). */
export function locationLabel(workspaceName: string, path: string): string {
  const folder = dirname(path);
  return folder === '/' ? workspaceName : `${workspaceName} › ${folder.slice(1)}`;
}

/** Column header of the cross-drive lists (Mono 11 uppercase, like the drive's). */
export function CrossHead({ when }: { when: string }) {
  return (
    <div className={cx(CROSS_GRID, 'vx-colhead h-9 border-b border-vx-hair max-[720px]:hidden')}>
      <span className="pl-8">Name</span>
      <span className="max-[900px]:hidden">Location</span>
      <span>{when}</span>
      <span className="text-right">Size</span>
      <span />
    </div>
  );
}

export function CrossDriveRow({
  item,
  when,
  hint,
  actions,
  onOpen,
  onContextMenu,
}: {
  item: { workspaceName: string; path: string; name: string; type: 'file' | 'dir'; size: number };
  /** The time column (a <When>). */
  when: React.ReactNode;
  /** A short note after the name, e.g. "Edited by you". */
  hint?: React.ReactNode;
  actions: React.ReactNode;
  onOpen: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const name = item.name || basename(item.path) || item.path;
  const where = locationLabel(item.workspaceName, item.path);
  return (
    <div
      role="listitem"
      className={cx(CROSS_GRID, 'group min-h-10 cursor-default border-b border-vx-hair-soft transition-colors duration-[120ms] ease-vx hover:bg-vx-raise focus-within:bg-vx-raise')}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
    >
      <span className="flex min-w-0 items-center gap-3 py-1.5">
        <FileIcon name={name} type={item.type} size={20} />
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-baseline gap-2">
            <button
              type="button"
              onClick={onOpen}
              title={`Open ${name} in ${item.workspaceName}`}
              className="vx-inset-focus min-w-0 truncate rounded-vx-xs text-left text-[14px] font-medium leading-5 text-vx-text-1 underline-offset-[3px] hover:underline"
            >
              {name}
            </button>
            {hint ? <span className="vx-meta shrink-0 text-vx-text-3 max-[720px]:hidden">{hint}</span> : null}
          </span>
          <span className="vx-meta truncate text-vx-text-3 min-[721px]:hidden">
            {hint ? <>{hint} · </> : null}
            {where}
          </span>
        </span>
      </span>
      <span className="vx-meta-row truncate text-vx-text-3 max-[900px]:hidden" title={item.path}>
        {where}
      </span>
      <span className="vx-meta-row truncate text-vx-text-3 max-[720px]:hidden">{when}</span>
      <span className="text-right max-[720px]:hidden">
        {item.type === 'dir' ? <span className="vx-meta-row text-vx-text-3">—</span> : <Bytes n={item.size} className="vx-meta-row text-vx-text-3" />}
      </span>
      <span className="flex items-center justify-end gap-0.5">{actions}</span>
    </div>
  );
}

/** Loading rows in the cross-drive lists' shape. */
export function CrossSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-10 items-center gap-4 border-b border-vx-hair-soft px-3">
          <span className="skeleton h-5 w-5" />
          <span className="skeleton skel-line w-48" />
          <span className="skeleton skel-line w-32 max-[720px]:hidden" />
        </div>
      ))}
    </div>
  );
}

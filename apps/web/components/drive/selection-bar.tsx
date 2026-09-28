'use client';

// Selection bar (DESIGN-v2 §5): a 44 px pill on the selection tint that replaces the column
// header while anything is selected: ✕ · "2 selected" + size · divider · Download, Move,
// Copy, Share*, Versions*, Delete, More (* single item only). In the past, write actions stay
// visible but disabled with the reason, and a single item offers Restore.
import { Clock, Copy, Download, FolderInput, MoreHorizontal, RotateCcw, Share2, Trash, X } from 'lucide-react';
import { formatBytes, type FileEntry } from '@volumes/shared';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { cx } from '@/components/ui/cx';
import type { DriveCommands } from './context-menu';
import { READ_ONLY_REASON } from './drive-context';
import s from './drive.module.css';

function Act({
  label,
  kbd,
  onClick,
  disabled,
  reason,
  className,
  children,
}: {
  label: string;
  kbd?: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  reason?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={disabled && reason ? reason : label} kbd={disabled ? undefined : kbd}>
      <IconButton
        size="sm"
        label={label}
        nativeTitle={false}
        disabled={disabled}
        onClick={onClick}
        className={cx('text-vx-on-selection hover:bg-vx-accent-wash hover:text-vx-on-accent-wash', className)}
      >
        {children}
      </IconButton>
    </Tooltip>
  );
}

const I = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const;

export default function SelectionBar({
  entries,
  total,
  past,
  cmd,
  onClear,
  onSelectAll,
  onMore,
  phone,
}: {
  entries: FileEntry[];
  total: number;
  past: boolean;
  cmd: DriveCommands;
  onClear: () => void;
  onSelectAll: () => void;
  onMore: (e: React.MouseEvent<HTMLButtonElement>) => void;
  phone?: boolean;
}) {
  const n = entries.length;
  const one = n === 1 ? entries[0] : null;
  const size = entries.reduce((sum, e) => sum + (e.type === 'file' ? e.size : 0), 0);
  return (
    <div
      role="toolbar"
      aria-label="Selection"
      className={cx(s.selIn, 'flex h-11 min-w-0 items-center gap-0.5 rounded-full bg-vx-selection pl-1.5 pr-2 text-vx-on-selection')}
    >
      <Act label="Clear selection" kbd="Esc" onClick={onClear}>
        <X {...I} />
      </Act>
      <span className="ml-1 mr-2 flex min-w-0 items-baseline gap-2 whitespace-nowrap">
        <span className="text-[14px] font-semibold leading-5">{n} selected</span>
        {size && !phone ? <span className="vx-meta truncate">{formatBytes(size)}</span> : null}
      </span>
      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-vx-hair-strong" />
      <Act label={one?.type === 'file' ? 'Download' : 'Download .zip'} kbd="D" onClick={() => cmd.download(entries)}>
        <Download {...I} />
      </Act>
      <Act label="Move to…" kbd="M" onClick={() => cmd.moveTo(entries)} disabled={past} reason={READ_ONLY_REASON}>
        <FolderInput {...I} />
      </Act>
      <Act label="Copy to…" kbd="⇧M" onClick={() => cmd.copyTo(entries)} disabled={past} reason={READ_ONLY_REASON} className="max-[420px]:hidden">
        <Copy {...I} />
      </Act>
      {one ? (
        <Act label={past ? 'Share pinned link…' : 'Share…'} kbd="S" onClick={() => cmd.share(one)}>
          <Share2 {...I} />
        </Act>
      ) : null}
      {one?.type === 'file' ? (
        <Act label="Versions" kbd="⇧H" onClick={() => cmd.versions(one)} className="max-[420px]:hidden">
          <Clock {...I} />
        </Act>
      ) : null}
      {past && one ? (
        <Act label="Restore this…" kbd="R" onClick={() => cmd.restore(one)} className="text-vx-past hover:bg-vx-past-wash hover:text-vx-past">
          <RotateCcw {...I} />
        </Act>
      ) : null}
      <Act
        label={n > 1 ? `Delete ${n} items` : 'Delete'}
        kbd="⌫"
        onClick={() => cmd.remove(entries)}
        disabled={past}
        reason={READ_ONLY_REASON}
        className="text-vx-del-fg hover:bg-vx-danger-wash hover:text-vx-del-fg"
      >
        <Trash {...I} />
      </Act>
      <Act label="More actions" onClick={onMore}>
        <MoreHorizontal {...I} />
      </Act>
      <span className="min-w-0 flex-1" />
      {!phone && n < total ? (
        <button
          type="button"
          onClick={onSelectAll}
          className="hidden h-8 shrink-0 items-center rounded-vx-sm px-3 text-[13px] font-medium text-vx-accent transition-colors duration-[120ms] hover:bg-vx-accent-wash min-[900px]:inline-flex"
        >
          Select all {total.toLocaleString()}
        </button>
      ) : null}
    </div>
  );
}

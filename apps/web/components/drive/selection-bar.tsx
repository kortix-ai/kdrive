'use client';

// Selection bar (UNIFY-SPEC §14.2): a 40 px r4 bar on `--vx-raise` with a 1 px hair-strong
// edge that replaces the column header while anything is selected: ✕ · "2 selected" + size · divider · Download, Move,
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
  tone,
  children,
}: {
  tone?: 'past' | 'danger';
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
        className={cx(
          tone === 'past' ? '!text-vx-past hover:!bg-vx-past-wash' : tone === 'danger' ? '!text-vx-danger hover:!bg-vx-danger-wash' : 'hover:!bg-vx-pressed',
          className,
        )}
      >
        {children}
      </IconButton>
    </Tooltip>
  );
}

const I = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;

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
      className={cx(s.selIn, 'flex h-10 min-w-0 items-center gap-0.5 rounded-vx-sm border border-vx-hair-strong bg-vx-raise pl-1.5 pr-1.5 text-vx-text-1')}
    >
      <Act label="Clear selection" kbd="Esc" onClick={onClear}>
        <X {...I} />
      </Act>
      <span className="ml-1 mr-2 flex min-w-0 items-baseline gap-2 whitespace-nowrap">
        <span className="text-[14px] font-semibold leading-5">{n} selected</span>
        {size && !phone ? <span className="vx-meta truncate text-vx-text-3">{formatBytes(size)}</span> : null}
      </span>
      <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-vx-hair-strong" />
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
        <Act label="Restore this…" kbd="R" onClick={() => cmd.restore(one)} tone="past">
          <RotateCcw {...I} />
        </Act>
      ) : null}
      <Act
        label={n > 1 ? `Delete ${n} items` : 'Delete'}
        kbd="⌫"
        onClick={() => cmd.remove(entries)}
        disabled={past}
        reason={READ_ONLY_REASON}
        tone="danger"
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
          className="hidden h-7 shrink-0 items-center rounded-vx-sm px-2.5 text-[13px] font-medium text-vx-text-1 underline-offset-[3px] transition-colors duration-[120ms] hover:bg-vx-pressed min-[900px]:inline-flex"
        >
          Select all {total.toLocaleString()}
        </button>
      ) : null}
    </div>
  );
}

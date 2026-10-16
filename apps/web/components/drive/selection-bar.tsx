'use client';

// Selection bar (UNIFY-SPEC §14.2): a 44 px r12 float bar with a 1 px hair-strong
// edge that floats over the top of the list while anything is selected: ✕ · "2 selected" + size · divider · Download, Move,
// Copy, Star, Share*, Versions*, Delete, More (* single item only). In the past, write actions stay
// visible but disabled with the reason, and a single item offers Restore.
import { Clock, Copy, Download, FolderInput, MoreHorizontal, RotateCcw, Share2, Star, Tag, Trash, X } from 'lucide-react';
import { formatBytes, type FileEntry } from '@volumes/shared';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { cx } from '@/components/ui/cx';
import type { DriveCommands } from './context-menu';
import { useDriveStars } from '@/lib/drive/stars';
import { currentRole, useVx, VIEW_ONLY_REASON } from '@/lib/store';
import { READ_ONLY_REASON } from './drive-context';
import s from './drive.module.css';

function Act({
  label,
  pressed,
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
  /** A toggle that is on (e.g. every selected item is starred). */
  pressed?: boolean;
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
        aria-pressed={pressed}
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
  // Writes are off in the past and for a viewer of someone else's drive.
  const viewOnly = useVx((st) => currentRole(st) === 'viewer');
  const locked = past || viewOnly;
  const reason = viewOnly ? VIEW_ONLY_REASON : READ_ONLY_REASON;
  const n = entries.length;
  const one = n === 1 ? entries[0] : null;
  const size = entries.reduce((sum, e) => sum + (e.type === 'file' ? e.size : 0), 0);
  const starred = useDriveStars();
  const allStarred = n > 0 && entries.every((e) => starred.has(e.path));
  return (
    <div
      role="toolbar"
      aria-label="Selection"
      className={cx(s.selIn, 'flex h-11 min-w-0 items-center gap-0.5 rounded-vx-md border border-vx-hair-strong bg-vx-float pl-1.5 pr-1.5 text-vx-text-1')}
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
      <Act label="Move to…" kbd="M" onClick={() => cmd.moveTo(entries)} disabled={locked} reason={reason}>
        <FolderInput {...I} />
      </Act>
      <Act label="Copy to…" kbd="⇧M" onClick={() => cmd.copyTo(entries)} disabled={locked} reason={reason} className="max-[420px]:hidden">
        <Copy {...I} />
      </Act>
      {past ? null : (
        <Act label={allStarred ? 'Remove from Starred' : 'Add to Starred'} kbd="S" pressed={allStarred} onClick={() => cmd.star(entries)}>
          <Star {...I} fill={allStarred ? 'currentColor' : 'none'} />
        </Act>
      )}
      {one ? (
        <Act label={past ? 'Share pinned link…' : 'Share…'} kbd="⇧S" onClick={() => cmd.share(one)} disabled={viewOnly} reason={VIEW_ONLY_REASON}>
          <Share2 {...I} />
        </Act>
      ) : null}
      {cmd.tags && !past ? (
        <Act
          label="Tags…"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            cmd.tags!(entries, { x: r.left, y: r.bottom + 4, flipY: r.top - 4 });
          }}
          disabled={viewOnly}
          reason={VIEW_ONLY_REASON}
          className="max-[420px]:hidden"
        >
          <Tag {...I} />
        </Act>
      ) : null}
      {one?.type === 'file' ? (
        <Act label="Versions" kbd="⇧H" onClick={() => cmd.versions(one)} className="max-[420px]:hidden">
          <Clock {...I} />
        </Act>
      ) : null}
      {past && one ? (
        <Act label="Restore this…" kbd="R" onClick={() => cmd.restore(one)} tone="past" disabled={viewOnly} reason={VIEW_ONLY_REASON}>
          <RotateCcw {...I} />
        </Act>
      ) : null}
      <Act
        label={n > 1 ? `Delete ${n} items` : 'Delete'}
        kbd="⌫"
        onClick={() => cmd.remove(entries)}
        disabled={locked}
        reason={reason}
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

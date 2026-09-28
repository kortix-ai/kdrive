'use client';

// One list row (DESIGN-v2 §5 File row, §6.2, §7): 40 px, r8, grid `--vx-list-cols`
// (checkbox · icon + name · modified · size · actions). At rest a row shows only its icon,
// name, date and size; the checkbox and the actions (Download · Share · Versions · More)
// appear on hover, focus or selection. With compact columns (panel or rail open) the
// actions overlay the row end and cover the date entirely. Phones get 60 px rows with a
// meta line and a ⋮ button. States: hover, selected, focused, renaming, pending,
// collapsing, dragging, drop target, past drift chips, gone-now, ghost.
import { memo } from 'react';
import { ChevronRight, Clock, Download, MoreHorizontal, MoreVertical, Share2 } from 'lucide-react';
import { formatBytes, type FileEntry } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FileIcon } from '@/components/ui/file-icon';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { cx } from '@/components/ui/cx';
import { formatRelative, isoTitle } from '@/lib/format';
import type { Drift } from '@/lib/drive/drift';
import { useDriveCtx, type DriveCtxValue } from './drive-context';
import { RenameInput } from './rename-dialog';
import s from './drive.module.css';

/** Columns come from CSS (`--vx-list-cols` / `--vx-list-cols-compact`). */
export const LIST_COLS = 'var(--vx-list-cols)';
export const LIST_COLS_COMPACT = 'var(--vx-list-cols-compact)';
export const ROW_H = 40;
export const PHONE_ROW_H = 60;
/** Rows sit 8 px in from the sheet edges so hover pills never touch it. */
export const LIST_INSET = 8;

export function listCols(density: DriveCtxValue['density']): string {
  return density === 'wide' ? LIST_COLS : LIST_COLS_COMPACT;
}

/** "8 Dec 2025 08:57" → "8 Dec 2025", "Yesterday, 18:02" → "Yesterday"; short forms unchanged. */
export function compactDate(s: string): string {
  return s.length > 12 ? s.replace(/,?\s+\d{1,2}:\d{2}$/, '') : s;
}

/** Middle truncation that keeps the extension: `quarterly-rep…final.pdf`. */
export function MiddleName({ name, className }: { name: string; className?: string }) {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';
  const stem = ext ? name.slice(0, dot) : name;
  const tailLen = Math.min(6, Math.max(0, stem.length - 4));
  const head = stem.slice(0, stem.length - tailLen);
  const tail = stem.slice(stem.length - tailLen) + ext;
  return (
    <span className={cx('flex min-w-0', className)} title={name}>
      {/* whitespace-pre: a space at the split (e.g. "Volumes launch") must not collapse. */}
      <span className="overflow-hidden text-ellipsis whitespace-pre">{head}</span>
      <span className="shrink-0 whitespace-pre">{tail}</span>
    </span>
  );
}

/** Row / card checkbox: never starts a drag, a marquee or a row click. */
export function RowCheck({ on, indeterminate, onToggle, label, className }: { on: boolean; indeterminate?: boolean; onToggle?: () => void; label: string; className?: string }) {
  return (
    <span
      className={cx('inline-flex', className)}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <Checkbox checked={on} indeterminate={indeterminate} onChange={() => onToggle?.()} label={label} tabIndex={-1} />
    </span>
  );
}

/** Drift chip (DESIGN-v2 §5): 22 px pill, 12/500, a 6 px dot. */
export function DriftChip({ drift, className }: { drift: Drift | 'ghost'; className?: string }) {
  return (
    <span
      className={cx(
        s.fadeIn,
        'inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[12px] font-medium leading-4',
        drift === 'changed' && 'bg-vx-surface-3 text-vx-text-2',
        drift === 'gone' && 'bg-vx-danger-wash text-vx-del-fg',
        drift === 'ghost' && 'border border-dashed border-vx-hair-dash text-vx-text-4',
        className,
      )}
    >
      {drift !== 'ghost' ? <span aria-hidden className={cx('h-1.5 w-1.5 shrink-0 rounded-full', drift === 'gone' ? 'bg-vx-danger' : 'bg-vx-tick')} /> : null}
      {drift === 'changed' ? 'Changed since' : drift === 'gone' ? 'Gone now' : 'Not here yet'}
    </span>
  );
}

/** The inline `restore` sm button of a gone-now item (shown on hover or focus). */
export function GoneRestore({ entry, className }: { entry: FileEntry; className?: string }) {
  const ctx = useDriveCtx();
  return (
    <Button
      size="xs"
      variant="restore"
      aria-label={`Restore ${entry.name}`}
      tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        ctx.onRestore(entry);
      }}
      className={cx(s.reveal, className)}
    >
      Restore
    </Button>
  );
}

const stop = {
  onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
  onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
};

/** Hover actions: Download · Share · Versions (files) · More. 32 px icon buttons. */
export function RowActions({ entry, className }: { entry: FileEntry; className?: string }) {
  const ctx = useDriveCtx();
  const isFile = entry.type === 'file';
  const btn = 'group-aria-selected:text-vx-on-selection';
  return (
    <span className={cx('flex items-center justify-end', className)}>
      <Tooltip label={isFile ? 'Download' : 'Download .zip'} kbd="D">
        <IconButton size="sm" label={isFile ? `Download ${entry.name}` : `Download ${entry.name} as .zip`} nativeTitle={false} tabIndex={-1} className={btn} {...stop} onClick={(e) => { e.stopPropagation(); ctx.cmd.download([entry]); }}>
          <Download size={18} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </Tooltip>
      <Tooltip label={ctx.past ? 'Share pinned link' : 'Share'} kbd="S">
        <IconButton size="sm" label={`Share ${entry.name}`} nativeTitle={false} tabIndex={-1} className={btn} {...stop} onClick={(e) => { e.stopPropagation(); ctx.cmd.share(entry); }}>
          <Share2 size={18} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </Tooltip>
      {isFile ? (
        <Tooltip label="Versions" kbd="⇧H">
          <IconButton size="sm" label={`Versions of ${entry.name}`} nativeTitle={false} tabIndex={-1} className={btn} {...stop} onClick={(e) => { e.stopPropagation(); ctx.cmd.versions(entry); }}>
            <Clock size={18} strokeWidth={1.75} aria-hidden />
          </IconButton>
        </Tooltip>
      ) : (
        <span className="w-8 shrink-0" aria-hidden />
      )}
      <Tooltip label="More actions">
        <IconButton size="sm" label={`Actions for ${entry.name}`} nativeTitle={false} tabIndex={-1} className={btn} {...stop} onClick={(e) => { e.stopPropagation(); ctx.onMenuButton(e, entry); }}>
          <MoreHorizontal size={18} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </Tooltip>
    </span>
  );
}

/** Shared visual state of a row or card. */
export function itemTone(o: { selected: boolean; focused: boolean; dropTarget: boolean; dragging: boolean }) {
  return cx(
    o.dropTarget
      ? 'bg-vx-accent-wash text-vx-on-accent-wash shadow-[inset_0_0_0_2px_var(--vx-accent-edge)]'
      : o.selected
        ? 'bg-vx-selection text-vx-on-selection'
        : 'hover:bg-vx-hover',
    o.focused && !o.dropTarget && 'shadow-[inset_0_0_0_2px_var(--vx-accent-edge)]',
    o.dragging && 'opacity-40',
  );
}

function FileRowImpl({ entry, style }: { entry: FileEntry; style?: React.CSSProperties }) {
  const ctx = useDriveCtx();
  const selected = ctx.selection.has(entry.path);
  const focused = ctx.focus === entry.path;
  const drift = ctx.drift?.get(entry.path);
  const pending = ctx.pending[entry.path];
  const removing = !!ctx.removing[entry.path];
  const dragging = ctx.dragging.has(entry.path);
  const isDir = entry.type === 'dir';
  const dropTarget = ctx.dropDir === entry.path;
  const renaming = ctx.renaming === entry.path;
  const phone = ctx.density === 'phone';
  const meta = selected ? 'text-vx-on-selection' : 'text-vx-text-3';
  const modified = entry.mtime ? formatRelative(entry.mtime) : '—';
  // Compact columns are 120 px: drop a trailing time at the date boundary ("8 Dec 2025 08:57"
  // → "8 Dec 2025") instead of clipping mid-string. The full stamp stays in the tooltip.
  const modifiedShown = ctx.density === 'compact' ? compactDate(modified) : modified;

  const name = renaming ? (
    <RenameInput entry={entry} siblings={ctx.siblings} onSubmit={(n) => ctx.onRenameSubmit(entry, n)} onCancel={ctx.onRenameCancel} />
  ) : (
    <MiddleName
      name={entry.name}
      className={cx(phone ? 'text-[15px] leading-5' : 'text-[14px] leading-5', 'font-medium', selected ? 'text-vx-on-selection' : drift === 'gone' ? 'text-vx-text-2' : 'text-vx-text-1')}
    />
  );

  const extras = (
    <>
      {drift && !renaming ? <DriftChip drift={drift} /> : null}
      {pending === 'waiting' ? <span className={cx('vx-meta shrink-0', meta)}>Waiting for a free slot</span> : null}
      {drift === 'gone' && !phone ? <GoneRestore entry={entry} className="shrink-0" /> : null}
    </>
  );

  const common = {
    role: 'option' as const,
    'aria-selected': selected,
    'data-focused': focused || undefined,
    id: `vx-row-${encodeURIComponent(entry.path)}`,
    'data-path': entry.path,
    'data-vx-drop-dir': isDir && !ctx.past ? entry.path : undefined,
    draggable: !ctx.past && !renaming && !pending,
    onMouseDown: (e: React.MouseEvent) => ctx.onItemMouseDown(e, entry),
    onClick: (e: React.MouseEvent) => ctx.onItemClick(e, entry),
    onDoubleClick: () => ctx.onOpen(entry),
    onContextMenu: (e: React.MouseEvent) => ctx.onContextMenu(e, entry),
    onDragStart: (e: React.DragEvent) => ctx.onDragStart(e, entry),
    onDragEnd: ctx.onDragEnd,
    onDragOver: isDir ? (e: React.DragEvent) => ctx.onFolderDragOver(e, entry) : undefined,
    onDragLeave: isDir ? (e: React.DragEvent) => ctx.onFolderDragLeave(e, entry) : undefined,
    onDrop: isDir ? (e: React.DragEvent) => ctx.onFolderDrop(e, entry) : undefined,
  };
  const frame = cx(
    s.item,
    'group relative grid cursor-default select-none items-center rounded-vx-sm transition-colors duration-[120ms] ease-vx',
    itemTone({ selected, focused, dropTarget, dragging }),
    removing && s.removing,
  );

  if (phone) {
    const withCheck = ctx.anySelected;
    return (
      <div
        {...common}
        style={{ ...style, gridTemplateColumns: withCheck ? '36px 40px minmax(0,1fr) 44px' : '40px minmax(0,1fr) 44px' }}
        className={cx(frame, 'pl-2')}
      >
        {withCheck ? (
          <span className="flex items-center justify-center">
            <RowCheck on={selected} onToggle={() => ctx.onCheck(entry)} label={`Select ${entry.name}`} />
          </span>
        ) : null}
        <FileIcon name={entry.name} type={entry.type} size={28} />
        <span className="flex min-w-0 flex-col gap-0.5 pr-1">
          <span className="flex min-w-0 items-center gap-2">{name}</span>
          <span className={cx('flex min-w-0 items-center gap-2 text-[13px] leading-[18px] tabular-nums', meta)}>
            {drift && !renaming ? (
              <DriftChip drift={drift} />
            ) : (
              <span className="truncate" title={isoTitle(entry.mtime)}>
                Modified {modified}
                {isDir ? '' : ` · ${formatBytes(entry.size)}`}
              </span>
            )}
          </span>
        </span>
        <IconButton
          size="md"
          label={`Actions for ${entry.name}`}
          tabIndex={-1}
          className="group-aria-selected:text-vx-on-selection"
          {...stop}
          onClick={(e) => {
            e.stopPropagation();
            ctx.onMenuButton(e, entry);
          }}
        >
          <MoreVertical size={20} strokeWidth={1.75} aria-hidden />
        </IconButton>
        {pending && pending !== 'delete' ? <span className={s.pendingLine} aria-hidden /> : null}
      </div>
    );
  }

  const wide = ctx.density === 'wide';
  return (
    <div {...common} style={{ ...style, gridTemplateColumns: listCols(ctx.density) }} className={cx(frame, wide ? 'pr-1' : 'pr-2')}>
      <span className="flex items-center justify-center">
        <RowCheck on={selected} onToggle={() => ctx.onCheck(entry)} label={`Select ${entry.name}`} className={cx(!selected && s.reveal, s.revealCheck)} />
      </span>
      <span className="flex min-w-0 items-center gap-3 pr-4">
        <FileIcon name={entry.name} type={entry.type} size={24} />
        {name}
        {extras}
      </span>
      <span className={cx('vx-col-mtime vx-meta-row truncate pr-3', meta)} title={isoTitle(entry.mtime)}>
        {modifiedShown}
      </span>
      <span className={cx('vx-meta-row truncate pr-2 text-right', meta)}>{isDir ? '—' : formatBytes(entry.size)}</span>
      {wide ? (
        <RowActions entry={entry} className={s.reveal} />
      ) : (
        <span className={cx(s.actsOverlay, s.reveal)}>
          <RowActions entry={entry} />
        </span>
      )}
      {pending && pending !== 'delete' ? <span className={s.pendingLine} aria-hidden /> : null}
    </div>
  );
}

/** "4.2 MB" (units are not dimmed any more). */
export function Bytes({ n }: { n: number }) {
  return <>{formatBytes(n)}</>;
}

export const FileRow = memo(FileRowImpl);

/** An item that exists now but not at the viewed version: text-4 + `Not here yet`. */
export function GhostRow({ entry, style }: { entry: FileEntry; style?: React.CSSProperties }) {
  const ctx = useDriveCtx();
  const phone = ctx.density === 'phone';
  return (
    <div
      style={{ ...style, gridTemplateColumns: phone ? '40px minmax(0,1fr) 44px' : listCols(ctx.density) }}
      className={cx('grid items-center rounded-vx-sm text-vx-text-4', phone ? 'pl-2' : 'pr-2')}
      aria-disabled
    >
      {phone ? null : <span />}
      <span className={cx('flex min-w-0 items-center gap-3', !phone && 'pr-4')}>
        <FileIcon name={entry.name} type={entry.type} size={phone ? 28 : 24} muted />
        {phone ? null : <MiddleName name={entry.name} className="text-[14px] font-medium leading-5" />}
        {phone ? null : <DriftChip drift="ghost" />}
      </span>
      {phone ? (
        <span className="flex min-w-0 flex-col gap-0.5">
          <MiddleName name={entry.name} className="text-[15px] font-medium leading-5" />
          <DriftChip drift="ghost" className="self-start" />
        </span>
      ) : (
        <>
          <span className="vx-col-mtime vx-meta-row truncate pr-3">{entry.mtime ? compactDate(formatRelative(entry.mtime)) : '—'}</span>
          <span className="vx-meta-row truncate pr-2 text-right">{entry.type === 'dir' ? '—' : formatBytes(entry.size)}</span>
        </>
      )}
      <span />
    </div>
  );
}

/** "+ 2 items added later · sunset.png, app.config.json ›": the dashed row that expands ghost rows. */
export function AddedLaterFooter({
  count,
  names = [],
  open,
  onToggle,
  style,
}: {
  count: number;
  names?: string[];
  open: boolean;
  onToggle: () => void;
  style?: React.CSSProperties;
}) {
  const shown = names.slice(0, 3);
  return (
    <button
      type="button"
      style={style}
      onClick={onToggle}
      aria-expanded={open}
      className="vx-inset-focus flex h-10 w-full min-w-0 items-center gap-2 rounded-vx-sm border border-dashed border-vx-hair-dash px-4 text-left text-[13px] leading-5 text-vx-text-3 transition-colors duration-[120ms] hover:bg-vx-hover hover:text-vx-text-1"
    >
      <span className="shrink-0 font-medium text-vx-text-2">
        + {count} {count === 1 ? 'item' : 'items'} added later
      </span>
      {shown.length ? (
        <span className="min-w-0 truncate text-vx-text-4">
          · {shown.join(', ')}
          {names.length > shown.length ? ', …' : ''}
        </span>
      ) : null}
      <ChevronRight
        size={16}
        strokeWidth={1.75}
        aria-hidden
        className={cx('ml-auto shrink-0 text-vx-text-3 transition-transform duration-[160ms] ease-vx', open && 'rotate-90')}
      />
    </button>
  );
}

export default FileRow;

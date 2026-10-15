'use client';

// Grid cards (UNIFY-SPEC §12.1, §14.2; DESIGN-v2 §6.2). File card: r6 on `--vx-surface-2`
// with a 1 px hair, a 6 px inset, a 40 px head (type icon that swaps to the checkbox on hover,
// name, ☆, ⋮), a 4:3 r4 mat and a Mono `size · modified` caption. Folder card: 44 px, r6, hair,
// outline folder + name + ☆ + ⋮. The star shows on hover, and stays (filled) while starred. Same states as rows; past mode filters thumbnails.
import { memo } from 'react';
import { MoreVertical } from 'lucide-react';
import { formatBytes, type FileEntry } from '@volumes/shared';
import { FileIcon } from '@/components/ui/file-icon';
import { IconButton } from '@/components/ui/icon-button';
import { cx } from '@/components/ui/cx';
import { CAPTION_H, FOLDER_TILE_H, HEAD_H } from '@/lib/drive/layout';
import { formatRelative, isoTitle } from '@/lib/format';
import { useDriveCtx } from './drive-context';
import { DriftChip, GoneRestore, MiddleName, RowCheck, StarButton, itemTone } from './file-row';
import { RenameInput } from './rename-dialog';
import Thumbnail from './thumbnail';
import s from './drive.module.css';

export { CAPTION_H, FOLDER_TILE_H };

function useItemState(entry: FileEntry) {
  const ctx = useDriveCtx();
  return {
    ctx,
    selected: ctx.selection.has(entry.path),
    focused: ctx.focus === entry.path,
    drift: ctx.drift?.get(entry.path),
    pending: ctx.pending[entry.path],
    removing: !!ctx.removing[entry.path],
    dragging: ctx.dragging.has(entry.path),
    dropTarget: ctx.dropDir === entry.path,
    renaming: ctx.renaming === entry.path,
  };
}

function itemProps(ctx: ReturnType<typeof useDriveCtx>, entry: FileEntry, renaming: boolean, pending: unknown, focused: boolean) {
  const isDir = entry.type === 'dir';
  return {
    role: 'option' as const,
    'data-path': entry.path,
    'data-focused': focused || undefined,
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
}

function cardTone(st: ReturnType<typeof useItemState>) {
  const { selected, focused, dropTarget, dragging, removing } = st;
  return cx(
    s.item,
    'group relative cursor-default select-none rounded-vx-md border transition-[background-color,border-color,box-shadow] duration-[120ms] ease-vx',
    !selected && !dropTarget && 'border-vx-hair bg-vx-surface-2 hover:border-vx-hair-strong',
    selected && !dropTarget && 'border-vx-accent-edge',
    dropTarget && 'border-transparent',
    itemTone({ selected, focused, dropTarget, dragging }),
    removing && s.removing,
  );
}

/** The card's star toggle: revealed on hover like the ⋮, always shown while starred (now only). */
function CardStar({ entry }: { entry: FileEntry }) {
  const ctx = useDriveCtx();
  if (ctx.past) return null;
  const on = ctx.starred.has(entry.path);
  return <StarButton entry={entry} className={cx(!on && s.reveal, 'group-aria-selected:text-vx-on-selection')} />;
}

function MenuDots({ entry }: { entry: FileEntry }) {
  const ctx = useDriveCtx();
  return (
    <IconButton
      size="sm"
      label={`Actions for ${entry.name}`}
      tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        ctx.onMenuButton(e, entry);
      }}
      className={cx(s.reveal, 'group-aria-selected:text-vx-on-selection')}
    >
      <MoreVertical size={16} strokeWidth={1.75} aria-hidden />
    </IconButton>
  );
}

/** Type icon that becomes the checkbox on hover, focus or selection. */
function IconOrCheck({ entry, selected, size = 20 }: { entry: FileEntry; selected: boolean; size?: number }) {
  const ctx = useDriveCtx();
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <span className={s.swapIcon}>
        <FileIcon name={entry.name} type={entry.type} size={size} />
      </span>
      <RowCheck
        on={selected}
        onToggle={() => ctx.onCheck(entry)}
        label={`Select ${entry.name}`}
        className={cx('absolute inset-0 items-center justify-center', !selected && s.reveal, s.revealCheck)}
      />
    </span>
  );
}

function FileTileImpl({ entry, style }: { entry: FileEntry; style?: React.CSSProperties }) {
  const st = useItemState(entry);
  const { ctx, selected, focused, drift, pending, renaming } = st;
  return (
    <div {...itemProps(ctx, entry, renaming, pending, focused)} aria-selected={selected} style={style} className={cx(cardTone(st), 'flex flex-col px-1.5')}>
      <div className="flex shrink-0 items-center gap-2.5 pl-2" style={{ height: HEAD_H }}>
        <IconOrCheck entry={entry} selected={selected} />
        <span className="flex min-w-0 flex-1 items-center">
          {renaming ? (
            <RenameInput entry={entry} siblings={ctx.siblings} onSubmit={(n) => ctx.onRenameSubmit(entry, n)} onCancel={ctx.onRenameCancel} />
          ) : (
            <MiddleName name={entry.name} className={cx('text-[14px] font-medium leading-5', selected ? 'text-vx-on-selection' : 'text-vx-text-1')} />
          )}
        </span>
        <CardStar entry={entry} />
        <MenuDots entry={entry} />
      </div>
      <Thumbnail ws={ctx.ws} entry={entry} at={ctx.at} past={ctx.past}>
        {drift ? (
          <span className="absolute left-2 top-2">
            <DriftChip drift={drift} className={drift === 'changed' ? '!bg-vx-float shadow-vx-1' : 'shadow-vx-1'} />
          </span>
        ) : null}
        {drift === 'gone' ? <GoneRestore entry={entry} className="absolute bottom-2 right-2 shadow-vx-1" /> : null}
      </Thumbnail>
      <div
        className={cx('vx-meta flex shrink-0 items-center gap-1.5 px-1', selected ? 'text-vx-on-selection' : 'text-vx-text-3')}
        style={{ height: CAPTION_H }}
        title={isoTitle(entry.mtime)}
      >
        <span className="shrink-0">{formatBytes(entry.size)}</span>
        <span aria-hidden>·</span>
        <span className="min-w-0 truncate">{entry.mtime ? formatRelative(entry.mtime) : '—'}</span>
      </div>
      {pending && pending !== 'delete' ? <span className={s.pendingLine} aria-hidden /> : null}
    </div>
  );
}

function FolderTileImpl({ entry, style }: { entry: FileEntry; style?: React.CSSProperties }) {
  const st = useItemState(entry);
  const { ctx, selected, focused, drift, pending, dropTarget, renaming } = st;
  const moving = ctx.dragging.size;
  return (
    <div
      {...itemProps(ctx, entry, renaming, pending, focused)}
      aria-selected={selected}
      style={{ ...style, height: FOLDER_TILE_H }}
      className={cx(cardTone(st), 'flex items-center gap-2.5 pl-3 pr-1')}
      title={isoTitle(entry.mtime)}
    >
      <IconOrCheck entry={entry} selected={selected} />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {renaming ? (
          <RenameInput entry={entry} siblings={ctx.siblings} onSubmit={(n) => ctx.onRenameSubmit(entry, n)} onCancel={ctx.onRenameCancel} />
        ) : (
          <MiddleName name={entry.name} className={cx('text-[14px] font-medium leading-5', selected ? 'text-vx-on-selection' : 'text-vx-text-1')} />
        )}
        {drift && !renaming ? <DriftChip drift={drift} /> : null}
      </div>
      {drift === 'gone' ? <GoneRestore entry={entry} className="shrink-0" /> : null}
      <CardStar entry={entry} />
      <MenuDots entry={entry} />
      {dropTarget && moving ? (
        <span
          role="status"
          className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-vx-sm bg-vx-inverse px-2 py-[5px] text-[12px] leading-4 text-vx-on-inverse shadow-vx-3"
        >
          Drop to move {moving === 1 ? '1 item' : `${moving} items`} into {entry.name}
        </span>
      ) : null}
      {pending && pending !== 'delete' ? <span className={s.pendingLine} aria-hidden /> : null}
    </div>
  );
}

export function GhostTile({ entry, style }: { entry: FileEntry; style?: React.CSSProperties }) {
  const isDir = entry.type === 'dir';
  return (
    <div
      style={{ ...style, ...(isDir ? { height: FOLDER_TILE_H } : {}) }}
      className="flex flex-col rounded-vx-md border border-dashed border-vx-hair-dash px-1.5 text-vx-text-4"
      aria-disabled
    >
      {isDir ? (
        <div className="flex h-full items-center gap-2.5 pl-1.5">
          <FileIcon name={entry.name} type="dir" size={20} muted />
          <MiddleName name={entry.name} className="min-w-0 flex-1 text-[14px] font-medium leading-5" />
          <DriftChip drift="ghost" className="mr-1" />
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2.5 pl-2" style={{ height: HEAD_H }}>
            <FileIcon name={entry.name} type={entry.type} size={20} muted />
            <MiddleName name={entry.name} className="min-w-0 flex-1 text-[14px] font-medium leading-5" />
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center rounded-vx-sm">
            <FileIcon name={entry.name} type={entry.type} size={48} muted />
          </div>
          <div className="flex shrink-0 items-center px-1.5" style={{ height: CAPTION_H }}>
            <DriftChip drift="ghost" />
          </div>
        </>
      )}
    </div>
  );
}

export const FileTile = memo(FileTileImpl);
export const FolderTile = memo(FolderTileImpl);
export default FileTile;

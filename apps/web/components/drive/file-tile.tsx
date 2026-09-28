'use client';

// Grid tiles (DESIGN §6.2): files on a 4:3 mat with a 44 px caption; folders as
// 64 px compact tiles. Same states as rows; past mode filters thumbnails.
import { memo } from 'react';
import { Folder, MoreHorizontal } from 'lucide-react';
import { formatBytes, type FileEntry } from '@volumes/shared';
import { FileIcon } from '@/components/ui/file-icon';
import { cx } from '@/components/ui/cx';
import { CAPTION_H, FOLDER_TILE_H } from '@/lib/drive/layout';
import { formatRelative, isoTitle } from '@/lib/format';
import { useDriveCtx } from './drive-context';
import { Check, DriftChip, MiddleName } from './file-row';
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

function itemProps(ctx: ReturnType<typeof useDriveCtx>, entry: FileEntry, renaming: boolean, pending: unknown) {
  const isDir = entry.type === 'dir';
  return {
    role: 'option' as const,
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
}

function MenuDots({ entry }: { entry: FileEntry }) {
  const ctx = useDriveCtx();
  return (
    <button
      type="button"
      aria-label={`Actions for ${entry.name}`}
      tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        ctx.onMenuButton(e, entry);
      }}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-vx-text-3 opacity-0 transition-opacity duration-[120ms] hover:bg-vx-surface-3 hover:text-vx-text-1 group-hover:opacity-100"
    >
      <MoreHorizontal size={14} aria-hidden />
    </button>
  );
}

function FileTileImpl({ entry, style }: { entry: FileEntry; style?: React.CSSProperties }) {
  const st = useItemState(entry);
  const { ctx, selected, focused, drift, pending, removing, dragging, dropTarget, renaming } = st;
  return (
    <div
      {...itemProps(ctx, entry, renaming, pending)}
      aria-selected={selected}
      style={style}
      className={cx(
        'group relative flex cursor-default select-none flex-col border bg-vx-bg transition-colors duration-[120ms]',
        selected ? 'border-vx-accent-edge shadow-[inset_0_0_0_1px_var(--vx-accent-edge)]' : 'border-vx-hair hover:border-vx-hair-strong',
        focused && !dropTarget && 'outline outline-1 outline-offset-1 outline-[var(--vx-accent-edge)]',
        dropTarget && 'outline-dashed outline-1 outline-offset-1 outline-[var(--vx-accent-edge)]',
        dragging && 'opacity-40',
        removing && s.removing,
      )}
    >
      <div className="relative">
        <Thumbnail ws={ctx.ws} entry={entry} at={ctx.at} past={ctx.past} />
        <span className="absolute left-2 top-2">
          <Check on={selected} visible={selected} onToggle={() => ctx.onCheck(entry)} label={`Select ${entry.name}`} />
        </span>
        {drift ? (
          <span className="absolute right-2 top-2 bg-vx-float">
            <DriftChip drift={drift} />
          </span>
        ) : null}
        {drift === 'gone' ? (
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              ctx.onRestore(entry);
            }}
            className="vx-ui absolute bottom-2 right-2 inline-flex h-6 items-center gap-1 border border-vx-past bg-vx-float px-2 text-vx-past opacity-0 transition-opacity duration-[120ms] hover:bg-vx-past-wash focus-visible:opacity-100 group-hover:opacity-100"
          >
            <span aria-hidden>↺</span> Restore
          </button>
        ) : null}
      </div>
      <div className={cx('flex items-center gap-1 border-t border-vx-hair px-2.5', selected && 'bg-vx-accent-wash')} style={{ height: CAPTION_H }}>
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          {renaming ? (
            <RenameInput entry={entry} siblings={ctx.siblings} onSubmit={(n) => ctx.onRenameSubmit(entry, n)} onCancel={ctx.onRenameCancel} />
          ) : (
            <MiddleName name={entry.name} className="vx-name text-vx-text-1" />
          )}
          <span className="vx-meta truncate text-vx-text-3" title={isoTitle(entry.mtime)}>
            {formatBytes(entry.size)} <span className="vx-unit">·</span> {entry.mtime ? formatRelative(entry.mtime) : '—'}
          </span>
        </div>
        <MenuDots entry={entry} />
      </div>
      {pending && pending !== 'delete' ? <span className={s.pendingLine} aria-hidden /> : null}
    </div>
  );
}

function FolderTileImpl({ entry, style }: { entry: FileEntry; style?: React.CSSProperties }) {
  const st = useItemState(entry);
  const { ctx, selected, focused, drift, pending, removing, dragging, dropTarget, renaming } = st;
  return (
    <div
      {...itemProps(ctx, entry, renaming, pending)}
      aria-selected={selected}
      style={{ ...style, height: FOLDER_TILE_H }}
      className={cx(
        'group relative flex cursor-default select-none items-center gap-3 border px-3 transition-colors duration-[120ms]',
        selected ? 'border-vx-accent-edge bg-vx-accent-wash' : 'border-vx-hair bg-vx-bg hover:border-vx-hair-strong hover:bg-vx-surface-2',
        focused && !dropTarget && 'outline outline-1 outline-offset-1 outline-[var(--vx-accent-edge)]',
        dropTarget && 'outline-dashed outline-1 outline-offset-1 outline-[var(--vx-accent-edge)]',
        dragging && 'opacity-40',
        removing && s.removing,
      )}
    >
      <span className="relative shrink-0">
        <Folder size={20} strokeWidth={1.5} className="text-vx-text-2" aria-hidden />
        {selected ? (
          <span className="absolute -left-1 -top-1">
            <Check on visible label={`Deselect ${entry.name}`} onToggle={() => ctx.onCheck(entry)} />
          </span>
        ) : null}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        {renaming ? (
          <RenameInput entry={entry} siblings={ctx.siblings} onSubmit={(n) => ctx.onRenameSubmit(entry, n)} onCancel={ctx.onRenameCancel} />
        ) : (
          <MiddleName name={entry.name} className="vx-name text-vx-text-1" />
        )}
        <span className="flex items-center gap-2">
          <span className="vx-meta truncate text-vx-text-3" title={isoTitle(entry.mtime)}>
            {entry.mtime ? formatRelative(entry.mtime) : 'folder'}
          </span>
          {drift ? <DriftChip drift={drift} /> : null}
        </span>
      </div>
      {drift === 'gone' ? (
        <button
          type="button"
          aria-label={`Restore ${entry.name}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            ctx.onRestore(entry);
          }}
          className="vx-ui inline-flex h-6 items-center px-1.5 text-vx-past opacity-0 hover:bg-vx-past-wash focus-visible:opacity-100 group-hover:opacity-100"
        >
          ↺
        </button>
      ) : null}
      <MenuDots entry={entry} />
      {pending && pending !== 'delete' ? <span className={s.pendingLine} aria-hidden /> : null}
    </div>
  );
}

export function GhostTile({ entry, style }: { entry: FileEntry; style?: React.CSSProperties }) {
  const isDir = entry.type === 'dir';
  return (
    <div style={{ ...style, ...(isDir ? { height: FOLDER_TILE_H } : {}) }} className={cx('flex flex-col text-vx-text-4', s.ghost)} aria-disabled>
      {isDir ? (
        <div className="flex h-full items-center gap-3 px-3">
          <FileIcon name={entry.name} type="dir" size={20} className="text-vx-text-4" />
          <MiddleName name={entry.name} className="vx-name" />
        </div>
      ) : (
        <>
          <div className={s.mat} style={{ background: 'transparent' }}>
            <div className={cx(s.matInner, 'flex items-center justify-center')}>
              <FileIcon name={entry.name} type={entry.type} size={32} className="text-vx-text-4" />
            </div>
          </div>
          <div className="flex flex-col justify-center gap-0.5 px-2.5" style={{ height: CAPTION_H }}>
            <MiddleName name={entry.name} className="vx-name" />
            <DriftChip drift="ghost" className="self-start" />
          </div>
        </>
      )}
    </div>
  );
}

export const FileTile = memo(FileTileImpl);
export const FolderTile = memo(FolderTileImpl);
export default FileTile;

'use client';

// One 32 px list row (DESIGN §6.2, §7 FileRow): checkbox, type glyph, name,
// modified, size, ⋯. States: hover, selected, focused, renaming, pending,
// collapsing, dragging, drop target, past drift chips, gone-now, ghost.
import { memo } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { formatBytes, type FileEntry } from '@volumes/shared';
import { FileIcon } from '@/components/ui/file-icon';
import { cx } from '@/components/ui/cx';
import { formatRelative, isoTitle } from '@/lib/format';
import type { Drift } from '@/lib/drive/drift';
import { useDriveCtx } from './drive-context';
import { RenameInput } from './rename-dialog';
import s from './drive.module.css';

/** `[checkbox 28][icon 20][name 1fr][modified 128][size 96][⋯ 28]` */
export const LIST_COLS = '28px 20px minmax(240px, 1fr) 128px 96px 28px';
export const ROW_H = 32;

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

export function Check({ on, visible, onToggle, label }: { on: boolean; visible: boolean; onToggle?: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle?.();
      }}
      className={cx(
        'inline-flex h-3.5 w-3.5 items-center justify-center border font-mono text-[10px] leading-none transition-opacity duration-[120ms]',
        on ? 'border-[var(--pt-100)] bg-[var(--pt-100)] text-vx-text-inv' : 'border-vx-hair-strong text-transparent',
        visible || on ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
      )}
    >
      ✓
    </button>
  );
}

export function DriftChip({ drift, className }: { drift: Drift | 'ghost'; className?: string }) {
  return (
    <span className={cx(s.fadeIn, 'vx-micro inline-flex h-[18px] shrink-0 items-center gap-1 border border-dashed border-vx-hair-dash px-1.5 text-vx-text-3', className)}>
      {drift === 'changed' ? (
        <>
          <span aria-hidden>◇</span> changed since
        </>
      ) : drift === 'gone' ? (
        <>
          <span aria-hidden className="text-vx-danger">
            ✕
          </span>{' '}
          gone now
        </>
      ) : (
        <>not here yet</>
      )}
    </span>
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

  return (
    <div
      role="option"
      aria-selected={selected}
      id={`vx-row-${encodeURIComponent(entry.path)}`}
      data-path={entry.path}
      data-vx-drop-dir={isDir && !ctx.past ? entry.path : undefined}
      draggable={!ctx.past && !renaming && !pending}
      style={{ ...style, gridTemplateColumns: LIST_COLS }}
      onMouseDown={(e) => ctx.onItemMouseDown(e, entry)}
      onClick={(e) => ctx.onItemClick(e, entry)}
      onDoubleClick={() => ctx.onOpen(entry)}
      onContextMenu={(e) => ctx.onContextMenu(e, entry)}
      onDragStart={(e) => ctx.onDragStart(e, entry)}
      onDragEnd={ctx.onDragEnd}
      onDragOver={isDir ? (e) => ctx.onFolderDragOver(e, entry) : undefined}
      onDragLeave={isDir ? (e) => ctx.onFolderDragLeave(e, entry) : undefined}
      onDrop={isDir ? (e) => ctx.onFolderDrop(e, entry) : undefined}
      className={cx(
        'group relative grid h-8 cursor-default select-none items-center px-3 transition-colors duration-[120ms]',
        selected ? 'bg-vx-accent-wash shadow-[inset_2px_0_0_var(--vx-accent-edge)]' : 'hover:bg-vx-surface-2',
        focused && !dropTarget && 'outline outline-1 -outline-offset-1 outline-[var(--vx-accent-edge)]',
        dropTarget && 'outline-dashed outline-1 -outline-offset-1 outline-[var(--vx-accent-edge)]',
        dragging && 'opacity-40',
        removing && s.removing,
      )}
    >
      <span className="flex items-center">
        <Check on={selected} visible={selected} onToggle={() => ctx.onCheck(entry)} label={`Select ${entry.name}`} />
      </span>
      <FileIcon name={entry.name} type={entry.type} />
      <span className="flex min-w-0 items-center gap-2 pr-3">
        {renaming ? (
          <RenameInput entry={entry} siblings={ctx.siblings} onSubmit={(n) => ctx.onRenameSubmit(entry, n)} onCancel={ctx.onRenameCancel} />
        ) : (
          <MiddleName name={entry.name} className={cx('vx-name', drift === 'gone' ? 'text-vx-text-2' : 'text-vx-text-1')} />
        )}
        {drift && !renaming ? <DriftChip drift={drift} /> : null}
        {drift === 'gone' ? (
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              ctx.onRestore(entry);
            }}
            className="vx-ui inline-flex h-[18px] shrink-0 items-center gap-1 px-1.5 text-vx-past opacity-0 transition-opacity duration-[120ms] hover:bg-vx-past-wash focus-visible:opacity-100 group-hover:opacity-100"
          >
            <span aria-hidden>↺</span> Restore
          </button>
        ) : null}
      </span>
      <span className="vx-meta truncate text-right text-vx-text-3" title={isoTitle(entry.mtime)}>
        {entry.mtime ? formatRelative(entry.mtime) : '—'}
      </span>
      <span className="vx-meta truncate text-right text-vx-text-3">{isDir ? '—' : <Bytes n={entry.size} />}</span>
      <span className="flex justify-end">
        <button
          type="button"
          aria-label={`Actions for ${entry.name}`}
          tabIndex={-1}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            ctx.onMenuButton(e, entry);
          }}
          className="inline-flex h-6 w-6 items-center justify-center text-vx-text-3 opacity-0 transition-opacity duration-[120ms] hover:bg-vx-surface-3 hover:text-vx-text-1 group-hover:opacity-100"
        >
          <MoreHorizontal size={14} aria-hidden />
        </button>
      </span>
      {pending && pending !== 'delete' ? <span className={s.pendingLine} aria-hidden /> : null}
    </div>
  );
}

/** "4.2 MiB" with the unit dimmer. */
export function Bytes({ n }: { n: number }) {
  const txt = formatBytes(n);
  const i = txt.lastIndexOf(' ');
  if (i < 0) return <>{txt}</>;
  return (
    <>
      {txt.slice(0, i)}
      <span className="vx-unit">{txt.slice(i)}</span>
    </>
  );
}

export const FileRow = memo(FileRowImpl);

/** A dashed row for an item that exists now but not at the viewed version. */
export function GhostRow({ entry, style }: { entry: FileEntry; style?: React.CSSProperties }) {
  return (
    <div style={{ ...style, gridTemplateColumns: LIST_COLS }} className={cx('grid h-8 items-center px-3 text-vx-text-4', s.ghost)} aria-disabled>
      <span />
      <FileIcon name={entry.name} type={entry.type} className="text-vx-text-4" />
      <span className="flex min-w-0 items-center gap-2 pr-3">
        <MiddleName name={entry.name} className="vx-name" />
        <DriftChip drift="ghost" />
      </span>
      <span className="vx-meta text-right">{entry.mtime ? formatRelative(entry.mtime) : '—'}</span>
      <span className="vx-meta text-right">{entry.type === 'dir' ? '—' : formatBytes(entry.size)}</span>
      <span />
    </div>
  );
}

/** "+ N items added later ▸": collapsed footer of ghost rows. */
export function AddedLaterFooter({ count, open, onToggle, style }: { count: number; open: boolean; onToggle: () => void; style?: React.CSSProperties }) {
  return (
    <button
      type="button"
      style={style}
      onClick={onToggle}
      aria-expanded={open}
      className={cx('vx-meta flex h-8 w-full items-center gap-2 px-3 text-left text-vx-text-3 hover:text-vx-text-1', s.ghost)}
    >
      <span aria-hidden>+</span>
      <span className="flex-1">
        {count} {count === 1 ? 'item' : 'items'} added later
      </span>
      <span aria-hidden className={cx('transition-transform duration-[160ms]', open && 'rotate-90')}>
        ▸
      </span>
    </button>
  );
}

export default FileRow;

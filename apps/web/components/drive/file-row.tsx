'use client';

// One list row (UNIFY-SPEC §12.1, DESIGN-v2 §6.2, §7): 36 px, full-bleed in the sheet with a
// hair-soft divider, grid `--vx-list-cols`
// (checkbox · icon + name · modified · size · actions). At rest a row shows only its icon,
// name (with a filled star when starred), date and size; the checkbox and the actions
// (Star · Download · Share · Versions · More)
// appear on hover, focus or selection. With compact columns (panel or rail open) the
// actions overlay the row end and cover the date entirely. Phones get 60 px rows with a
// meta line and a ⋮ button. States: hover, selected, focused, renaming, pending,
// collapsing, dragging, drop target, past drift chips, gone-now, ghost.
import { memo } from 'react';
import { ChevronRight, Clock, Download, MoreHorizontal, MoreVertical, Share2, Star } from 'lucide-react';
import { formatBytes, type FileEntry } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FileIcon } from '@/components/ui/file-icon';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { cx } from '@/components/ui/cx';
import { formatRelative, isoTitle } from '@/lib/format';
import { useVx } from '@/lib/store';
import type { Drift } from '@/lib/drive/drift';
import { useDriveCtx, type DriveCtxValue } from './drive-context';
import { RenameInput } from './rename-dialog';
import { ItemAnnotations } from '@/components/labels/label-chip';
import s from './drive.module.css';

/** Columns come from CSS (`--vx-list-cols` / `--vx-list-cols-compact`). */
export const LIST_COLS = 'var(--vx-list-cols)';
export const LIST_COLS_COMPACT = 'var(--vx-list-cols-compact)';
export const ROW_H = 36;
export const PHONE_ROW_H = 60;
/** Rows run full-bleed inside the sheet (UNIFY-SPEC §12.1); dividers carry the structure. */
export const LIST_INSET = 0;

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

/** Drift tag (UNIFY-SPEC §12.1): a landing-style tag, Mono 11, r2, h 18, 1 px hair-strong. */
export function DriftChip({ drift, className }: { drift: Drift | 'ghost'; className?: string }) {
  return (
    <span
      className={cx(
        s.fadeIn,
        'inline-flex h-[18px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-vx-xs border px-1.5 font-mono text-[11px] font-medium leading-4',
        drift === 'changed' && 'border-vx-hair-strong bg-vx-surface-2 text-vx-text-2',
        drift === 'gone' && 'border-vx-danger-edge bg-vx-danger-wash text-vx-danger',
        drift === 'ghost' && 'border-dashed border-vx-hair-dash text-vx-text-3',
        className,
      )}
    >
      {drift !== 'ghost' ? <span aria-hidden className={cx('h-1.5 w-1.5 shrink-0 rounded-full', drift === 'gone' ? 'bg-vx-danger' : 'bg-vx-text-3')} /> : null}
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

/** The filled star next to a starred item's name (always shown, unlike the hover actions). */
export function StarMark({ className }: { className?: string }) {
  return (
    <span role="img" aria-label="Starred" title="Starred" className={cx('inline-flex shrink-0', className)}>
      <Star size={12} strokeWidth={2} fill="currentColor" aria-hidden />
    </span>
  );
}

/** The star toggle of a row or card (filled while starred). Starring changes nothing in the drive, so viewers have it too. */
export function StarButton({ entry, className }: { entry: FileEntry; className?: string }) {
  const ctx = useDriveCtx();
  const on = ctx.starred.has(entry.path);
  return (
    <Tooltip label={on ? 'Remove from Starred' : 'Add to Starred'} kbd="S">
      <IconButton
        size="sm"
        label={on ? `Unstar ${entry.name}` : `Star ${entry.name}`}
        nativeTitle={false}
        tabIndex={-1}
        aria-pressed={on}
        className={className}
        {...stop}
        onClick={(e) => {
          e.stopPropagation();
          ctx.cmd.star([entry]);
        }}
      >
        <Star size={16} strokeWidth={1.75} fill={on ? 'currentColor' : 'none'} aria-hidden />
      </IconButton>
    </Tooltip>
  );
}

/** Hover actions: Star (now only) · Download · Share · Versions (files) · More. 28 px icon buttons, r4. */
export function RowActions({ entry, className }: { entry: FileEntry; className?: string }) {
  const ctx = useDriveCtx();
  const isFile = entry.type === 'file';
  const btn = 'group-aria-selected:text-vx-on-selection';
  return (
    <span className={cx('flex items-center justify-end', className)}>
      {ctx.past ? null : <StarButton entry={entry} className={btn} />}
      <Tooltip label={isFile ? 'Download' : 'Download .zip'} kbd="D">
        <IconButton size="sm" label={isFile ? `Download ${entry.name}` : `Download ${entry.name} as .zip`} nativeTitle={false} tabIndex={-1} className={btn} {...stop} onClick={(e) => { e.stopPropagation(); ctx.cmd.download([entry]); }}>
          <Download size={16} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </Tooltip>
      {ctx.viewOnly ? null : (
        <Tooltip label={ctx.past ? 'Share pinned link' : 'Share'} kbd="⇧S">
          <IconButton size="sm" label={`Share ${entry.name}`} nativeTitle={false} tabIndex={-1} className={btn} {...stop} onClick={(e) => { e.stopPropagation(); ctx.cmd.share(entry); }}>
            <Share2 size={16} strokeWidth={1.75} aria-hidden />
          </IconButton>
        </Tooltip>
      )}
      {isFile ? (
        <Tooltip label="Versions" kbd="⇧H">
          <IconButton size="sm" label={`Versions of ${entry.name}`} nativeTitle={false} tabIndex={-1} className={btn} {...stop} onClick={(e) => { e.stopPropagation(); ctx.cmd.versions(entry); }}>
            <Clock size={16} strokeWidth={1.75} aria-hidden />
          </IconButton>
        </Tooltip>
      ) : (
        <span className="w-7 shrink-0" aria-hidden />
      )}
      <Tooltip label="More actions">
        <IconButton size="sm" label={`Actions for ${entry.name}`} nativeTitle={false} tabIndex={-1} className={btn} {...stop} onClick={(e) => { e.stopPropagation(); ctx.onMenuButton(e, entry); }}>
          <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </Tooltip>
    </span>
  );
}

/**
 * Shared visual state of a row or card (UNIFY-SPEC §5): hover = raise; selected = selection fill
 * (rows add a 2 px accent bar on the left, `s.selBar`); drop target = accent-wash + a 1 px
 * accent-edge inset. The keyboard-focus ring (violet) comes from drive.module.css, only while the
 * list itself has keyboard focus, so a click never paints a ring.
 */
export function itemTone(o: { selected: boolean; focused: boolean; dropTarget: boolean; dragging: boolean }) {
  return cx(
    o.dropTarget ? cx('bg-vx-accent-wash text-vx-on-accent-wash', s.dropOn) : o.selected ? 'bg-vx-selection text-vx-on-selection' : 'hover:bg-vx-raise',
    o.dragging && 'opacity-40',
  );
}

function FileRowImpl({ entry, style }: { entry: FileEntry; style?: React.CSSProperties }) {
  const ctx = useDriveCtx();
  const selected = ctx.selection.has(entry.path);
  // The row whose preview / versions panel is open is marked like a selection, so the panel has a home.
  const open = useVx((st) => st.panel?.path === entry.path);
  const lit = selected || open;
  const focused = ctx.focus === entry.path;
  const drift = ctx.drift?.get(entry.path);
  const pending = ctx.pending[entry.path];
  const removing = !!ctx.removing[entry.path];
  const dragging = ctx.dragging.has(entry.path);
  const isDir = entry.type === 'dir';
  const dropTarget = ctx.dropDir === entry.path;
  const renaming = ctx.renaming === entry.path;
  const phone = ctx.density === 'phone';
  const meta = lit ? 'text-vx-on-selection' : 'text-vx-text-3';
  const modified = entry.mtime ? formatRelative(entry.mtime) : '—';
  // Compact columns are 120 px: drop a trailing time at the date boundary ("8 Dec 2025 08:57"
  // → "8 Dec 2025") instead of clipping mid-string. The full stamp stays in the tooltip.
  const modifiedShown = ctx.density === 'compact' ? compactDate(modified) : modified;

  const name = renaming ? (
    <RenameInput entry={entry} siblings={ctx.siblings} onSubmit={(n) => ctx.onRenameSubmit(entry, n)} onCancel={ctx.onRenameCancel} />
  ) : (
    <MiddleName
      name={entry.name}
      className={cx(phone ? 'text-[15px] leading-5' : 'text-[14px] leading-5', 'font-medium', lit ? 'text-vx-on-selection' : drift === 'gone' ? 'text-vx-text-2' : 'text-vx-text-1')}
    />
  );

  const starred = !ctx.past && ctx.starred.has(entry.path);
  const extras = (
    <>
      {starred && !renaming ? <StarMark className={lit ? 'text-vx-on-selection' : 'text-vx-text-2'} /> : null}
      {drift && !renaming ? <DriftChip drift={drift} /> : null}
      {!ctx.past && !renaming ? <ItemAnnotations path={entry.path} lit={lit} max={ctx.density === 'wide' ? 2 : 1} /> : null}
      {pending === 'waiting' ? <span className={cx('vx-meta shrink-0', meta)}>Waiting for a free slot</span> : null}
      {drift === 'gone' && !phone ? <GoneRestore entry={entry} className="shrink-0" /> : null}
    </>
  );

  const common = {
    role: 'option' as const,
    'aria-selected': selected,
    'data-focused': focused || undefined,
    'data-open': open || undefined,
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
    s.row,
    'group relative grid cursor-default select-none items-center transition-colors duration-[120ms] ease-vx',
    itemTone({ selected: lit, focused, dropTarget, dragging }),
    lit && !dropTarget && s.selBar,
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
          <span className="flex min-w-0 items-center gap-2">
            {name}
            {starred && !renaming ? <StarMark className={lit ? 'text-vx-on-selection' : 'text-vx-text-2'} /> : null}
            {!ctx.past && !renaming ? <ItemAnnotations path={entry.path} lit={lit} dots /> : null}
          </span>
          <span className={cx('vx-meta flex min-w-0 items-center gap-2', meta)}>
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
          <MoreVertical size={18} strokeWidth={1.75} aria-hidden />
        </IconButton>
        {pending && pending !== 'delete' ? <span className={s.pendingLine} aria-hidden /> : null}
      </div>
    );
  }

  const wide = ctx.density === 'wide';
  return (
    <div {...common} style={{ ...style, gridTemplateColumns: listCols(ctx.density) }} className={cx(frame, 'pl-1', wide ? 'pr-2' : 'pr-3')}>
      <span className="flex items-center justify-center">
        <RowCheck on={selected} onToggle={() => ctx.onCheck(entry)} label={`Select ${entry.name}`} className={cx(!selected && s.reveal, s.revealCheck)} />
      </span>
      <span className="flex min-w-0 items-center gap-3 pr-4">
        <FileIcon name={entry.name} type={entry.type} size={20} />
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
      className={cx(s.row, 'grid items-center text-vx-text-4', phone ? 'pl-2' : 'pl-1 pr-3')}
      aria-disabled
    >
      {phone ? null : <span />}
      <span className={cx('flex min-w-0 items-center gap-3', !phone && 'pr-4')}>
        <FileIcon name={entry.name} type={entry.type} size={phone ? 28 : 20} muted />
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
      className="vx-inset-focus flex h-9 w-full min-w-0 items-center gap-2 rounded-vx-sm border border-dashed border-vx-hair-dash px-3 text-left text-[13px] leading-5 text-vx-text-3 transition-colors duration-[120ms] hover:bg-vx-raise hover:text-vx-text-1"
    >
      <span className="shrink-0 font-medium text-vx-text-2">
        + {count} {count === 1 ? 'item' : 'items'} added later
      </span>
      {shown.length ? (
        <span className="min-w-0 truncate text-vx-text-3">
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

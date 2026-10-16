'use client';

// The drive's virtualised body (by row). A `Folders` heading over glass folder cards, then a `Files`
// heading over file cards (grid view) or a framed table of rows under its column header (list view).
// The layout comes from lib/drive/layout (also used by the marquee hit-test in FileBrowser).
import { useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cx } from '@/components/ui/cx';
import { GRID_GAP, gridPad, type GridLayout } from '@/lib/drive/layout';
import { useDriveCtx } from './drive-context';
import { AddedLaterFooter, FileRow, GhostRow } from './file-row';
import { FileTile, FolderTile, GhostTile } from './file-tile';
import { NewFolderEditor } from './new-folder-dialog';
import s from './drive.module.css';

export default function FileGrid({
  layout,
  scrollRef,
  focusRow,
  listHead,
  sortSlot,
}: {
  layout: GridLayout;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  focusRow: number;
  /** The list view's column header (select all · sortable columns · count). */
  listHead?: React.ReactNode;
  /** The grid view's sort control, on the first heading. */
  sortSlot?: React.ReactNode;
}) {
  const ctx = useDriveCtx();
  const phone = ctx.density === 'phone';
  const pad = gridPad(phone);
  const { rows } = layout;
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => rows[i].height,
    overscan: 6,
    getItemKey: (i) => rows[i].key,
  });

  useEffect(() => {
    v.measure();
  }, [layout, v]);

  useEffect(() => {
    if (focusRow >= 0) v.scrollToIndex(focusRow, { align: 'auto' });
  }, [focusRow, v]);

  const last = rows[rows.length - 1];
  // Phones: clear the floating strip and the + New button under the last row.
  const total = last ? last.top + last.height + (phone ? 160 : pad) : 0;

  return (
    <div
      role="listbox"
      aria-multiselectable
      aria-label="Files"
      aria-activedescendant={listHead && ctx.focus && layout.rowOf.has(ctx.focus) && rows[layout.rowOf.get(ctx.focus)!]?.kind === 'filerow' ? `vx-row-${encodeURIComponent(ctx.focus)}` : undefined}
      className={cx('relative w-full', ctx.anySelected && s.anySelected)}
      style={{ height: Math.max(total, v.getTotalSize()) }}
    >
      {v.getVirtualItems().map((vi) => {
        const r = rows[vi.index];
        const base: React.CSSProperties = { position: 'absolute', left: 0, width: '100%', top: 0, transform: `translateY(${r.top}px)` };
        const inset: React.CSSProperties = { ...base, left: pad, width: `calc(100% - ${pad * 2}px)` };
        if (r.kind === 'label') {
          return (
            <div key={r.key} style={{ ...base, height: r.height, paddingLeft: pad, paddingRight: pad }} className="flex items-end justify-between gap-3 pb-3">
              <h2 className="flex min-w-0 items-baseline gap-2 text-[18px] font-semibold leading-6 tracking-[-0.01em] text-vx-text-1 max-[720px]:text-[17px]">
                <span className="truncate">{r.text}</span>
                {r.count ? <span className="font-mono text-[13px] font-normal tabular-nums text-vx-text-3">{r.count}</span> : null}
              </h2>
              {r.sort && sortSlot ? <div className="flex shrink-0 items-center">{sortSlot}</div> : null}
            </div>
          );
        }
        if (r.kind === 'listhead') {
          return (
            <div
              key={r.key}
              role="presentation"
              style={{ ...inset, height: r.height }}
              className="overflow-hidden rounded-t-vx-md border border-vx-hair bg-vx-surface-2"
            >
              {listHead}
            </div>
          );
        }
        if (r.kind === 'filerow') {
          if (r.entry === 'new') return null;
          return (
            <div
              key={r.key}
              style={{ ...inset, height: r.height }}
              className={cx('border-x border-vx-hair', r.last && 'overflow-hidden rounded-b-vx-md border-b')}
            >
              {r.ghost ? <GhostRow entry={r.entry} style={{ height: '100%' }} /> : <FileRow entry={r.entry} style={{ height: '100%' }} />}
            </div>
          );
        }
        if (r.kind === 'footer') {
          return (
            <div key={r.key} style={{ ...base, height: r.height, paddingLeft: pad, paddingRight: pad }} className="flex items-center">
              <AddedLaterFooter count={r.count} names={r.names} open={ctx.addedLaterOpen} onToggle={ctx.onToggleAddedLater} />
            </div>
          );
        }
        return (
          <div
            key={r.key}
            style={{
              ...base,
              height: r.tileH,
              paddingLeft: pad,
              paddingRight: pad,
              display: 'grid',
              gridTemplateColumns: `repeat(${r.cols}, minmax(0, 1fr))`,
              columnGap: GRID_GAP,
            }}
          >
            {r.items.map((it) => {
              if (it === 'new') return <NewFolderEditor key="__new__" variant="tile" style={{ height: r.tileH }} />;
              if (r.kind === 'ghosts') return <GhostTile key={it.path} entry={it} style={{ height: r.tileH }} />;
              if (r.kind === 'folders') return <FolderTile key={it.path} entry={it} style={{ height: r.tileH }} />;
              return <FileTile key={it.path} entry={it} style={{ height: r.tileH }} />;
            })}
          </div>
        );
      })}
    </div>
  );
}

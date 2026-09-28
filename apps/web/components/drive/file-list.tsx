'use client';

// Virtualised list view (40 px rows, 60 on phones; @tanstack/react-virtual). A 1,000-item
// folder renders only the visible rows plus overscan. Rows sit 8 px in from the sheet
// edges with no dividers.
import { useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FileEntry } from '@volumes/shared';
import { cx } from '@/components/ui/cx';
import { useDriveCtx } from './drive-context';
import { AddedLaterFooter, FileRow, GhostRow, LIST_INSET } from './file-row';
import { NewFolderEditor } from './new-folder-dialog';
import s from './drive.module.css';

export type ListRow =
  | { kind: 'new' }
  | { kind: 'entry'; entry: FileEntry }
  | { kind: 'footer'; count: number; names?: string[] }
  | { kind: 'ghost'; entry: FileEntry };

/** Space above the first row. */
export const LIST_TOP = 4;

export function listRowKey(r: ListRow): string {
  switch (r.kind) {
    case 'new':
      return '__new__';
    case 'footer':
      return '__footer__';
    case 'entry':
      return r.entry.path;
    case 'ghost':
      return `ghost:${r.entry.path}`;
  }
}

export default function FileList({
  rows,
  rowH,
  scrollRef,
  focusIndex,
}: {
  rows: ListRow[];
  rowH: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  focusIndex: number;
}) {
  const ctx = useDriveCtx();
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH,
    overscan: 12,
    paddingStart: LIST_TOP,
    // Phones: clear the floating strip pill and the + New FAB.
    paddingEnd: ctx.density === 'phone' ? 160 : 16,
    getItemKey: (i) => listRowKey(rows[i]),
  });

  useEffect(() => {
    v.measure();
  }, [rowH, v]);

  useEffect(() => {
    if (focusIndex >= 0) v.scrollToIndex(focusIndex, { align: 'auto' });
  }, [focusIndex, v]);

  return (
    <div
      role="listbox"
      aria-multiselectable
      aria-label="Files"
      aria-activedescendant={ctx.focus ? `vx-row-${encodeURIComponent(ctx.focus)}` : undefined}
      className={cx('relative w-full', ctx.anySelected && s.anySelected)}
      style={{ height: v.getTotalSize() }}
    >
      {v.getVirtualItems().map((vi) => {
        const r = rows[vi.index];
        const style: React.CSSProperties = {
          position: 'absolute',
          top: 0,
          left: LIST_INSET,
          width: `calc(100% - ${LIST_INSET * 2}px)`,
          height: rowH,
          transform: `translateY(${vi.start}px)`,
        };
        switch (r.kind) {
          case 'new':
            return <NewFolderEditor key={vi.key} variant="row" style={style} />;
          case 'entry':
            return <FileRow key={vi.key} entry={r.entry} style={style} />;
          case 'footer':
            return (
              <div key={vi.key} style={style} className="flex items-center">
                <AddedLaterFooter count={r.count} names={r.names} open={ctx.addedLaterOpen} onToggle={ctx.onToggleAddedLater} />
              </div>
            );
          case 'ghost':
            return <GhostRow key={vi.key} entry={r.entry} style={style} />;
        }
      })}
    </div>
  );
}

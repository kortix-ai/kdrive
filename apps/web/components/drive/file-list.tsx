'use client';

// Virtualised list view (32 px rows, @tanstack/react-virtual). A 1,000-item
// folder renders only the visible rows plus overscan.
import { useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FileEntry } from '@volumes/shared';
import { useDriveCtx } from './drive-context';
import { AddedLaterFooter, FileRow, GhostRow, ROW_H } from './file-row';
import { NewFolderEditor } from './new-folder-dialog';

export type ListRow =
  | { kind: 'new' }
  | { kind: 'entry'; entry: FileEntry }
  | { kind: 'footer'; count: number }
  | { kind: 'ghost'; entry: FileEntry };

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
  scrollRef,
  focusIndex,
}: {
  rows: ListRow[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  focusIndex: number;
}) {
  const ctx = useDriveCtx();
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
    getItemKey: (i) => listRowKey(rows[i]),
  });

  useEffect(() => {
    if (focusIndex >= 0) v.scrollToIndex(focusIndex, { align: 'auto' });
  }, [focusIndex, v]);

  return (
    <div
      role="listbox"
      aria-multiselectable
      aria-label="Files"
      aria-activedescendant={ctx.focus ? `vx-row-${encodeURIComponent(ctx.focus)}` : undefined}
      className="relative w-full"
      style={{ height: v.getTotalSize() }}
    >
      {v.getVirtualItems().map((vi) => {
        const r = rows[vi.index];
        const style: React.CSSProperties = { position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_H, transform: `translateY(${vi.start}px)` };
        switch (r.kind) {
          case 'new':
            return <NewFolderEditor key={vi.key} variant="row" style={style} />;
          case 'entry':
            return <FileRow key={vi.key} entry={r.entry} style={style} />;
          case 'footer':
            return (
              <div key={vi.key} style={style}>
                <AddedLaterFooter count={r.count} open={ctx.addedLaterOpen} onToggle={ctx.onToggleAddedLater} />
              </div>
            );
          case 'ghost':
            return <GhostRow key={vi.key} entry={r.entry} style={style} />;
        }
      })}
    </div>
  );
}

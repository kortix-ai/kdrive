'use client';

// Virtualised grid view (by row of tiles). Folders first as 64 px compact
// tiles under a FOLDERS label, then FILES on 4:3 mats. The layout comes from
// lib/drive/layout (also used by the marquee hit-test in FileBrowser).
import { useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { GRID_GAP, GRID_PAD, type GridLayout } from '@/lib/drive/layout';
import { useDriveCtx } from './drive-context';
import { AddedLaterFooter } from './file-row';
import { FileTile, FolderTile, GhostTile } from './file-tile';
import { NewFolderEditor } from './new-folder-dialog';

export default function FileGrid({
  layout,
  scrollRef,
  focusRow,
}: {
  layout: GridLayout;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  focusRow: number;
}) {
  const ctx = useDriveCtx();
  const { rows, cols } = layout;
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => rows[i].height,
    overscan: 4,
    paddingStart: 4,
    getItemKey: (i) => rows[i].key,
  });

  useEffect(() => {
    v.measure();
  }, [layout, v]);

  useEffect(() => {
    if (focusRow >= 0) v.scrollToIndex(focusRow, { align: 'auto' });
  }, [focusRow, v]);

  const total = rows.length ? rows[rows.length - 1].top + rows[rows.length - 1].height + GRID_PAD : 0;

  return (
    <div
      role="listbox"
      aria-multiselectable
      aria-label="Files"
      className="relative w-full"
      style={{ height: Math.max(total, v.getTotalSize()) }}
    >
      {v.getVirtualItems().map((vi) => {
        const r = rows[vi.index];
        const base: React.CSSProperties = { position: 'absolute', left: 0, width: '100%', top: 0, transform: `translateY(${r.top}px)` };
        if (r.kind === 'label') {
          return (
            <div key={r.key} style={{ ...base, height: r.height, paddingLeft: GRID_PAD, paddingRight: GRID_PAD }} className="flex items-end pb-2">
              <span className="vx-label">{r.text}</span>
            </div>
          );
        }
        if (r.kind === 'footer') {
          return (
            <div key={r.key} style={{ ...base, height: r.height, paddingLeft: GRID_PAD, paddingRight: GRID_PAD }} className="flex items-center">
              <AddedLaterFooter count={r.count} open={ctx.addedLaterOpen} onToggle={ctx.onToggleAddedLater} />
            </div>
          );
        }
        return (
          <div
            key={r.key}
            style={{
              ...base,
              height: r.tileH,
              paddingLeft: GRID_PAD,
              paddingRight: GRID_PAD,
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              columnGap: GRID_GAP,
            }}
          >
            {r.items.map((it) => {
              if (it === 'new') return <NewFolderEditor key="__new__" variant="tile" />;
              if (r.kind === 'ghosts') return <GhostTile key={it.path} entry={it} style={{ height: r.tileH }} />;
              if (r.kind === 'folders') return <FolderTile key={it.path} entry={it} />;
              return <FileTile key={it.path} entry={it} style={{ height: r.tileH }} />;
            })}
          </div>
        );
      })}
    </div>
  );
}

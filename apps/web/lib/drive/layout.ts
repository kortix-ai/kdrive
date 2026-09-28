// Grid view layout (DESIGN §4, §6.2): tiles `repeat(auto-fill, minmax(184px, 1fr))`,
// 12 px gaps, 16 px padding; FOLDERS (64 px compact tiles) then FILES (4:3 mat
// + 44 px caption). Rows are virtualised; item rects feed the marquee hit-test.
import type { FileEntry } from '@volumes/shared';
import { gridColumns, gridItemRects, type ItemRect } from './selection';

export const FOLDER_TILE_H = 64;
export const CAPTION_H = 44;

export const GRID_MIN = 184;
export const GRID_GAP = 12;
export const GRID_PAD = 16;
const LABEL_H = 36;
const FOOTER_H = 44;

export type Cell = FileEntry | 'new';

export type GridRow =
  | { key: string; kind: 'label'; text: string; top: number; height: number }
  | { key: string; kind: 'folders' | 'files' | 'ghosts'; items: Cell[]; top: number; height: number; tileH: number }
  | { key: string; kind: 'footer'; count: number; top: number; height: number };

export interface GridLayout {
  rows: GridRow[];
  cols: number;
  tileW: number;
  fileTileH: number;
  itemRects: ItemRect[];
  /** entry path → row index (keyboard focus scrolling) */
  rowOf: Map<string, number>;
}

export function computeGridLayout(o: {
  width: number;
  folders: FileEntry[];
  files: FileEntry[];
  creating: boolean;
  ghosts: FileEntry[];
  addedLaterCount: number;
}): GridLayout {
  const { cols, tileW } = gridColumns(o.width, { min: GRID_MIN, gap: GRID_GAP, pad: GRID_PAD });
  const fileTileH = Math.round(tileW * 0.75) + CAPTION_H + 2;
  const rows: GridRow[] = [];
  const itemRects: ItemRect[] = [];
  const rowOf = new Map<string, number>();
  let top = 4;

  const section = (label: string, kind: 'folders' | 'files' | 'ghosts', cells: Cell[], tileH: number, id: string = kind) => {
    if (!cells.length) return;
    rows.push({ key: `label:${id}`, kind: 'label', text: label, top, height: LABEL_H });
    top += LABEL_H;
    if (kind !== 'ghosts') {
      const offset = cells[0] === 'new' ? 1 : 0;
      const rects = gridItemRects(
        cells.map((c) => (c === 'new' ? '__new__' : c.path)),
        { top, cols, tileW, tileH, gap: GRID_GAP, pad: GRID_PAD },
      );
      itemRects.push(...rects.slice(offset));
    }
    for (let i = 0; i < cells.length; i += cols) {
      const items = cells.slice(i, i + cols);
      const idx = rows.length;
      rows.push({ key: `${id}:${i}`, kind, items, top, height: tileH + GRID_GAP, tileH });
      for (const it of items) if (it !== 'new') rowOf.set(it.path, idx);
      top += tileH + GRID_GAP;
    }
  };

  const folderCells: Cell[] = o.creating ? ['new', ...o.folders] : o.folders;
  section('Folders', 'folders', folderCells, FOLDER_TILE_H);
  section('Files', 'files', o.files, fileTileH);
  if (o.addedLaterCount > 0) {
    rows.push({ key: 'footer', kind: 'footer', count: o.addedLaterCount, top, height: FOOTER_H });
    top += FOOTER_H;
    const gf = o.ghosts.filter((g) => g.type === 'dir');
    const gfiles = o.ghosts.filter((g) => g.type !== 'dir');
    if (gf.length) section('Added later · folders', 'ghosts', gf, FOLDER_TILE_H, 'ghost-dirs');
    if (gfiles.length) section('Added later · files', 'ghosts', gfiles, fileTileH, 'ghost-files');
  }
  return { rows, cols, tileW, fileTileH, itemRects, rowOf };
}

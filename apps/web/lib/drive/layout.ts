// Grid view layout (DESIGN-v2 §6.2): an eyebrow `FOLDERS`, folder cards (44 px) in
// `repeat(auto-fill, minmax(220px, 1fr))`, then an eyebrow `Files` and file cards in
// `minmax(200px, 1fr)`: a 40 px head, a 4:3 mat and a caption, all inside a 6 px inset.
// 12 px gaps, 20 px side padding. Rows are virtualised; item rects feed the marquee hit-test.
import type { FileEntry } from '@volumes/shared';
import { gridColumns, gridItemRects, type ItemRect } from './selection';

export const FOLDER_TILE_H = 44;
/** File card head: type icon (checkbox on hover), name, ⋮. */
export const HEAD_H = 40;
/** File card caption under the mat, including the 6 px bottom inset. */
export const CAPTION_H = 30;
/** Side inset of the mat inside a file card. */
export const CARD_INSET = 6;

export const FOLDER_MIN = 220;
export const GRID_MIN = 200;
export const GRID_GAP = 12;
export const GRID_PAD = 20;
const LABEL_H = 40;
const FOOTER_H = 52;

export type Cell = FileEntry | 'new';

export type GridRow =
  | { key: string; kind: 'label'; text: string; top: number; height: number }
  | { key: string; kind: 'folders' | 'files' | 'ghosts'; items: Cell[]; top: number; height: number; tileH: number; cols: number; dirs: boolean }
  | { key: string; kind: 'footer'; count: number; names: string[]; top: number; height: number };

export interface GridLayout {
  rows: GridRow[];
  /** File columns. */
  cols: number;
  /** Folder columns. */
  folderCols: number;
  tileW: number;
  fileTileH: number;
  itemRects: ItemRect[];
  /** entry path → row index (keyboard focus scrolling) */
  rowOf: Map<string, number>;
}

export function fileTileHeight(tileW: number): number {
  return HEAD_H + Math.round(Math.max(0, tileW - CARD_INSET * 2) * 0.75) + CAPTION_H;
}

export function computeGridLayout(o: {
  width: number;
  folders: FileEntry[];
  files: FileEntry[];
  creating: boolean;
  ghosts: FileEntry[];
  addedLaterCount: number;
  addedLaterNames?: string[];
  /** Phones: two file columns, whatever the width. */
  phone?: boolean;
}): GridLayout {
  const pad = o.phone ? 16 : GRID_PAD;
  const files = o.phone
    ? (() => {
        const inner = Math.max(0, o.width - pad * 2);
        return { cols: 2, tileW: Math.max(0, (inner - GRID_GAP) / 2) };
      })()
    : gridColumns(o.width, { min: GRID_MIN, gap: GRID_GAP, pad });
  const folders = o.phone ? { cols: 1, tileW: Math.max(0, o.width - pad * 2) } : gridColumns(o.width, { min: FOLDER_MIN, gap: GRID_GAP, pad });
  const fileTileH = fileTileHeight(files.tileW);
  const rows: GridRow[] = [];
  const itemRects: ItemRect[] = [];
  const rowOf = new Map<string, number>();
  let top = 4;

  const section = (label: string, kind: 'folders' | 'files' | 'ghosts', cells: Cell[], dirs: boolean, id: string = kind) => {
    if (!cells.length) return;
    const { cols, tileW } = dirs ? folders : files;
    const tileH = dirs ? FOLDER_TILE_H : fileTileH;
    rows.push({ key: `label:${id}`, kind: 'label', text: label, top, height: LABEL_H });
    top += LABEL_H;
    if (kind !== 'ghosts') {
      const offset = cells[0] === 'new' ? 1 : 0;
      const rects = gridItemRects(
        cells.map((c) => (c === 'new' ? '__new__' : c.path)),
        { top, cols, tileW, tileH, gap: GRID_GAP, pad },
      );
      itemRects.push(...rects.slice(offset));
    }
    for (let i = 0; i < cells.length; i += cols) {
      const items = cells.slice(i, i + cols);
      const idx = rows.length;
      rows.push({ key: `${id}:${i}`, kind, items, top, height: tileH + GRID_GAP, tileH, cols, dirs });
      for (const it of items) if (it !== 'new') rowOf.set(it.path, idx);
      top += tileH + GRID_GAP;
    }
    top += 4;
  };

  const folderCells: Cell[] = o.creating ? ['new', ...o.folders] : o.folders;
  section('Folders', 'folders', folderCells, true);
  section('Files', 'files', o.files, false);
  if (o.addedLaterCount > 0) {
    rows.push({ key: 'footer', kind: 'footer', count: o.addedLaterCount, names: o.addedLaterNames ?? [], top, height: FOOTER_H });
    top += FOOTER_H;
    const gf = o.ghosts.filter((g) => g.type === 'dir');
    const gfiles = o.ghosts.filter((g) => g.type !== 'dir');
    if (gf.length) section('Added later · folders', 'ghosts', gf, true, 'ghost-dirs');
    if (gfiles.length) section('Added later · files', 'ghosts', gfiles, false, 'ghost-files');
  }
  return { rows, cols: files.cols, folderCols: folders.cols, tileW: files.tileW, fileTileH, itemRects, rowOf };
}

/** Grid side padding for the current density. */
export function gridPad(phone?: boolean): number {
  return phone ? 16 : GRID_PAD;
}

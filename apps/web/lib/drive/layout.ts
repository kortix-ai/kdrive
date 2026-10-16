// Drive layout (DESIGN-v2 §6.2): a `Folders` heading over glass folder cards in
// `repeat(auto-fill, minmax(220px, 1fr))` (two columns on phones), then a `Files` heading over either
// file cards in `minmax(200px, 1fr)` (grid view: a 40 px head, a 4:3 mat and a caption, inside a 6 px
// inset) or a table of rows under a column header (list view). 12 px gaps, 24 px side padding (16 on
// phones). Rows are virtualised; item rects feed the marquee hit-test.
import type { FileEntry } from '@volumes/shared';
import { gridColumns, gridItemRects, type ItemRect } from './selection';

/** Folder card: the 150 px glass object, its name and a meta line. */
export const FOLDER_CARD_H = 196;
export const FOLDER_CARD_H_PHONE = 178;
/** @deprecated the folder card height; kept for callers that size a folder tile. */
export const FOLDER_TILE_H = FOLDER_CARD_H;
/** File card head: type icon (checkbox on hover), name, ⋮. */
export const HEAD_H = 40;
/** File card caption under the mat, including the 6 px bottom inset. */
export const CAPTION_H = 30;
/** Side inset of the mat inside a file card. */
export const CARD_INSET = 6;
/** The list view's column header (top of the file table). */
export const LIST_HEAD_H = 36;

export const FOLDER_MIN = 220;
export const GRID_MIN = 200;
export const GRID_GAP = 12;
export const GRID_PAD = 24;
export const PHONE_PAD = 16;
const LABEL_H = 52;
const FOOTER_H = 52;

export type Cell = FileEntry | 'new';

export type GridRow =
  | { key: string; kind: 'label'; text: string; count: number; sort: boolean; top: number; height: number }
  | { key: string; kind: 'folders' | 'files' | 'ghosts'; items: Cell[]; top: number; height: number; tileH: number; cols: number; dirs: boolean }
  | { key: string; kind: 'listhead'; top: number; height: number }
  | { key: string; kind: 'filerow'; entry: Cell; ghost: boolean; last: boolean; top: number; height: number }
  | { key: string; kind: 'footer'; count: number; names: string[]; top: number; height: number };

export interface GridLayout {
  rows: GridRow[];
  /** File columns (1 in the list view). */
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
  /** Phones: two folder and two file columns, whatever the width. */
  phone?: boolean;
  /** List view: files are table rows of this height instead of cards. */
  listRowH?: number;
}): GridLayout {
  const pad = gridPad(o.phone);
  const inner = Math.max(0, o.width - pad * 2);
  const two = { cols: 2, tileW: Math.max(0, (inner - GRID_GAP) / 2) };
  const files = o.phone ? two : gridColumns(o.width, { min: GRID_MIN, gap: GRID_GAP, pad });
  const folders = o.phone ? two : gridColumns(o.width, { min: FOLDER_MIN, gap: GRID_GAP, pad });
  const folderH = o.phone ? FOLDER_CARD_H_PHONE : FOLDER_CARD_H;
  const fileTileH = fileTileHeight(files.tileW);
  const listRowH = o.listRowH ?? 0;
  const rows: GridRow[] = [];
  const itemRects: ItemRect[] = [];
  const rowOf = new Map<string, number>();
  let top = 0;
  let sortShown = false;

  const label = (text: string, count: number, id: string) => {
    // The grid view's sort control rides on the first heading; the list view sorts from its column header.
    const sort = !listRowH && !sortShown;
    sortShown = true;
    rows.push({ key: `label:${id}`, kind: 'label', text, count, sort, top, height: LABEL_H });
    top += LABEL_H;
  };

  const cards = (text: string, kind: 'folders' | 'files' | 'ghosts', cells: Cell[], dirs: boolean, id: string = kind) => {
    if (!cells.length) return;
    const { cols, tileW } = dirs ? folders : files;
    const tileH = dirs ? folderH : fileTileH;
    label(text, cells.filter((c) => c !== 'new').length, id);
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

  const table = (text: string, entries: FileEntry[], ghost: boolean, id: string) => {
    if (!entries.length) return;
    label(text, entries.length, id);
    rows.push({ key: `head:${id}`, kind: 'listhead', top, height: LIST_HEAD_H });
    top += LIST_HEAD_H;
    entries.forEach((e, i) => {
      const idx = rows.length;
      rows.push({ key: `${ghost ? 'ghost:' : ''}${e.path}`, kind: 'filerow', entry: e, ghost, last: i === entries.length - 1, top, height: listRowH });
      if (!ghost) {
        rowOf.set(e.path, idx);
        itemRects.push({ path: e.path, rect: { x: pad, y: top, w: inner, h: listRowH } });
      }
      top += listRowH;
    });
    top += 16;
  };

  const folderCells: Cell[] = o.creating ? ['new', ...o.folders] : o.folders;
  cards('Folders', 'folders', folderCells, true);
  if (listRowH) table('Files', o.files, false, 'files');
  else cards('Files', 'files', o.files, false);
  if (o.addedLaterCount > 0) {
    rows.push({ key: 'footer', kind: 'footer', count: o.addedLaterCount, names: o.addedLaterNames ?? [], top, height: FOOTER_H });
    top += FOOTER_H;
    const gf = o.ghosts.filter((g) => g.type === 'dir');
    const gfiles = o.ghosts.filter((g) => g.type !== 'dir');
    if (gf.length) cards('Added later · folders', 'ghosts', gf, true, 'ghost-dirs');
    if (gfiles.length) {
      if (listRowH) table('Added later · files', gfiles, true, 'ghost-files');
      else cards('Added later · files', 'ghosts', gfiles, false, 'ghost-files');
    }
  }
  return { rows, cols: listRowH ? 1 : files.cols, folderCols: folders.cols, tileW: files.tileW, fileTileH, itemRects, rowOf };
}

/** Grid side padding for the current density. */
export function gridPad(phone?: boolean): number {
  return phone ? PHONE_PAD : GRID_PAD;
}

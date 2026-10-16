import { describe, expect, test } from 'bun:test';
import type { FileEntry, ListResponse } from '@volumes/shared';
import { computeDrift } from './drift';
import { goToMatches, parseWhen } from './goto';
import { GRID_GAP, GRID_MIN, GRID_PAD, computeGridLayout } from './layout';
import { withAdded, withRenamed, withoutPaths } from './optimistic';
import {
  clickSelection,
  gridColumns,
  gridItemRects,
  itemsInRect,
  listItemRects,
  movablePaths,
  normRect,
  rangeBetween,
  stepFocus,
} from './selection';
import { nextSort, sortEntries } from './sort';

const order = ['/a', '/b', '/c', '/d', '/e'];

describe('selection', () => {
  test('rangeBetween keeps direction and handles a missing anchor', () => {
    expect(rangeBetween(order, '/b', '/d')).toEqual(['/b', '/c', '/d']);
    expect(rangeBetween(order, '/d', '/b')).toEqual(['/d', '/c', '/b']);
    expect(rangeBetween(order, null, '/c')).toEqual(['/c']);
    expect(rangeBetween(order, '/zz', '/c')).toEqual(['/c']);
  });

  test('click, ⌘-click, shift-click, ⌘⇧-click', () => {
    expect(clickSelection(order, [], null, '/c', {})).toEqual({ paths: ['/c'], mode: 'replace' });
    expect(clickSelection(order, ['/a'], '/a', '/c', { toggle: true })).toEqual({ paths: ['/c'], mode: 'toggle' });
    expect(clickSelection(order, ['/b'], '/b', '/d', { shift: true })).toEqual({ paths: ['/b', '/c', '/d'], mode: 'range' });
    const add = clickSelection(order, ['/a'], '/c', '/e', { shift: true, toggle: true });
    expect(add.mode).toBe('range');
    expect(add.paths.sort()).toEqual(['/a', '/c', '/d', '/e']);
    // shift without an anchor behaves like a plain click
    expect(clickSelection(order, [], null, '/d', { shift: true })).toEqual({ paths: ['/d'], mode: 'replace' });
  });

  test('stepFocus clamps and starts at the ends', () => {
    expect(stepFocus(order, null, 1)).toBe('/a');
    expect(stepFocus(order, null, -1)).toBe('/e');
    expect(stepFocus(order, '/a', -1)).toBe('/a');
    expect(stepFocus(order, '/b', 2)).toBe('/d');
    expect(stepFocus(order, '/e', 9)).toBe('/e');
    expect(stepFocus([], '/a', 1)).toBeNull();
  });

  test('marquee over list rows', () => {
    const rects = listItemRects(order, { top: 0, rowHeight: 32, left: 0, width: 600 });
    expect(itemsInRect(rects, normRect({ x: 50, y: 40 }, { x: 10, y: 100 }))).toEqual(['/b', '/c', '/d']);
    expect(itemsInRect(rects, normRect({ x: 5, y: 5 }, { x: 5, y: 5 }))).toEqual([]);
  });

  test('grid columns and marquee over tiles', () => {
    const g = gridColumns(16 * 2 + 184 * 3 + 12 * 2, { min: 184, gap: 12, pad: 16 });
    expect(g.cols).toBe(3);
    expect(g.tileW).toBe(184);
    const rects = gridItemRects(order, { top: 100, cols: 3, tileW: 184, tileH: 180, gap: 12, pad: 16 });
    // second row, first two tiles
    expect(itemsInRect(rects, normRect({ x: 20, y: 300 }, { x: 250, y: 310 }))).toEqual(['/d', '/e']);
    expect(gridColumns(100, { min: 184, gap: 12, pad: 16 }).cols).toBe(1);
  });

  test('movablePaths refuses moving a folder into itself or where it already is', () => {
    const parent = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/';
    expect(movablePaths(['/a', '/b/c', '/d'], '/a/x', parent)).toEqual(['/b/c', '/d']);
    expect(movablePaths(['/a/x/y'], '/a/x', parent)).toEqual([]);
  });
});

const e = (path: string, type: 'file' | 'dir', size = 0, mtime = 0): FileEntry => ({ path, name: path.slice(path.lastIndexOf('/') + 1), type, size, mtime });

describe('sort', () => {
  const list = [e('/file10.txt', 'file', 5, 3), e('/b', 'dir', 0, 9), e('/File2.txt', 'file', 50, 1), e('/a', 'dir', 0, 1)];
  test('folders first, natural case-insensitive names', () => {
    expect(sortEntries(list).map((x) => x.name)).toEqual(['a', 'b', 'File2.txt', 'file10.txt']);
    expect(sortEntries(list, { key: 'name', dir: 'desc' }).map((x) => x.name)).toEqual(['b', 'a', 'file10.txt', 'File2.txt']);
    expect(sortEntries(list, { key: 'size', dir: 'desc' }).map((x) => x.name)).toEqual(['a', 'b', 'File2.txt', 'file10.txt']);
    expect(sortEntries(list, { key: 'mtime', dir: 'asc' }).map((x) => x.name)).toEqual(['a', 'b', 'File2.txt', 'file10.txt']);
  });
  test('nextSort', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
    expect(nextSort({ key: 'name', dir: 'asc' }, 'size')).toEqual({ key: 'size', dir: 'desc' });
  });
});

describe('drift', () => {
  test('changed since, gone now, added later', () => {
    const past = [e('/same', 'file', 1, 1), e('/edited', 'file', 1, 1), e('/gone', 'file', 1, 1), e('/kind', 'file', 1, 1)];
    const now = [e('/same', 'file', 1, 1), e('/edited', 'file', 2, 5), e('/new', 'file', 1, 1), e('/kind', 'dir', 0, 1)];
    const d = computeDrift(past, now);
    expect(d.byPath.get('/same')).toBeUndefined();
    expect(d.byPath.get('/edited')).toBe('changed');
    expect(d.byPath.get('/gone')).toBe('gone');
    expect(d.byPath.get('/kind')).toBe('gone');
    expect(d.addedLater.map((x) => x.path)).toEqual(['/new', '/kind']);
    expect(computeDrift(past, undefined).byPath.size).toBe(0);
  });
});

describe('optimistic transforms', () => {
  const list: ListResponse = { path: '/', commitId: 'vc_1', entries: [e('/a', 'file'), e('/b', 'dir')] };
  test('remove, rename, add', () => {
    expect(withoutPaths(list, ['/a']).entries.map((x) => x.path)).toEqual(['/b']);
    expect(withRenamed(list, '/a', '/z.txt').entries[0]).toMatchObject({ path: '/z.txt', name: 'z.txt' });
    expect(withAdded(list, e('/c', 'dir')).entries).toHaveLength(3);
    expect(withAdded(list, e('/a', 'file')).entries).toHaveLength(2);
  });
});


describe('go to', () => {
  const now = new Date(2026, 8, 28, 10, 41);
  const entries = [
    { commitId: 'vc_A41F9C2', createdAt: new Date(2026, 8, 28, 10, 0).toISOString(), summary: 'now', isHead: true },
    { commitId: 'vc_7C19E02', createdAt: new Date(2026, 8, 14, 16, 40).toISOString(), summary: 'mid', isHead: false },
    { commitId: 'vc_3BE0A17', createdAt: new Date(2026, 8, 10, 9, 0).toISOString(), summary: 'old', isHead: false },
  ];
  test('parses relative and absolute dates', () => {
    expect(parseWhen('yesterday 16:00', now)!.at.getDate()).toBe(27);
    expect(parseWhen('14 sep', now)!.exact).toBe(false);
    expect(parseWhen('14 Sep 16:40', now)!.at.getHours()).toBe(16);
    expect(parseWhen('2026-09-14', now)!.at.getMonth()).toBe(8);
    expect(parseWhen('budget', now)).toBeNull();
  });
  test('matches a commit prefix or the nearest version at or before', () => {
    expect(goToMatches('@7c19', entries, now).map((m) => m.entry.summary)).toEqual(['mid']);
    expect(goToMatches('14 sep', entries, now)[0].entry.summary).toBe('mid');
    expect(goToMatches('13 sep', entries, now)[0].entry.summary).toBe('old');
    expect(goToMatches('1 sep', entries, now)).toEqual([]);
    expect(goToMatches('report', entries, now)).toEqual([]);
  });
});

describe('grid layout', () => {
  const mk = (n: number, type: 'file' | 'dir') => Array.from({ length: n }, (_, i) => e(`/${type}${i}`, type, 10, 1));
  test('folders then files, rows of `cols`, rects for the marquee', () => {
    // Files: 3 columns of ≥ 200 px; folders: ≥ 220 px, so only 2 fit.
    const width = GRID_PAD * 2 + GRID_MIN * 3 + GRID_GAP * 2;
    const l = computeGridLayout({ width, folders: mk(4, 'dir'), files: mk(5, 'file'), creating: true, ghosts: [], addedLaterCount: 2 });
    expect(l.cols).toBe(3);
    expect(l.folderCols).toBe(2);
    expect(l.rows.map((r) => r.kind)).toEqual(['label', 'folders', 'folders', 'folders', 'label', 'files', 'files', 'footer']);
    // "new" cell + 4 folders → 3 rows; the new cell is not hit-testable
    expect(l.itemRects).toHaveLength(9);
    expect(l.rowOf.get('/file4')).toBe(6);
    expect(new Set(l.rows.map((r) => r.key)).size).toBe(l.rows.length);
    const tops = l.rows.map((r) => r.top);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
  });
  test('phones get two file columns and two folder columns', () => {
    const l = computeGridLayout({ width: 390, folders: mk(2, 'dir'), files: mk(3, 'file'), creating: false, ghosts: [], addedLaterCount: 0, phone: true });
    expect(l.cols).toBe(2);
    expect(l.folderCols).toBe(2);
  });
  test('the list view: folder cards, then a header and one row per file', () => {
    const l = computeGridLayout({ width: 1000, folders: mk(2, 'dir'), files: mk(3, 'file'), creating: false, ghosts: mk(1, 'file'), addedLaterCount: 1, listRowH: 42 });
    expect(l.cols).toBe(1);
    expect(l.rows.map((r) => r.kind)).toEqual(['label', 'folders', 'label', 'listhead', 'filerow', 'filerow', 'filerow', 'footer', 'label', 'listhead', 'filerow']);
    // ghosts are not hit-testable
    expect(l.itemRects).toHaveLength(5);
    expect(l.rowOf.get('/file2')).toBe(6);
    expect(new Set(l.rows.map((r) => r.key)).size).toBe(l.rows.length);
  });
  test('1,000 items lay out in one pass', () => {
    const t0 = performance.now();
    const l = computeGridLayout({ width: 1200, folders: mk(100, 'dir'), files: mk(900, 'file'), creating: false, ghosts: mk(3, 'file'), addedLaterCount: 3 });
    expect(l.itemRects).toHaveLength(1000);
    expect(new Set(l.rows.map((r) => r.key)).size).toBe(l.rows.length);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

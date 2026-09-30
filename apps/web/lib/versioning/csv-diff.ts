// Row + cell diff for CSV/TSV (DESIGN.md §6.7). Pure functions (no React).
// Rows are keyed by the first column when its values are unique and non-empty on both
// sides; otherwise by position. The first row is the header.

import Papa from 'papaparse';

export interface CsvCell {
  a: string | null;
  b: string | null;
  changed: boolean;
}

export type CsvRowStatus = 'same' | 'add' | 'del' | 'mod';

export interface CsvRow {
  status: CsvRowStatus;
  key: string;
  aIndex: number | null;
  bIndex: number | null;
  cells: CsvCell[];
}

/**
 * A file can be small and still describe a huge table (a wide header with short rows).
 * Compare builds cells for at most CSV_COMPARE_MAX_COLUMNS columns (changes past them still
 * count) and shows at most CSV_COMPARE_MAX_ROWS rows, fewer when that would pass
 * CSV_COMPARE_MAX_CELLS.
 */
export const CSV_COMPARE_MAX_ROWS = 5000;
export const CSV_COMPARE_MAX_COLUMNS = 100;
export const CSV_COMPARE_MAX_CELLS = 100_000;

/** Rows to show for `columns` shown columns. */
export function csvRowBudget(columns: number): number {
  if (columns <= 0) return CSV_COMPARE_MAX_ROWS;
  return Math.min(CSV_COMPARE_MAX_ROWS, Math.max(1, Math.floor(CSV_COMPARE_MAX_CELLS / columns)));
}

export interface CsvDiff {
  /** the columns shown (at most `maxColumns`); every row's `cells` has one per column */
  columns: string[];
  /** every column in either version */
  totalColumns: number;
  headerChanged: boolean;
  keyedBy: 'first-column' | 'index';
  rows: CsvRow[];
  addedRows: number;
  removedRows: number;
  changedRows: number;
  changedCells: number;
}

export function parseCsv(text: string, opts: { delimiter?: string } = {}): string[][] {
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ''), {
    delimiter: opts.delimiter ?? '',
    skipEmptyLines: 'greedy',
  });
  return (res.data ?? []).map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? '' : String(c))) : []));
}

const uniqueNonEmpty = (xs: string[]) => xs.every((x) => x.trim() !== '') && new Set(xs).size === xs.length;

const widest = (rows: string[][], start: number) => {
  let w = start;
  for (const r of rows) if (r.length > w) w = r.length;
  return w;
};

export function diffCsvRows(aRows: string[][], bRows: string[][], opts: { maxColumns?: number } = {}): CsvDiff {
  const ha = aRows[0] ?? [];
  const hb = bRows[0] ?? [];
  const aData = aRows.slice(1);
  const bData = bRows.slice(1);

  // Column alignment: by header name when both headers are clean, else by position.
  let allColumns: string[];
  let aCol: (row: string[], c: number) => string | null;
  let bCol: (row: string[], c: number) => string | null;
  // Cells that differ in a row pair, across every column; only looks at cells either row has.
  let countChanged: (aRow: string[], bRow: string[]) => number;
  if (ha.length && hb.length && uniqueNonEmpty(ha) && uniqueNonEmpty(hb)) {
    // Maps, not array scans: a clean header can be tens of thousands of names wide.
    const ai = new Map(ha.map((h, i) => [h, i]));
    const bi = new Map(hb.map((h, i) => [h, i]));
    allColumns = [...hb, ...ha.filter((h) => !bi.has(h))];
    aCol = (row, c) => {
      const i = ai.get(allColumns[c]);
      return i === undefined ? null : (row[i] ?? '');
    };
    bCol = (row, c) => {
      const i = bi.get(allColumns[c]);
      return i === undefined ? null : (row[i] ?? '');
    };
    countChanged = (aRow, bRow) => {
      let n = 0;
      const la = Math.min(aRow.length, ha.length);
      for (let i = 0; i < la; i++) {
        const j = bi.get(ha[i]);
        if ((aRow[i] ?? '') !== (j === undefined ? '' : (bRow[j] ?? ''))) n++;
      }
      const lb = Math.min(bRow.length, hb.length);
      for (let j = 0; j < lb; j++) {
        const i = ai.get(hb[j]);
        if (i !== undefined && i < la) continue; // compared above
        if ((bRow[j] ?? '') !== '') n++;
      }
      return n;
    };
  } else {
    const width = widest(bData, widest(aData, Math.max(ha.length, hb.length)));
    allColumns = Array.from({ length: width }, (_, i) => hb[i] ?? ha[i] ?? `Column ${i + 1}`);
    aCol = (row, c) => row[c] ?? '';
    bCol = (row, c) => row[c] ?? '';
    countChanged = (aRow, bRow) => {
      let n = 0;
      const l = Math.max(aRow.length, bRow.length);
      for (let c = 0; c < l; c++) if ((aRow[c] ?? '') !== (bRow[c] ?? '')) n++;
      return n;
    };
  }
  const headerChanged = ha.length !== hb.length || ha.some((h, i) => h !== hb[i]);
  const shown = Math.min(allColumns.length, Math.max(1, opts.maxColumns ?? CSV_COMPARE_MAX_COLUMNS));
  const columns = allColumns.length > shown ? allColumns.slice(0, shown) : allColumns;

  const aKeys = aData.map((r) => aCol(r, 0) ?? '');
  const bKeys = bData.map((r) => bCol(r, 0) ?? '');
  const keyed = (aData.length > 0 || bData.length > 0) && uniqueNonEmpty(aKeys) && uniqueNonEmpty(bKeys);

  // Cells are built on first read, and only for the shown columns: most rows are never drawn.
  const cellsOf = (aRow: string[] | null, bRow: string[] | null): CsvCell[] =>
    columns.map((_, c) => {
      const a = aRow ? aCol(aRow, c) : null;
      const b = bRow ? bCol(bRow, c) : null;
      return { a, b, changed: !!aRow && !!bRow && (a ?? '') !== (b ?? '') };
    });

  const rows: CsvRow[] = [];
  let addedRows = 0;
  let removedRows = 0;
  let changedRows = 0;
  let changedCells = 0;
  const pair = (ai: number | null, bi: number | null, key: string): CsvRow => {
    const aRow = ai === null ? null : aData[ai];
    const bRow = bi === null ? null : bData[bi];
    let status: CsvRowStatus;
    if (!aRow) {
      status = 'add';
      addedRows++;
    } else if (!bRow) {
      status = 'del';
      removedRows++;
    } else {
      const changed = countChanged(aRow, bRow);
      if (changed > 0) {
        status = 'mod';
        changedRows++;
        changedCells += changed;
      } else status = 'same';
    }
    let cells: CsvCell[] | undefined;
    const row = { status, key, aIndex: ai, bIndex: bi } as CsvRow;
    Object.defineProperty(row, 'cells', { enumerable: true, get: () => (cells ??= cellsOf(aRow, bRow)) });
    return row;
  };

  if (keyed) {
    const bByKey = new Map(bKeys.map((k, i) => [k, i]));
    const aByKey = new Map(aKeys.map((k, i) => [k, i]));
    // Removed rows are placed right after the output position of the previous surviving a-row.
    const removedAfter = new Map<number, number[]>();
    let lastMatchedB = -1;
    aKeys.forEach((k, ai) => {
      const bi = bByKey.get(k);
      if (bi !== undefined) lastMatchedB = bi;
      else {
        const list = removedAfter.get(lastMatchedB) ?? [];
        list.push(ai);
        removedAfter.set(lastMatchedB, list);
      }
    });
    for (const ai of removedAfter.get(-1) ?? []) rows.push(pair(ai, null, aKeys[ai]));
    bKeys.forEach((k, bi) => {
      const ai = aByKey.get(k);
      rows.push(pair(ai ?? null, bi, k));
      for (const x of removedAfter.get(bi) ?? []) rows.push(pair(x, null, aKeys[x]));
    });
  } else {
    const n = Math.max(aData.length, bData.length);
    for (let i = 0; i < n; i++) rows.push(pair(i < aData.length ? i : null, i < bData.length ? i : null, String(i + 1)));
  }

  return { columns, totalColumns: allColumns.length, headerChanged, keyedBy: keyed ? 'first-column' : 'index', rows, addedRows, removedRows, changedRows, changedCells };
}

export function diffCsv(aText: string, bText: string, opts: { delimiter?: string; maxColumns?: number } = {}): CsvDiff {
  return diffCsvRows(parseCsv(aText, opts), parseCsv(bText, opts), opts);
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** "+2 rows −1 row · 4 cells changed", naming only the counts that are not zero. */
export function csvSummary(d: Pick<CsvDiff, 'addedRows' | 'removedRows' | 'changedCells'>): string {
  if (!d.addedRows && !d.removedRows && !d.changedCells) return 'No row changes';
  const rows = [d.addedRows ? `+${plural(d.addedRows, 'row')}` : '', d.removedRows ? `\u2212${plural(d.removedRows, 'row')}` : '']
    .filter(Boolean)
    .join(' ');
  const cells = d.changedCells ? `${plural(d.changedCells, 'cell')} changed` : '';
  return [rows, cells].filter(Boolean).join(' · ');
}

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

export interface CsvDiff {
  columns: string[];
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

export function diffCsvRows(aRows: string[][], bRows: string[][]): CsvDiff {
  const ha = aRows[0] ?? [];
  const hb = bRows[0] ?? [];
  const aData = aRows.slice(1);
  const bData = bRows.slice(1);

  // Column alignment: by header name when both headers are clean, else by position.
  let columns: string[];
  let aCol: (row: string[], c: number) => string | null;
  let bCol: (row: string[], c: number) => string | null;
  if (ha.length && hb.length && uniqueNonEmpty(ha) && uniqueNonEmpty(hb)) {
    columns = [...hb, ...ha.filter((h) => !hb.includes(h))];
    const ai = new Map(ha.map((h, i) => [h, i]));
    const bi = new Map(hb.map((h, i) => [h, i]));
    aCol = (row, c) => {
      const i = ai.get(columns[c]);
      return i === undefined ? null : (row[i] ?? '');
    };
    bCol = (row, c) => {
      const i = bi.get(columns[c]);
      return i === undefined ? null : (row[i] ?? '');
    };
  } else {
    const width = Math.max(ha.length, hb.length, ...aData.map((r) => r.length), ...bData.map((r) => r.length), 0);
    columns = Array.from({ length: width }, (_, i) => hb[i] ?? ha[i] ?? `Column ${i + 1}`);
    aCol = (row, c) => row[c] ?? '';
    bCol = (row, c) => row[c] ?? '';
  }
  const headerChanged = ha.length !== hb.length || ha.some((h, i) => h !== hb[i]);

  const aKeys = aData.map((r) => aCol(r, 0) ?? '');
  const bKeys = bData.map((r) => bCol(r, 0) ?? '');
  const keyed = (aData.length > 0 || bData.length > 0) && uniqueNonEmpty(aKeys) && uniqueNonEmpty(bKeys);

  const cellsOf = (aRow: string[] | null, bRow: string[] | null): { cells: CsvCell[]; changed: number } => {
    let changed = 0;
    const cells = columns.map((_, c) => {
      const a = aRow ? aCol(aRow, c) : null;
      const b = bRow ? bCol(bRow, c) : null;
      const diff = !!aRow && !!bRow && (a ?? '') !== (b ?? '');
      if (diff) changed++;
      return { a, b, changed: diff };
    });
    return { cells, changed };
  };

  const rows: CsvRow[] = [];
  let addedRows = 0;
  let removedRows = 0;
  let changedRows = 0;
  let changedCells = 0;
  const pair = (ai: number | null, bi: number | null, key: string): CsvRow => {
    const aRow = ai === null ? null : aData[ai];
    const bRow = bi === null ? null : bData[bi];
    const { cells, changed } = cellsOf(aRow, bRow);
    let status: CsvRowStatus;
    if (!aRow) {
      status = 'add';
      addedRows++;
    } else if (!bRow) {
      status = 'del';
      removedRows++;
    } else if (changed > 0) {
      status = 'mod';
      changedRows++;
      changedCells += changed;
    } else status = 'same';
    return { status, key, aIndex: ai, bIndex: bi, cells };
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

  return { columns, headerChanged, keyedBy: keyed ? 'first-column' : 'index', rows, addedRows, removedRows, changedRows, changedCells };
}

export function diffCsv(aText: string, bText: string, opts: { delimiter?: string } = {}): CsvDiff {
  return diffCsvRows(parseCsv(aText, opts), parseCsv(bText, opts));
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

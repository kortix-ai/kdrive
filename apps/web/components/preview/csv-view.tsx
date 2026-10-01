'use client';

import { useMemo } from 'react';
import Papa from 'papaparse';
import { useOverflowFade } from '@/lib/use-overflow-fade';
import { useTextContent } from './content';
import { PreviewError, PreviewSkeleton } from './states';

export const CSV_PREVIEW_ROWS = 1000;
/** A file can be small and still describe a huge table (a wide header with short rows):
 * the preview shows at most this many columns and cells, and says what it left out. */
export const CSV_PREVIEW_MAX_COLUMNS = 100;
export const CSV_PREVIEW_MAX_CELLS = 100_000;
/** Cells are one truncated line; past this the text (and its tooltip) is cut. */
export const CSV_PREVIEW_CELL_CHARS = 1000;

export interface CsvTable {
  /** header cells, cut to `shownColumns` */
  header: string[];
  /** the data rows shown, each cut to `shownColumns` */
  rows: string[][];
  /** data rows in the file (excluding the header) */
  totalRows: number;
  /** columns in the file (the widest of the header and the first `limit` rows) */
  columns: number;
  /** columns shown (at most CSV_PREVIEW_MAX_COLUMNS) */
  shownColumns: number;
}

/**
 * Parses CSV / TSV (delimiter auto-detected); the first row is the header. Keeps the first
 * `limit` data rows and CSV_PREVIEW_MAX_COLUMNS columns, then as many rows as fit in
 * CSV_PREVIEW_MAX_CELLS.
 */
export function parseCsv(text: string, limit = CSV_PREVIEW_ROWS): CsvTable {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  const all = parsed.data.filter((r) => Array.isArray(r));
  const fullHeader = all[0] ?? [];
  const totalRows = Math.max(0, all.length - 1);
  const firstRows = all.slice(1, 1 + limit);
  let columns = fullHeader.length;
  for (const r of firstRows) if (r.length > columns) columns = r.length;
  const shownColumns = Math.min(columns, CSV_PREVIEW_MAX_COLUMNS);
  const rowBudget = shownColumns ? Math.max(1, Math.floor(CSV_PREVIEW_MAX_CELLS / shownColumns)) : limit;
  const cut = (r: string[]) => (r.length > shownColumns ? r.slice(0, shownColumns) : r);
  return {
    header: cut(fullHeader),
    rows: firstRows.slice(0, rowBudget).map(cut),
    totalRows,
    columns,
    shownColumns,
  };
}

/** "showing the first 1,000" (rows only), or rows and columns when columns were cut. */
export function csvShownNote(t: CsvTable): string | null {
  const n = (x: number) => x.toLocaleString('en-US');
  const rowsCut = t.totalRows > t.rows.length;
  const colsCut = t.columns > t.shownColumns;
  if (!rowsCut && !colsCut) return null;
  if (!colsCut) return `showing the first ${n(t.rows.length)}`;
  const cols = `${n(t.shownColumns)} of ${n(t.columns)} columns`;
  return rowsCut ? `showing ${n(t.rows.length)} of ${n(t.totalRows)} rows and ${cols}` : `showing ${cols}`;
}

const cellText = (v: string | undefined) => (v === undefined ? '' : v.length > CSV_PREVIEW_CELL_CHARS ? v.slice(0, CSV_PREVIEW_CELL_CHARS) + '…' : v);

/** CSV as a sticky-header table (bounded: see parseCsv); mono cells, a sans header. */
export function CsvView({ src }: { src: string }) {
  const { data, error, isLoading, mutate } = useTextContent(src);
  const table = useMemo(() => (data === undefined ? null : parseCsv(data)), [data]);
  if (error) return <PreviewError status={error.status} code={error.code} onRetry={() => void mutate()} />;
  if (isLoading || !table) return <PreviewSkeleton />;
  return <CsvTableView table={table} />;
}

/** The parsed table (no fetching). */
export function CsvTableView({ table }: { table: CsvTable }) {
  const scroller = useOverflowFade<HTMLDivElement>();
  if (table.columns === 0) return <p className="vx-body px-4 py-6 text-vx-text-3">This file is empty.</p>;
  const cols = Array.from({ length: table.shownColumns }, (_, i) => i);
  const note = csvShownNote(table);
  return (
    <div className="flex min-w-0 flex-col">
      <div className="vx-meta flex min-h-11 flex-wrap items-center gap-x-1 px-4 py-2 text-vx-text-3">
        <span>
          {table.totalRows.toLocaleString('en-US')} rows · {table.columns.toLocaleString('en-US')} columns
        </span>
        {note ? <span>· {note}</span> : null}
      </div>
      <div ref={scroller} className="vx-fade-x mx-3 mb-3 max-h-[70vh] overflow-auto rounded-vx-sm border border-vx-hair bg-vx-surface">
        <table className="w-max min-w-full border-collapse text-[13px] leading-5">
          <thead>
            <tr>
              <th className="vx-colhead sticky top-0 z-10 w-10 border-b border-r border-vx-hair bg-vx-bg-2 px-2 py-2 text-right">#</th>
              {cols.map((c) => (
                <th key={c} className="vx-datahead sticky top-0 z-10 border-b border-r border-vx-hair bg-vx-bg-2 px-3 py-2 text-left last:border-r-0">
                  {cellText(table.header[c])}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i} className="hover:bg-vx-raise">
                <td className="border-b border-r border-vx-hair-soft px-2 py-1 text-right font-mono text-[12px] tabular-nums text-vx-text-3">{i + 1}</td>
                {cols.map((c) => (
                  <td key={c} className="max-w-[320px] truncate border-b border-r border-vx-hair-soft px-3 py-1 font-mono text-[12.5px] text-vx-text-2 last:border-r-0" title={r[c] === undefined ? undefined : cellText(r[c])}>
                    {cellText(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default CsvView;

'use client';

import { useMemo } from 'react';
import Papa from 'papaparse';
import { useTextContent } from './content';
import { PreviewError, PreviewSkeleton } from './states';

export const CSV_PREVIEW_ROWS = 1000;

export interface CsvTable {
  header: string[];
  rows: string[][];
  /** data rows in the file (excluding the header) */
  totalRows: number;
  columns: number;
}

/** Parses CSV / TSV (delimiter auto-detected); the first row is the header; keeps the first `limit` data rows. */
export function parseCsv(text: string, limit = CSV_PREVIEW_ROWS): CsvTable {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  const all = parsed.data.filter((r) => Array.isArray(r));
  const header = all[0] ?? [];
  const body = all.slice(1);
  const rows = body.slice(0, limit);
  const columns = Math.max(header.length, ...rows.map((r) => r.length), 0);
  return { header, rows, totalRows: body.length, columns };
}

/** CSV as a sticky-header table (first 1,000 rows); mono cells, a sans header. */
export function CsvView({ src }: { src: string }) {
  const { data, error, isLoading, mutate } = useTextContent(src);
  const table = useMemo(() => (data === undefined ? null : parseCsv(data)), [data]);
  if (error) return <PreviewError status={error.status} code={error.code} onRetry={() => void mutate()} />;
  if (isLoading || !table) return <PreviewSkeleton />;
  if (table.columns === 0) return <p className="vx-body px-4 py-6 text-vx-text-3">This file is empty.</p>;
  const cols = Array.from({ length: table.columns }, (_, i) => i);
  return (
    <div className="flex min-w-0 flex-col">
      <div className="vx-meta flex min-h-11 flex-wrap items-center gap-x-1 px-4 py-2 text-vx-text-3">
        <span>
          {table.totalRows.toLocaleString('en-US')} rows · {table.columns} columns
        </span>
        {table.totalRows > table.rows.length ? <span>· showing the first {CSV_PREVIEW_ROWS.toLocaleString('en-US')}</span> : null}
      </div>
      <div className="mx-3 mb-3 max-h-[70vh] overflow-auto rounded-vx-sm border border-vx-hair bg-vx-surface">
        <table className="w-max min-w-full border-collapse text-[13px] leading-5">
          <thead>
            <tr>
              <th className="sticky top-0 z-10 w-10 border-b border-r border-vx-hair bg-vx-surface-2 px-2 py-1.5 text-right font-medium text-vx-text-4">#</th>
              {cols.map((c) => (
                <th key={c} className="sticky top-0 z-10 border-b border-r border-vx-hair bg-vx-surface-2 px-3 py-1.5 text-left font-semibold text-vx-text-1 last:border-r-0">
                  {table.header[c] ?? ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i} className="hover:bg-vx-hover">
                <td className="border-b border-r border-vx-hair-soft px-2 py-1 text-right tabular-nums text-vx-text-4">{i + 1}</td>
                {cols.map((c) => (
                  <td key={c} className="max-w-[320px] truncate border-b border-r border-vx-hair-soft px-3 py-1 font-mono text-[12.5px] text-vx-text-2 last:border-r-0" title={r[c]}>
                    {r[c] ?? ''}
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

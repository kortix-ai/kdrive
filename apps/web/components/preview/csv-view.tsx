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

/** CSV as a sticky-header table (first 1,000 rows), `.vx-code` cells. */
export function CsvView({ src }: { src: string }) {
  const { data, error, isLoading, mutate } = useTextContent(src);
  const table = useMemo(() => (data === undefined ? null : parseCsv(data)), [data]);
  if (error) return <PreviewError status={error.status} code={error.code} onRetry={() => void mutate()} />;
  if (isLoading || !table) return <PreviewSkeleton />;
  if (table.columns === 0) return <p className="vx-meta px-4 py-6 text-vx-text-4">This file is empty.</p>;
  const cols = Array.from({ length: table.columns }, (_, i) => i);
  return (
    <div className="flex min-w-0 flex-col">
      <div className="vx-meta flex h-8 items-center gap-2 border-b border-vx-hair-soft px-4 text-vx-text-3">
        {table.totalRows.toLocaleString('en-US')} <span className="vx-unit">rows</span> · {table.columns} <span className="vx-unit">columns</span>
        {table.totalRows > table.rows.length ? <span className="text-vx-text-4">· showing the first {CSV_PREVIEW_ROWS.toLocaleString('en-US')}</span> : null}
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="vx-code w-max min-w-full border-collapse">
          <thead>
            <tr>
              <th className="sticky top-0 z-10 w-10 border-b border-r border-vx-hair bg-vx-surface-2 px-2 py-1 text-right font-normal text-vx-text-4">#</th>
              {cols.map((c) => (
                <th key={c} className="sticky top-0 z-10 border-b border-r border-vx-hair bg-vx-surface-2 px-2 py-1 text-left font-medium text-vx-text-1">
                  {table.header[c] ?? ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i} className="hover:bg-vx-surface-2">
                <td className="border-b border-r border-vx-hair-soft px-2 py-0.5 text-right text-vx-text-4">{i + 1}</td>
                {cols.map((c) => (
                  <td key={c} className="max-w-[320px] truncate border-b border-r border-vx-hair-soft px-2 py-0.5 text-vx-text-2" title={r[c]}>
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

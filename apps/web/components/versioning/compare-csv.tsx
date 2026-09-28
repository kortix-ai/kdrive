'use client';

import { useMemo } from 'react';
import { extname, type FileSide } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { errorText } from '@/lib/versioning/hooks';
import { csvSummary, diffCsv, type CsvRow } from '@/lib/versioning/csv-diff';
import { SummaryBar } from './compare-header';
import { useSideText } from './compare-text';

const MAX_ROWS = 5000;
const MARK: Record<CsvRow['status'], string> = { same: '', add: '+', del: '−', mod: '~' };

/** CSV/TSV: merged table with a status column; added / removed rows and changed cells ("old → new"). */
export function CompareCsv({ a, b, path, changesOnly }: { a: FileSide | null; b: FileSide | null; path: string; changesOnly: boolean }) {
  const ta = useSideText(a);
  const tb = useSideText(b);
  const loading = (a && ta.isLoading) || (b && tb.isLoading);
  const err = ta.error ?? tb.error;
  const delimiter = extname(path) === '.tsv' ? '\t' : undefined;

  const diff = useMemo(() => {
    if (loading || err) return null;
    return diffCsv(a ? (ta.data ?? '') : '', b ? (tb.data ?? '') : '', { delimiter });
  }, [loading, err, a, b, ta.data, tb.data, delimiter]);

  const rows = useMemo(() => (diff ? (changesOnly ? diff.rows.filter((r) => r.status !== 'same') : diff.rows) : []), [diff, changesOnly]);

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col" aria-busy>
        <SummaryBar>Comparing…</SummaryBar>
        <div className="p-4">
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className="skeleton skel-line w-full" />
          ))}
        </div>
      </div>
    );
  }
  if (err) {
    return (
      <EmptyState
        className="flex-1"
        title="Couldn't load these versions."
        body={errorText(err)}
        actions={
          <Button
            onClick={() => {
              void ta.mutate();
              void tb.mutate();
            }}
          >
            Retry
          </Button>
        }
      />
    );
  }
  if (!diff) return null;

  const cols = diff.columns;
  const shown = rows.slice(0, MAX_ROWS);
  const note = (
    <span className="vx-micro text-vx-text-4">
      {diff.keyedBy === 'first-column' ? `Rows matched by ${cols[0] ? `"${cols[0]}"` : 'the first column'}` : 'Rows matched by position'}
      {diff.headerChanged ? ' · header changed' : ''}
    </span>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SummaryBar right={note}>{csvSummary(diff)}</SummaryBar>
      {!shown.length ? (
        <EmptyState
          className="flex-1"
          title={changesOnly || diff.rows.length ? 'These versions are identical.' : 'Both versions are empty.'}
          body={changesOnly && diff.rows.length ? 'No row or cell differs.' : undefined}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="vx-code w-max min-w-full border-collapse">
            <thead className="sticky top-0 z-[1] bg-vx-surface-2">
              <tr>
                <th className="w-7 border-b border-r border-vx-hair" aria-label="Change" />
                {cols.map((c, i) => (
                  <th key={i} className="vx-label whitespace-nowrap border-b border-r border-vx-hair px-3 py-1.5 text-left font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={`${r.status}-${r.key}-${r.aIndex}-${r.bIndex}`}
                  className={cx('border-b border-vx-hair-soft', r.status === 'add' && 'bg-vx-add-bg', r.status === 'del' && 'bg-vx-del-bg')}
                >
                  <td
                    className={cx(
                      'w-7 border-r border-vx-hair-soft text-center',
                      r.status === 'add' ? 'text-vx-ok' : r.status === 'del' ? 'text-vx-danger' : 'text-vx-text-3',
                    )}
                  >
                    {MARK[r.status]}
                  </td>
                  {r.cells.map((c, i) => (
                    <td
                      key={i}
                      className={cx(
                        'max-w-[420px] border-r border-vx-hair-soft px-3 py-1 align-top',
                        c.changed && 'bg-vx-mod-bg',
                        r.status === 'del' ? 'text-vx-text-3 line-through decoration-vx-text-4' : r.status === 'same' ? 'text-vx-text-2' : 'text-vx-text-1',
                      )}
                    >
                      {c.changed ? (
                        <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                          <span className="text-vx-text-3 line-through decoration-vx-text-4">{c.a ?? ''}</span>
                          <span className="px-1 text-vx-text-4">→</span>
                          <span>{c.b ?? ''}</span>
                        </span>
                      ) : (
                        <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{(r.status === 'del' ? c.a : c.b) ?? ''}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > MAX_ROWS ? (
            <p className="vx-micro px-4 py-3 text-vx-text-4">Showing the first {MAX_ROWS.toLocaleString('en-US')} of {rows.length.toLocaleString('en-US')} rows.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default CompareCsv;

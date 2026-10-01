'use client';

import { useMemo } from 'react';
import { extname, type FileSide } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { errorText } from '@/lib/versioning/hooks';
import { csvRowBudget, csvSummary, diffCsv, type CsvRow } from '@/lib/versioning/csv-diff';
import { DiffTag, SummaryBar } from './compare-header';
import { useSideText } from './compare-text';

const MARK: Record<CsvRow['status'], string> = { same: '', add: '+', del: '−', mod: 'M' };

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
        <div className="p-5">
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
        tone="past"
        actions={
          <Button
            variant="tonal"
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
  const maxRows = csvRowBudget(cols.length);
  const shown = rows.slice(0, maxRows);
  const colsCut = diff.totalColumns > cols.length;
  const note = (
    <span className="vx-micro text-vx-text-3">
      {diff.keyedBy === 'first-column' ? `Rows matched by ${cols[0] ? `"${cols[0]}"` : 'the first column'}` : 'Rows matched by position'}
      {diff.headerChanged ? ' · header changed' : ''}
      {colsCut ? ` · first ${cols.length.toLocaleString('en-US')} of ${diff.totalColumns.toLocaleString('en-US')} columns` : ''}
    </span>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SummaryBar right={note}>
        {diff.addedRows ? <DiffTag tone="add">+{diff.addedRows.toLocaleString('en-US')} {diff.addedRows === 1 ? 'row' : 'rows'}</DiffTag> : null}
        {diff.removedRows ? <DiffTag tone="del">−{diff.removedRows.toLocaleString('en-US')} {diff.removedRows === 1 ? 'row' : 'rows'}</DiffTag> : null}
        <span className={cx('truncate', !!(diff.addedRows || diff.removedRows) && 'max-[720px]:hidden')}>
          {diff.changedCells
            ? `${diff.changedCells.toLocaleString('en-US')} ${diff.changedCells === 1 ? 'cell' : 'cells'} changed · CSV compared by row`
            : diff.addedRows || diff.removedRows
              ? 'CSV compared by row'
              : csvSummary(diff)}
        </span>
      </SummaryBar>
      {!shown.length ? (
        <EmptyState
          art="history"
          className="flex-1"
          title={changesOnly || diff.rows.length ? 'These versions are identical.' : 'Both versions are empty.'}
          body={changesOnly && diff.rows.length ? 'No row or cell differs.' : undefined}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-max min-w-full border-separate border-spacing-0 font-mono text-[12.5px] leading-5">
            <thead className="sticky top-0 z-[1]">
              <tr>
                <th className="w-7 border-b border-r border-vx-hair bg-vx-bg-2" aria-label="Change" />
                {cols.map((c, i) => (
                  <th
                    key={i}
                    className="vx-datahead h-9 whitespace-nowrap border-b border-r border-vx-hair bg-vx-bg-2 px-3 text-left last:border-r-0"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={`${r.status}-${r.key}-${r.aIndex}-${r.bIndex}`}
                  className={cx(r.status === 'add' && 'bg-vx-add-bg', r.status === 'del' && 'bg-vx-del-bg')}
                >
                  <td
                    className={cx(
                      'w-7 border-b border-r border-vx-hair-soft text-center font-mono text-[12px] font-medium',
                      r.status === 'add' ? 'text-vx-add-fg shadow-[inset_2px_0_0_var(--vx-add-fg)]' : r.status === 'del' ? 'text-vx-del-fg shadow-[inset_2px_0_0_var(--vx-del-fg)]' : 'text-vx-text-3',
                    )}
                    aria-label={r.status === 'add' ? 'Added' : r.status === 'del' ? 'Removed' : r.status === 'mod' ? 'Changed' : undefined}
                  >
                    {MARK[r.status]}
                  </td>
                  {r.cells.map((c, i) => (
                    <td
                      key={i}
                      className={cx(
                        'max-w-[420px] border-b border-r border-vx-hair-soft px-3 py-1 align-top last:border-r-0',
                        c.changed && 'bg-vx-mod-bg shadow-[inset_0_0_0_1px_var(--vx-past-edge)]',
                        r.status === 'del' ? 'text-vx-del-fg line-through decoration-1' : r.status === 'same' ? 'text-vx-text-2' : 'text-vx-text-1',
                      )}
                    >
                      {c.changed ? (
                        <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                          <span className="text-vx-text-3 line-through decoration-1">{c.a ?? ''}</span>
                          <span className="px-1.5 text-vx-text-3" aria-label="changed to">
                            →
                          </span>
                          <span className="text-vx-text-1">{c.b ?? ''}</span>
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
          {rows.length > maxRows || colsCut ? (
            <p className="vx-micro px-4 py-3 text-vx-text-3">
              Showing the first{' '}
              {[
                rows.length > maxRows ? `${maxRows.toLocaleString('en-US')} of ${rows.length.toLocaleString('en-US')} rows` : '',
                colsCut ? `${cols.length.toLocaleString('en-US')} of ${diff.totalColumns.toLocaleString('en-US')} columns` : '',
              ]
                .filter(Boolean)
                .join(' and ')}
              .
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default CompareCsv;

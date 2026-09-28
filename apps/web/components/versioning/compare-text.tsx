'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { previewKind, type FileSide } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { ApiError } from '@/lib/api/client';
import { useHotkeys } from '@/lib/keys';
import { errorText } from '@/lib/versioning/hooks';
import { computeTextDiff, diffSummary, foldRows, normalizeText, type Fold, type LineSide, type Seg, type SplitRow, type UnifiedRow } from '@/lib/versioning/text-diff';
import { SummaryBar, type TextMode } from './compare-header';
import { CompareMeta } from './compare-meta';
import './versioning.css';

/** Fetches a side's bytes as text (content URLs at a commit are immutable). */
export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    let code = res.status === 410 ? 'version_gone' : 'internal';
    let message = `Could not load this version (${res.status}).`;
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      code = j.error?.code ?? code;
      message = j.error?.message ?? message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, code, message);
  }
  return res.text();
}

export function useSideText(side: FileSide | null) {
  return useSWR(side ? ['side-text', side.contentUrl] : null, () => fetchText(side!.contentUrl), {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
  });
}

function Segs({ segs, text }: { segs?: Seg[]; text: string }) {
  if (!segs) return <>{text || '​'}</>;
  return (
    <>
      {segs.map((s, i) => (
        <span key={i} className={s.kind === 'add' ? 'vxv-w-add' : s.kind === 'del' ? 'vxv-w-del' : undefined}>
          {s.text}
        </span>
      ))}
      {!text ? '​' : null}
    </>
  );
}

const cellBase = 'vx-code min-w-0 whitespace-pre-wrap px-3 [overflow-wrap:anywhere]';
const gutter = 'vx-code select-none px-2 text-right tabular-nums text-vx-text-4';
const DEL = 'bg-vx-del-bg shadow-[inset_2px_0_0_var(--vx-del-fg)]';
const ADD = 'bg-vx-add-bg shadow-[inset_2px_0_0_var(--vx-add-fg)]';

function SideCells({ side, kind, edge }: { side: LineSide | null; kind: 'same' | 'del' | 'add'; edge?: boolean }) {
  if (!side) {
    return (
      <>
        <span className={cx(gutter, 'bg-vx-surface')} />
        <span className={cx(cellBase, 'bg-vx-surface', edge && 'border-r border-vx-hair')} />
      </>
    );
  }
  const tone = kind === 'del' ? DEL : kind === 'add' ? ADD : '';
  return (
    <>
      <span className={cx(gutter, tone)}>{side.num}</span>
      <span className={cx(cellBase, tone, kind === 'same' ? 'text-vx-text-2' : 'text-vx-text-1', edge && 'border-r border-vx-hair')}>
        <Segs segs={side.segs} text={side.text} />
      </span>
    </>
  );
}

/** Text / code / Markdown / JSON: side-by-side (or unified) line diff with word highlights, folded context, minimap. */
export function CompareText({ a, b, path, mode }: { a: FileSide | null; b: FileSide | null; path: string; mode: TextMode }) {
  const ta = useSideText(a);
  const tb = useSideText(b);
  const loading = (a && ta.isLoading) || (b && tb.isLoading);
  const loadError = ta.error ?? tb.error;
  const json = previewKind(path) === 'json';

  const diff = useMemo(() => {
    if (loading || loadError) return undefined;
    const at = a ? normalizeText(ta.data ?? '', { json }) : '';
    const bt = b ? normalizeText(tb.data ?? '', { json }) : '';
    return computeTextDiff(at, bt);
  }, [loading, loadError, a, b, ta.data, tb.data, json]);

  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [active, setActive] = useState(-1);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setExpanded(new Set());
    setActive(-1);
  }, [diff]);

  const splitItems = useMemo(
    () => (diff ? foldRows<SplitRow>(diff.split, (r) => r.type === 'same', { expanded }) : []),
    [diff, expanded],
  );
  const unifiedItems = useMemo(
    () => (diff ? foldRows<UnifiedRow>(diff.unified, (r) => r.type === 'same', { expanded }) : []),
    [diff, expanded],
  );
  const items = mode === 'split' ? splitItems : unifiedItems;

  // Minimap marks: per change block, its span over the displayed items.
  const marks = useMemo(() => {
    if (!diff) return [];
    const byBlock = new Map<number, { first: number; last: number; del: boolean; add: boolean }>();
    items.forEach((it, k) => {
      if (typeof it !== 'number') return;
      let block: number | undefined;
      let del = false;
      let add = false;
      if (mode === 'split') {
        const r = diff.split[it];
        if (r.type !== 'change') return;
        block = r.block;
        del = !!r.a;
        add = !!r.b;
      } else {
        const r = diff.unified[it];
        if (r.type === 'same') return;
        block = r.block;
        del = r.type === 'del';
        add = r.type === 'add';
      }
      if (block === undefined) return;
      const m = byBlock.get(block) ?? { first: k, last: k, del: false, add: false };
      m.last = k;
      m.del ||= del;
      m.add ||= add;
      byBlock.set(block, m);
    });
    return [...byBlock.entries()].map(([block, m]) => ({ block, ...m }));
  }, [diff, items, mode]);

  const jump = (block: number) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-block-start="${block}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      setActive(block);
    }
  };
  useHotkeys(
    {
      ']': () => diff && diff.blocks && jump(Math.min(diff.blocks - 1, active + 1)),
      '[': () => diff && diff.blocks && jump(Math.max(0, active - 1)),
    },
    { enabled: !!diff && diff.blocks > 0 },
  );

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col" aria-busy>
        <SummaryBar>Comparing…</SummaryBar>
        <div className="grid flex-1 grid-cols-2 gap-px bg-vx-hair">
          {[0, 1].map((k) => (
            <div key={k} className="bg-vx-bg p-4">
              {Array.from({ length: 12 }, (_, i) => (
                <span key={i} className="skeleton skel-line" style={{ width: `${40 + ((i * 37) % 55)}%` }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (loadError) {
    return (
      <EmptyState
        className="flex-1"
        title={loadError instanceof ApiError && loadError.code === 'version_gone' ? 'This version is no longer kept.' : "Couldn't load these versions."}
        body={errorText(loadError)}
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
  if (diff === null) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <SummaryBar>Too many changes to line up line by line</SummaryBar>
        <div className="min-h-0 flex-1 overflow-auto">
          <CompareMeta a={a} b={b} note="These versions differ in too many places to align. Compared by facts instead." />
        </div>
      </div>
    );
  }
  if (!diff) return null;

  const hint = diff.blocks ? (
    <span className="vx-micro text-vx-text-4">
      {active >= 0 ? `change ${active + 1} of ${diff.blocks} · ` : ''}] next · [ previous
    </span>
  ) : null;

  const renderFold = (f: Fold, cols: string) => (
    <button
      key={`fold-${f.start}`}
      type="button"
      onClick={() => setExpanded((s) => new Set(s).add(f.start))}
      className={cx('vx-meta flex h-7 items-center gap-2 border-y border-vx-hair-soft bg-vx-surface px-4 text-left text-vx-text-3 hover:bg-vx-surface-2 hover:text-vx-text-1', cols)}
    >
      <span aria-hidden>⋯</span> {f.count.toLocaleString('en-US')} unchanged {f.count === 1 ? 'line' : 'lines'}
    </button>
  );

  const blockStarts = new Set<number>();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SummaryBar right={hint}>{diff.identical ? 'These versions are identical.' : diffSummary(diff)}</SummaryBar>
      {diff.identical && !diff.split.length ? (
        <EmptyState className="flex-1" title="These versions are identical." body="Both are empty." />
      ) : (
        <div className="relative flex min-h-0 flex-1">
          <div ref={scroller} className="min-h-0 min-w-0 flex-1 overflow-auto">
            {mode === 'split' ? (
              <div className="grid grid-cols-[48px_minmax(0,1fr)_48px_minmax(0,1fr)]">
                <div className="vx-label sticky top-0 z-[1] col-span-2 border-b border-r border-vx-hair bg-vx-surface-2 px-3 py-1.5">
                  A {a ? '' : '· Not present at this version'}
                </div>
                <div className="vx-label sticky top-0 z-[1] col-span-2 border-b border-vx-hair bg-vx-surface-2 px-3 py-1.5">
                  B {b ? '' : '· Not present at this version'}
                </div>
                {splitItems.map((it) => {
                  if (typeof it !== 'number') return renderFold(it, 'col-span-4');
                  const r = diff.split[it];
                  const start = r.type === 'change' && !blockStarts.has(r.block);
                  if (start && r.type === 'change') blockStarts.add(r.block);
                  return (
                    <Fragment key={it}>
                      {start && r.type === 'change' ? <span data-block-start={r.block} className="col-span-4 h-0" /> : null}
                      <SideCells edge side={r.a} kind={r.type === 'same' ? 'same' : 'del'} />
                      <SideCells side={r.b} kind={r.type === 'same' ? 'same' : 'add'} />
                    </Fragment>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-[48px_48px_minmax(0,1fr)]">
                {unifiedItems.map((it) => {
                  if (typeof it !== 'number') return renderFold(it, 'col-span-3');
                  const r = diff.unified[it];
                  const tone = r.type === 'del' ? DEL : r.type === 'add' ? ADD : '';
                  const start = r.block !== undefined && !blockStarts.has(r.block);
                  if (start && r.block !== undefined) blockStarts.add(r.block);
                  return (
                    <Fragment key={it}>
                      {start ? <span data-block-start={r.block} className="col-span-3 h-0" /> : null}
                      <span className={cx(gutter, tone)}>{r.aNum ?? ''}</span>
                      <span className={cx(gutter, tone)}>{r.bNum ?? ''}</span>
                      <span className={cx(cellBase, tone, r.type === 'same' ? 'text-vx-text-2' : 'text-vx-text-1')}>
                        <span aria-hidden className="mr-2 inline-block w-2 text-vx-text-4">
                          {r.type === 'del' ? '−' : r.type === 'add' ? '+' : ' '}
                        </span>
                        <Segs segs={r.segs} text={r.text} />
                      </span>
                    </Fragment>
                  );
                })}
              </div>
            )}
          </div>
          {/* minimap */}
          {marks.length ? (
            <div className="relative w-2 shrink-0 border-l border-vx-hair bg-vx-surface" aria-label="Change map">
              {marks.map((m) => {
                const total = Math.max(1, items.length);
                const top = (m.first / total) * 100;
                const h = Math.max(0.6, ((m.last - m.first + 1) / total) * 100);
                return (
                  <button
                    key={m.block}
                    type="button"
                    tabIndex={-1}
                    aria-label={`Go to change ${m.block + 1}`}
                    onClick={() => jump(m.block)}
                    className="absolute inset-x-0 flex min-h-[3px]"
                    style={{ top: `${top}%`, height: `${h}%` }}
                  >
                    {m.del ? <span className="h-full flex-1" style={{ background: 'var(--vx-del-fg)' }} /> : null}
                    {m.add ? <span className="h-full flex-1" style={{ background: 'var(--vx-add-fg)' }} /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default CompareText;

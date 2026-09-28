'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { previewKind, type FileSide } from '@volumes/shared';
import { ArrowRight, ChevronsUpDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { ApiError } from '@/lib/api/client';
import { formatTimeTravelLabel } from '@/lib/format';
import { useHotkeys } from '@/lib/keys';
import { errorText } from '@/lib/versioning/hooks';
import { computeTextDiff, foldRows, normalizeText, type Fold, type LineSide, type Seg, type SplitRow, type UnifiedRow } from '@/lib/versioning/text-diff';
import { SideDisc, SummaryBar, type TextMode } from './compare-header';
import { CompareMeta } from './compare-meta';
import { Bytes } from './readout';
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
  if (!segs) return <>{text || '\u200b'}</>;
  return (
    <>
      {segs.map((s, i) => (
        <span key={i} className={s.kind === 'add' ? 'vxv-w-add' : s.kind === 'del' ? 'vxv-w-del' : undefined}>
          {s.text}
        </span>
      ))}
      {!text ? '\u200b' : null}
    </>
  );
}

const cellBase = 'min-w-0 whitespace-pre-wrap pr-3 font-mono text-[13px] leading-[22px] [overflow-wrap:anywhere]';
const gutter = 'select-none pr-3 text-right font-mono text-[12px] leading-[22px] tabular-nums';
const DEL = 'bg-vx-del-bg';
const ADD = 'bg-vx-add-bg';
const DEL_RULE = 'shadow-[inset_3px_0_0_var(--vx-del-fg)]';
const ADD_RULE = 'shadow-[inset_3px_0_0_var(--vx-add-fg)]';

function SideCells({ side, kind, edge }: { side: LineSide | null; kind: 'same' | 'del' | 'add'; edge?: boolean }) {
  if (!side) {
    return (
      <>
        <span className="vxv-filler" />
        <span className={cx('vxv-filler', edge && 'border-r border-vx-hair')} />
      </>
    );
  }
  const tone = kind === 'del' ? DEL : kind === 'add' ? ADD : '';
  const rule = kind === 'del' ? DEL_RULE : kind === 'add' ? ADD_RULE : '';
  const num = kind === 'del' ? 'text-vx-del-fg' : kind === 'add' ? 'text-vx-add-fg' : 'text-vx-text-4';
  return (
    <>
      <span className={cx(gutter, tone, rule, num)}>{side.num}</span>
      <span className={cx(cellBase, tone, kind === 'same' ? 'text-vx-text-2' : 'text-vx-text-1', edge && 'border-r border-vx-hair')}>
        <Segs segs={side.segs} text={side.text} />
      </span>
    </>
  );
}

/** Pane header (36 px, surface-2): side disc, date, size — or "Not present at this version". */
function PaneHead({ which, side, edge, className }: { which: 'A' | 'B'; side: FileSide | null; edge?: boolean; className?: string }) {
  return (
    <div
      className={cx(
        'sticky top-0 z-[1] flex h-9 min-w-0 items-center gap-2 border-b border-vx-hair bg-vx-surface-2 px-4 text-[12px] leading-4 text-vx-text-3',
        edge && 'border-r',
        className,
      )}
    >
      <SideDisc which={which} />
      {side ? (
        <>
          <span className="truncate font-semibold tabular-nums text-vx-text-1">{formatTimeTravelLabel(side.createdAt)}</span>
          <span aria-hidden>·</span>
          <Bytes n={side.size} />
        </>
      ) : (
        <span className="truncate">Not present at this version</span>
      )}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { markdown: 'Markdown', json: 'JSON', code: 'Code', text: 'Text', csv: 'CSV' };

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
        <div className="grid flex-1 grid-cols-2 gap-px bg-vx-hair-soft max-[720px]:grid-cols-1">
          {[0, 1].map((k) => (
            <div key={k} className="bg-vx-surface p-5">
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

  const kindLabel = KIND_LABEL[previewKind(path)] ?? 'Text';
  const summary = diff.identical ? (
    <span className="truncate">These versions are identical.</span>
  ) : (
    <>
      {diff.added ? <Badge tone="add">+{diff.added.toLocaleString('en-US')} {diff.added === 1 ? 'line' : 'lines'}</Badge> : null}
      {diff.removed ? <Badge tone="del">−{diff.removed.toLocaleString('en-US')} {diff.removed === 1 ? 'line' : 'lines'}</Badge> : null}
      <span className="truncate">
        {diff.blocks.toLocaleString('en-US')} {diff.blocks === 1 ? 'change' : 'changes'} · {kindLabel} compared as text
      </span>
    </>
  );
  const nav = diff.blocks ? (
    <>
      <span className="whitespace-nowrap tabular-nums max-[720px]:hidden">
        {`Change ${Math.max(0, active) + 1} of ${diff.blocks}`}
      </span>
      <Button size="sm" variant="outline" kbd="[" disabled={active <= 0} onClick={() => jump(Math.max(0, active - 1))}>
        Previous
      </Button>
      <Button size="sm" variant="outline" kbd="]" disabled={active >= diff.blocks - 1} onClick={() => jump(Math.min(diff.blocks - 1, active + 1))}>
        Next
      </Button>
    </>
  ) : null;

  const renderFold = (f: Fold, cols: string) => (
    <div key={`fold-${f.start}`} className={cx('flex h-8 items-center justify-center', cols)}>
      <button
        type="button"
        onClick={() => setExpanded((s) => new Set(s).add(f.start))}
        className="inline-flex h-7 items-center gap-1.5 rounded-full bg-vx-surface-3 px-3 text-[12px] font-medium leading-4 text-vx-text-2 transition-colors duration-[120ms] hover:bg-vx-pressed hover:text-vx-text-1"
      >
        <ChevronsUpDown size={14} strokeWidth={1.75} aria-hidden />
        {f.count.toLocaleString('en-US')} unchanged {f.count === 1 ? 'line' : 'lines'}
      </button>
    </div>
  );

  const blockStarts = new Set<number>();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SummaryBar right={nav}>{summary}</SummaryBar>
      {diff.identical && !diff.split.length ? (
        <EmptyState className="flex-1" title="These versions are identical." body="Both are empty." />
      ) : (
        <div className="relative flex min-h-0 flex-1">
          <div ref={scroller} className="min-h-0 min-w-0 flex-1 overflow-auto">
            {mode === 'split' ? (
              <div className="grid grid-cols-[48px_minmax(0,1fr)_48px_minmax(0,1fr)] pb-4">
                <PaneHead which="A" side={a} edge className="col-span-2" />
                <PaneHead which="B" side={b} className="col-span-2" />
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
              <div className="grid grid-cols-[44px_44px_minmax(0,1fr)] pb-4">
                <div className="sticky top-0 z-[1] col-span-3 flex h-9 min-w-0 items-center gap-2 border-b border-vx-hair bg-vx-surface-2 px-4 text-[12px] leading-4 text-vx-text-3">
                  <SideDisc which="A" />
                  <span className="truncate font-semibold tabular-nums text-vx-text-1">{a ? formatTimeTravelLabel(a.createdAt) : 'Not present'}</span>
                  <ArrowRight size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
                  <SideDisc which="B" />
                  <span className="truncate font-semibold tabular-nums text-vx-text-1">{b ? formatTimeTravelLabel(b.createdAt) : 'Not present'}</span>
                </div>
                {unifiedItems.map((it) => {
                  if (typeof it !== 'number') return renderFold(it, 'col-span-3');
                  const r = diff.unified[it];
                  const tone = r.type === 'del' ? DEL : r.type === 'add' ? ADD : '';
                  const rule = r.type === 'del' ? DEL_RULE : r.type === 'add' ? ADD_RULE : '';
                  const num = r.type === 'del' ? 'text-vx-del-fg' : r.type === 'add' ? 'text-vx-add-fg' : 'text-vx-text-4';
                  const start = r.block !== undefined && !blockStarts.has(r.block);
                  if (start && r.block !== undefined) blockStarts.add(r.block);
                  return (
                    <Fragment key={it}>
                      {start ? <span data-block-start={r.block} className="col-span-3 h-0" /> : null}
                      <span className={cx(gutter, tone, rule, num)}>{r.aNum ?? ''}</span>
                      <span className={cx(gutter, tone, num)}>{r.bNum ?? ''}</span>
                      <span className={cx(cellBase, tone, r.type === 'same' ? 'text-vx-text-2' : 'text-vx-text-1')}>
                        <span aria-hidden className={cx('mr-2 inline-block w-2', num)}>
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
            <div className="relative w-3 shrink-0 border-l border-vx-hair-soft bg-vx-surface-2" aria-label="Change map">
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
                    className="absolute inset-x-[3px] flex min-h-1 flex-col gap-px"
                    // Proportional for long diffs; a short diff maps 1:1 onto its 22 px lines instead of stretching to the column.
                    style={{ top: `min(${top}%, ${m.first * 22}px)`, height: `min(${h}%, ${(m.last - m.first + 1) * 22}px)` }}
                  >
                    {m.del ? <span className="min-h-0.5 w-full flex-1 rounded-[2px] bg-vx-del-fg" /> : null}
                    {m.add ? <span className="min-h-0.5 w-full flex-1 rounded-[2px] bg-vx-add-fg" /> : null}
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

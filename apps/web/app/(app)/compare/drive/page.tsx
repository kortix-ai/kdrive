'use client';

// /compare/drive?a=&b= — what changed in the whole drive between two versions (DESIGN.md §6.7).
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { DriveCompareList } from '@/components/versioning/drive-compare-list';
import { CommitId } from '@/components/versioning/readout';
import { RetentionNote } from '@/components/versioning/retention-note';
import { formatTimeTravelLabel } from '@/lib/format';
import { useHotkeys } from '@/lib/keys';
import { useVx } from '@/lib/store';
import { errorText, isGone, useDriveCompare, useTimelineEntries } from '@/lib/versioning/hooks';

function Point({ which, commitId, createdAt, isNow }: { which: 'A' | 'B'; commitId: string; createdAt: string | null; isNow: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex h-7 items-center gap-1.5 border px-2 font-mono text-[11.5px] tabular-nums',
        isNow ? 'border-vx-hair text-vx-text-1' : 'border-vx-past-edge text-vx-past',
      )}
    >
      <span className="text-vx-text-4">{which}</span>
      <CommitId id={commitId} />
      <span className="opacity-70">· {isNow ? 'now' : createdAt ? formatTimeTravelLabel(createdAt) : '…'}</span>
    </span>
  );
}

function CompareDrive() {
  const sp = useSearchParams();
  const router = useRouter();
  const a = sp.get('a');
  const b = sp.get('b');
  const closePanel = useVx((s) => s.closePanel);
  const openRestore = useVx((s) => s.openRestore);
  const { headCommitId } = useTimelineEntries();
  const { data, error, isLoading, mutate } = useDriveCompare(a, b);

  useEffect(() => closePanel(), [closePanel]);
  const back = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push('/drive');
  };
  useHotkeys({ escape: back });

  if (!a || !b) {
    return <EmptyState className="h-full" title="Pick two versions to compare." body="Shift-click two points on the timeline, or use Compare with now while viewing the past." />;
  }

  const counts = data
    ? (['added', 'changed', 'moved', 'removed'] as const).map((op) => ({ op, n: data.changes.filter((c) => c.op === op).length })).filter((x) => x.n)
    : [];
  const aNow = !!data && (data.a.commitId === headCommitId || a === 'head');
  const bNow = !!data && (data.b.commitId === headCommitId || b === 'head');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-vx-hair px-3">
        <button
          type="button"
          onClick={back}
          aria-label="Close compare (Esc)"
          title="Close (Esc)"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center font-mono text-[12px] text-vx-text-3 hover:bg-vx-surface-2 hover:text-vx-text-1"
        >
          ✕
        </button>
        <span className="vx-title">Compare drive</span>
        {data ? (
          <div className="flex items-center gap-1.5">
            <Point which="A" commitId={data.a.commitId} createdAt={data.a.createdAt} isNow={aNow} />
            <span className="font-mono text-[12px] text-vx-text-4">→</span>
            <Point which="B" commitId={data.b.commitId} createdAt={data.b.createdAt} isNow={bNow} />
          </div>
        ) : null}
      </header>
      <div className="vx-meta flex h-7 shrink-0 items-center gap-3 border-b border-vx-hair bg-vx-surface px-4 text-vx-text-3">
        <span className="min-w-0 flex-1 truncate">
          {isLoading
            ? 'Comparing…'
            : data
              ? counts.length
                ? counts.map((c) => `${c.n.toLocaleString('en-US')} ${c.op}`).join(' · ')
                : 'No differences'
              : ''}
        </span>
        {data?.source === 'tree' ? <span className="vx-micro text-vx-text-4">Worked out by listing both versions (some changes happened outside the app)</span> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="px-6 py-4" aria-busy>
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} className="skeleton skel-line" style={{ width: `${35 + ((i * 31) % 55)}%` }} />
            ))}
          </div>
        ) : error ? (
          isGone(error) ? (
            <EmptyState title="This version is no longer kept." body={<RetentionNote as="span" className="!text-[14px]" />} actions={<Button onClick={back}>Back</Button>} />
          ) : (
            <EmptyState title="Couldn't compare these versions." body={errorText(error)} actions={<Button onClick={() => void mutate()}>Retry</Button>} />
          )
        ) : data && !data.changes.length ? (
          <EmptyState title="These versions are identical." body="Nothing was added, removed, changed or moved between them." />
        ) : data ? (
          <DriveCompareList changes={data.changes} a={data.a.commitId} b={data.b.commitId} />
        ) : null}
      </div>
      {data && data.changes.length ? (
        <div className="flex h-12 shrink-0 items-center justify-between border-t border-vx-hair px-6">
          <RetentionNote as="span" />
          <Button
            variant="restore"
            disabled={aNow}
            title={aNow ? 'A is the current version' : 'Restore the whole drive to A'}
            onClick={() => openRestore({ scope: 'drive', at: data.a.commitId })}
          >
            Restore drive to A
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default function CompareDrivePage() {
  return (
    <Suspense fallback={null}>
      <CompareDrive />
    </Suspense>
  );
}

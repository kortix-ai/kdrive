'use client';

// /compare/drive?a=&b= — what changed in the whole drive between two versions (DESIGN-v2 §6.7).
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { DriveChange } from '@volumes/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { SidePill } from '@/components/versioning/compare-header';
import { DriveCompareList } from '@/components/versioning/drive-compare-list';
import { RetentionNote } from '@/components/versioning/retention-note';
import { useHotkeys } from '@/lib/keys';
import { useVx } from '@/lib/store';
import { errorText, isGone, useDriveCompare, useTimelineEntries } from '@/lib/versioning/hooks';

const OP_LABEL: Record<DriveChange['op'], string> = { added: 'Added', changed: 'Changed', moved: 'Moved', removed: 'Removed' };

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
    return <EmptyState className="h-full" title="Pick two versions to compare." body="Shift-click two dots on the history strip, or use Compare with now while viewing the past." />;
  }

  const counts = data
    ? (['added', 'changed', 'moved', 'removed'] as const).map((op) => ({ op, n: data.changes.filter((c) => c.op === op).length })).filter((x) => x.n)
    : [];
  const aNow = !!data && (data.a.commitId === headCommitId || a === 'head');
  const bNow = !!data && (data.b.commitId === headCommitId || b === 'head');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-vx-hair py-3 pl-2 pr-4 min-[721px]:h-16 min-[721px]:flex-nowrap min-[721px]:py-0">
        <Tooltip label="Back" kbd="Esc" side="bottom">
          <IconButton label="Close compare (Esc)" nativeTitle={false} onClick={back}>
            <ArrowLeft size={20} strokeWidth={1.75} aria-hidden />
          </IconButton>
        </Tooltip>
        <span className="min-w-0 flex-1 truncate text-[20px] font-semibold leading-[26px] tracking-[-0.015em] text-vx-text-1 min-[721px]:flex-none">Compare drive</span>
        {data ? (
          <div className="flex shrink-0 items-center gap-1.5 max-[720px]:w-full max-[720px]:flex-col max-[720px]:items-stretch">
            <SidePill which="A" commitId={data.a.commitId} createdAt={data.a.createdAt} isNow={aNow} />
            <ArrowRight size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-vx-text-4 max-[720px]:rotate-90 max-[720px]:self-center" />
            <SidePill which="B" commitId={data.b.commitId} createdAt={data.b.createdAt} isNow={bNow} />
          </div>
        ) : null}
      </header>
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-vx-hair px-5 py-2 text-[13px] leading-5 text-vx-text-3 max-[720px]:px-4">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {isLoading ? (
            'Comparing…'
          ) : data ? (
            counts.length ? (
              counts.map((c) => (
                <Badge key={c.op} tone={c.op === 'added' ? 'add' : c.op === 'removed' ? 'del' : 'neutral'}>
                  {OP_LABEL[c.op]} {c.n.toLocaleString('en-US')}
                </Badge>
              ))
            ) : (
              'No differences'
            )
          ) : null}
        </span>
        {data?.source === 'tree' ? <span className="vx-micro text-vx-text-3">Worked out by listing both versions (some changes happened outside the app)</span> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="px-5 py-5" aria-busy>
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="flex h-10 items-center gap-3">
                <span className="skeleton h-5 w-5 shrink-0" />
                <span className="skeleton skel-line" style={{ width: `${35 + ((i * 31) % 55)}%` }} />
              </div>
            ))}
          </div>
        ) : error ? (
          isGone(error) ? (
            <EmptyState
              tone="past"
              title="This version is no longer kept."
              body={<RetentionNote as="span" className="!text-[16px] !leading-6" />}
              actions={
                <Button variant="primary" onClick={back}>
                  Back
                </Button>
              }
            />
          ) : (
            <EmptyState
              tone="past"
              title="Couldn't compare these versions."
              body={errorText(error)}
              actions={
                <Button variant="tonal" onClick={() => void mutate()}>
                  Retry
                </Button>
              }
            />
          )
        ) : data && !data.changes.length ? (
          <EmptyState title="These versions are identical." body="Nothing was added, removed, changed or moved between them." />
        ) : data ? (
          <DriveCompareList changes={data.changes} a={data.a.commitId} b={data.b.commitId} />
        ) : null}
      </div>
      {data && data.changes.length ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-vx-hair px-5 py-3 max-[720px]:px-4">
          <RetentionNote as="span" className="min-w-0 flex-1" />
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

'use client';

// /compare?path=&a=&b= — compare two versions of one file (DESIGN-v2 §6.7).
import { Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { dirname, TEXT_DIFF_MAX_BYTES, formatBytes } from '@volumes/shared';
import { Button, buttonClass } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { CompareCsv } from '@/components/versioning/compare-csv';
import { CompareHeader, SummaryBar, type CompareModes } from '@/components/versioning/compare-header';
import { CompareImage } from '@/components/versioning/compare-image';
import { CompareMeta } from '@/components/versioning/compare-meta';
import { CompareText } from '@/components/versioning/compare-text';
import { RetentionNote } from '@/components/versioning/retention-note';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { useHotkeys } from '@/lib/keys';
import { useVx } from '@/lib/store';
import { compareHref, driveHref } from '@/lib/urls';
import { errorText, isGone, useFileVersions, useTimelineEntries } from '@/lib/versioning/hooks';

/** Phones (≤ 720 px) force the unified text diff. */
function usePhone(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(max-width: 720px)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia('(max-width: 720px)').matches,
    () => false,
  );
}

function CompareFile() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = sp.get('path') ?? '';
  const refA = sp.get('a') ?? '';
  const refB = sp.get('b') ?? '';
  const ws = useVx((s) => s.workspaceId);
  const closePanel = useVx((s) => s.closePanel);
  const openRestore = useVx((s) => s.openRestore);
  const [modes, setModes] = useState<CompareModes>({ text: 'split', image: 'side', changesOnly: false });
  const phone = usePhone();

  useEffect(() => closePanel(), [closePanel]);

  const ready = !!ws && !!path && !!refA && !!refB;
  const cmp = useSWR(ready ? ['compare-file', ws, path, refA, refB] : null, () => api.versioning.compareFile(ws!, { path, a: refA, b: refB }), {
    revalidateOnFocus: false,
    shouldRetryOnError: (e: unknown) => !(e instanceof ApiError && e.status < 500),
  });
  const versions = useFileVersions(ready ? path : null);
  const { headCommitId } = useTimelineEntries();
  const current = versions.data?.versions.find((v) => v.isCurrent)?.commitId ?? null;
  const isNow = (ref: string, sideCommit?: string) =>
    ref === 'head' || (!!headCommitId && (ref === headCommitId || sideCommit === headCommitId)) || (!!current && (ref === current || sideCommit === current));

  const back = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push(driveHref(path ? dirname(path) : '/'));
  };
  const swap = () => router.replace(compareHref(path, refB, refA));
  const pick = (which: 'a' | 'b', commitId: string) =>
    router.replace(which === 'a' ? compareHref(path, commitId, refB) : compareHref(path, refA, commitId));

  useHotkeys({ escape: back, x: () => ready && swap() });

  if (!path || !refA || !refB) {
    return (
      <EmptyState
        className="h-full"
        title="Pick two versions to compare."
        body="Open a file's Versions tab, choose A and B, then Compare."
        actions={
          <Link href="/drive" className={buttonClass('tonal')}>
            Go to drive
          </Link>
        }
      />
    );
  }

  const d = cmp.data;
  const a = d?.a ?? null;
  const b = d?.b ?? null;
  const kind = d?.kind ?? null;

  let body: React.ReactNode;
  if (cmp.error) {
    body = isGone(cmp.error) ? (
      <EmptyState
        tone="past"
        className="flex-1"
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
        className="flex-1"
        title={cmp.error instanceof ApiError && cmp.error.status === 404 ? 'This file is not in either version.' : "Couldn't compare these versions."}
        body={errorText(cmp.error)}
        tone="past"
        actions={
          <Button variant="tonal" onClick={() => void cmp.mutate()}>
            Retry
          </Button>
        }
      />
    );
  } else if (!d) {
    body = (
      <div className="flex min-h-0 flex-1 flex-col" aria-busy>
        <SummaryBar>Loading versions…</SummaryBar>
        <div className="grid flex-1 grid-cols-2 gap-px bg-vx-hair-soft max-[720px]:grid-cols-1">
          {[0, 1].map((k) => (
            <div key={k} className="bg-vx-surface p-5">
              {Array.from({ length: 10 }, (_, i) => (
                <span key={i} className="skeleton skel-line" style={{ width: `${45 + ((i * 29) % 50)}%` }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  } else if (!a && !b) {
    body = <EmptyState tone="past" className="flex-1" title="Neither version has this file." body="It did not exist at either point." />;
  } else if (d.tooLargeForDiff && (kind === 'text' || kind === 'csv')) {
    body = (
      <div className="min-h-0 flex-1 overflow-auto">
        <CompareMeta a={a} b={b} note={`Files over ${formatBytes(TEXT_DIFF_MAX_BYTES)} are compared by facts only.`} />
      </div>
    );
  } else if (kind === 'text') {
    body = <CompareText a={a} b={b} path={path} mode={phone ? 'unified' : modes.text} />;
  } else if (kind === 'image') {
    body = <CompareImage a={a} b={b} mode={modes.image} />;
  } else if (kind === 'csv') {
    body = <CompareCsv a={a} b={b} path={path} changesOnly={modes.changesOnly} />;
  } else {
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        <SummaryBar>
          <span className="truncate tabular-nums">{a && b ? `${formatBytes(a.size)} → ${formatBytes(b.size)} · compared by facts` : a ? 'Only in A' : 'Only in B'}</span>
        </SummaryBar>
        <div className="min-h-0 flex-1 overflow-auto">
          <CompareMeta a={a} b={b} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CompareHeader
        path={path}
        kind={kind}
        a={a}
        b={b}
        refA={refA}
        refB={refB}
        aIsNow={isNow(refA, a?.commitId)}
        bIsNow={isNow(refB, b?.commitId)}
        versions={versions.data?.versions ?? []}
        modes={modes}
        onModes={setModes}
        onClose={back}
        onSwap={swap}
        onPick={pick}
        onRestoreA={() => a && openRestore({ scope: 'file', path, at: refA })}
      />
      {body}
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={null}>
      <CompareFile />
    </Suspense>
  );
}

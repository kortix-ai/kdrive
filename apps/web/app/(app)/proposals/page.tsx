'use client';

// /proposals — changes AI agents suggested for the current workspace (MCP.md §14.6).
// A sheet like /checkpoints: the head, tabs Waiting | Decided, rows that open the review page.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ProposalSummary } from '@volumes/shared';
import { mergePages } from '@/components/proposals/format';
import { ProposalRow } from '@/components/proposals/proposal-row';
import { Button, buttonClass } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api/endpoints';
import { useProposalCount, useProposals } from '@/lib/api/hooks';
import { useVx } from '@/lib/store';
import { errorText } from '@/lib/versioning/hooks';

type Tab = 'open' | 'closed';

function ProposalList({ tab }: { tab: Tab }) {
  const ws = useVx((s) => s.workspaceId);
  const { data, error, isLoading, mutate } = useProposals(tab);
  const [more, setMore] = useState<{ items: ProposalSummary[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  // A new first page (workspace switch, revalidation) starts the paging over.
  useEffect(() => {
    setMore(null);
    setMoreError(null);
  }, [data, ws]);

  const list = useMemo(() => mergePages(data?.proposals ?? [], more?.items ?? []), [data, more]);
  const cursor = more ? more.cursor : (data?.nextCursor ?? null);

  const loadMore = async () => {
    if (!ws || !cursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const r = await api.proposals.list(ws, { status: tab, before: cursor });
      setMore((m) => ({ items: [...(m?.items ?? []), ...r.proposals], cursor: r.nextCursor }));
    } catch (e) {
      setMoreError(errorText(e));
    } finally {
      setLoadingMore(false);
    }
  };

  if (isLoading || (!data && !error)) {
    return (
      <div aria-busy className="pt-2">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex h-14 items-center gap-3 px-3">
            <span className="skeleton h-8 w-8 shrink-0 !rounded-full" />
            <span className="flex flex-1 flex-col gap-1.5">
              <span className="skeleton skel-line w-2/3" />
              <span className="skeleton skel-line w-1/3" />
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <EmptyState
        tone="past"
        title="Couldn't load proposals."
        body={errorText(error)}
        actions={
          <Button variant="tonal" onClick={() => void mutate()}>
            Retry
          </Button>
        }
      />
    );
  }
  if (!list.length) {
    return tab === 'open' ? (
      <EmptyState
        title="Nothing to review"
        body="When an agent connected in review mode suggests changes, they wait here until you accept or discard them."
        actions={
          <Link href="/settings/agents" className={buttonClass('tonal')}>
            Connect an agent
          </Link>
        }
      />
    ) : (
      <EmptyState title="Nothing decided yet" body="Proposals you accept or discard, and ones that expire, are listed here." />
    );
  }
  return (
    <>
      <ul aria-label={tab === 'open' ? 'Waiting for review' : 'Decided'} className="flex flex-col gap-0.5 pt-2">
        {list.map((p) => (
          <li key={p.id}>
            <ProposalRow proposal={p} />
          </li>
        ))}
      </ul>
      {cursor ? (
        <div className="mt-4 flex flex-col items-center gap-2">
          <Button variant="outline" loading={loadingMore} onClick={() => void loadMore()}>
            Load more
          </Button>
          {moreError ? <p className="vx-meta text-vx-del-fg">{moreError}</p> : null}
        </div>
      ) : null}
    </>
  );
}

export default function ProposalsPage() {
  const ws = useVx((s) => s.workspaceId);
  const wsName = useVx((s) => s.me?.workspaces.find((w) => w.id === s.workspaceId)?.name ?? null);
  const count = useProposalCount();
  const [tab, setTab] = useState<Tab>('open');

  // Switching workspaces returns to the waiting list.
  useEffect(() => setTab('open'), [ws]);

  return (
    <div className="mx-auto w-full max-w-[960px] px-6 pb-10 pt-6 max-[720px]:px-4">
      <header>
        <h1 className="vx-h1">Proposals</h1>
        <p className="vx-body mt-2 max-w-[640px] text-vx-text-3">
          Changes AI agents suggested for {wsName ? <span className="font-medium text-vx-text-2">{wsName}</span> : 'this workspace'}
        </p>
      </header>
      <Tabs<Tab>
        className="mt-5"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'open', label: 'Waiting', count: count.data?.open ?? undefined },
          { id: 'closed', label: 'Decided' },
        ]}
      />
      <div role="tabpanel" className="mt-2">
        <ProposalList key={`${ws}:${tab}`} tab={tab} />
      </div>
    </div>
  );
}

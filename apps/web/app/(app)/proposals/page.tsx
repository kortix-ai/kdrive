'use client';

// /proposals: changes AI agents suggested for the current workspace (UNIFY-SPEC §14.4).
// The work sheet: the head, tabs Waiting | Decided on a full-bleed hair rule, full-bleed rows that open the review page.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ProposalSummary } from '@volumes/shared';
import { mergePages } from '@/components/proposals/format';
import { ProposalRow } from '@/components/proposals/proposal-row';
import { Button, buttonClass } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Page, PageHeader } from '@/components/ui/page';
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
          <div key={i} className="flex h-14 items-center gap-3 border-b border-vx-hair-soft px-3">
            <span className="skeleton h-8 w-8 shrink-0 !rounded-vx-sm" />
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
        art="gone"
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
        art="proposals"
        title="Nothing to review"
        body="When an agent connected in review mode suggests changes, they wait here until you accept or discard them."
        actions={
          <Link href="/settings/agents" className={buttonClass('tonal')}>
            Connect an agent
          </Link>
        }
      />
    ) : (
      <EmptyState art="proposals" title="Nothing decided yet" body="Proposals you accept or discard, and ones that expire, are listed here." />
    );
  }
  return (
    <>
      <ul aria-label={tab === 'open' ? 'Waiting for review' : 'Decided'} className="flex flex-col">
        {list.map((p) => (
          <li key={p.id} className="border-b border-vx-hair-soft">
            <ProposalRow proposal={p} />
          </li>
        ))}
      </ul>
      {cursor ? (
        <div className="mt-4 flex flex-col items-center gap-2">
          <Button variant="outline" loading={loadingMore} onClick={() => void loadMore()}>
            Load more
          </Button>
          {moreError ? <p className="vx-micro text-vx-danger">{moreError}</p> : null}
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
    <Page>
      <PageHeader
        eyebrow="AI agents"
        title="Proposals"
        lead={<>Changes AI agents suggested for {wsName ? <span className="font-medium text-vx-text-2">{wsName}</span> : 'this drive'}</>}
      />
      <Tabs<Tab>
        className="mt-5"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'open', label: 'Waiting', count: count.data?.open ?? undefined },
          { id: 'closed', label: 'Decided' },
        ]}
      />
      <div role="tabpanel">
        <ProposalList key={`${ws}:${tab}`} tab={tab} />
      </div>
    </Page>
  );
}

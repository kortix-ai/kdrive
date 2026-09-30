'use client';

// One proposal under review (MCP.md §14.7): a full-height sheet with the head (agent, message,
// Accept / Discard), the conflict bar, the file list (320) and the compare pane. On phones the
// list comes first and the pane opens as a full-screen sheet.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import { formatBytes } from '@volumes/shared';
import { AgentBadge } from '@/components/agents/agent-badge';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { CommitId, When } from '@/components/versioning/readout';
import { ApiError } from '@/lib/api/client';
import { useProposal } from '@/lib/api/hooks';
import { useHotkeys } from '@/lib/keys';
import { useVx } from '@/lib/store';
import { errorText } from '@/lib/versioning/hooks';
import { ConflictBar } from './conflict-bar';
import { proposalTitle, statusBadge } from './format';
import { AgentDisc } from './proposal-row';
import { ReviewFileList } from './review-file-list';
import { ReviewPane } from './review-pane';
import { useReviewActions } from './use-review-actions';

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

export function ProposalReview({ id }: { id: string }) {
  const router = useRouter();
  const ws = useVx((s) => s.workspaceId);
  const { data, error, isLoading, mutate } = useProposal(id);
  const phone = usePhone();
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const [paneOpen, setPaneOpen] = useState(false);

  const proposal = data?.proposal ?? null;
  const files = useMemo(() => data?.files ?? [], [data]);
  const after = useCallback(() => void mutate(), [mutate]);
  const { busy, stale, quota, accept, discard, clearQuota } = useReviewActions(ws, proposal, after);

  // Keep the selection on a real row: the first one by default.
  useEffect(() => {
    if (!files.length) return;
    if (selected === null || !files.some((f) => f.seq === selected)) setSelected(files[0].seq);
  }, [files, selected]);
  // Ticks only ever name pending rows.
  useEffect(() => {
    setChecked((cur) => {
      const pending = new Set(files.filter((f) => f.status === 'pending').map((f) => f.seq));
      const next = new Set([...cur].filter((s) => pending.has(s)));
      return next.size === cur.size ? cur : next;
    });
  }, [files]);

  const back = useCallback(() => {
    if (phone && paneOpen) setPaneOpen(false);
    else router.push('/proposals');
  }, [phone, paneOpen, router]);
  useHotkeys({ escape: back });

  const stalePaths = useMemo(() => new Set(stale?.paths ?? []), [stale]);
  const conflicted = useMemo(
    () => files.filter((f) => f.status === 'pending' && (f.conflict || stalePaths.has(f.path) || (f.fromPath && stalePaths.has(f.fromPath)))),
    [files, stalePaths],
  );
  const conflictCount = Math.max(data?.conflicts ?? 0, conflicted.length, stale?.count ?? 0);
  const shown = onlyConflicts && conflicted.length ? conflicted : files;
  const open = proposal?.status === 'open';
  const ticked = [...checked].sort((x, y) => x - y);
  const seqs = ticked.length ? ticked : undefined;
  const current = files.find((f) => f.seq === selected) ?? null;

  if (error && !data) {
    const gone = error instanceof ApiError && error.status === 404;
    return (
      <EmptyState
        className="h-full"
        tone="past"
        title={gone ? 'This proposal no longer exists' : "Couldn't load this proposal."}
        body={gone ? 'It may belong to another workspace, or it was removed with its workspace.' : errorText(error)}
        actions={
          gone ? (
            <Link href="/proposals" className={buttonClass('outline')}>
              Back to proposals
            </Link>
          ) : (
            <Button variant="tonal" onClick={() => void mutate()}>
              Retry
            </Button>
          )
        }
      />
    );
  }
  if (isLoading || !data || !proposal) {
    return (
      <div className="flex h-full flex-col" aria-busy>
        <div className="flex h-16 items-center gap-3 border-b border-vx-hair px-3">
          <span className="skeleton h-8 w-8 !rounded-full" />
          <span className="skeleton skel-line w-72" />
        </div>
        <div className="p-5">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="skeleton skel-line" style={{ width: `${40 + ((i * 23) % 50)}%` }} />
          ))}
        </div>
      </div>
    );
  }

  const title = proposalTitle(proposal);
  const state = statusBadge(proposal.status);
  const select = (seq: number) => {
    setSelected(seq);
    if (phone) setPaneOpen(true);
  };

  const pane = (
    <ReviewPane
      file={current}
      phone={phone}
      busy={!!busy}
      onAccept={open ? (seq) => void accept([seq]) : undefined}
      onDiscard={open ? (seq) => void discard([seq]) : undefined}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-vx-hair py-3 pl-2 pr-3 max-[720px]:pr-4 min-[721px]:h-16 min-[721px]:flex-nowrap min-[721px]:py-0">
        <Tooltip label="Back to proposals" kbd="Esc" side="bottom">
          <IconButton label="Back to proposals (Esc)" nativeTitle={false} onClick={() => router.push('/proposals')}>
            <ArrowLeft size={20} strokeWidth={1.75} aria-hidden />
          </IconButton>
        </Tooltip>
        <AgentDisc className="max-[720px]:hidden" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-[20px] font-semibold leading-[26px] tracking-[-0.015em] text-vx-text-1" title={title}>
            {title}
          </h1>
          <span className="vx-meta flex min-w-0 items-center gap-1.5 text-vx-text-3">
            <AgentBadge agent={proposal.agent} />
            <span aria-hidden>·</span>
            <When at={proposal.createdAt} friendly className="shrink-0" />
            <span aria-hidden className="max-[720px]:hidden">·</span>
            <span className="truncate max-[720px]:hidden">
              based on <CommitId id={proposal.baseCommitId} />
            </span>
          </span>
        </div>
        {state ? (
          <Badge tone={state.tone} pip={proposal.status === 'accepted'}>
            {state.label}
          </Badge>
        ) : null}
        {open ? (
          <div className="flex shrink-0 items-center gap-2 max-[720px]:w-full max-[720px]:justify-end">
            <Button variant="text" disabled={!!busy} loading={busy === 'discard'} onClick={() => void discard(seqs)}>
              {seqs ? `Discard ${seqs.length} selected` : 'Discard all'}
            </Button>
            <Button variant="primary" disabled={!!busy} loading={busy === 'accept'} onClick={() => void accept(seqs)}>
              {seqs ? `Accept ${seqs.length} selected` : 'Accept all'}
            </Button>
          </div>
        ) : null}
      </header>

      {open && (conflictCount > 0 || stale) ? (
        <div className="shrink-0 px-4 pt-3 max-[720px]:px-3">
          <ConflictBar
            count={conflictCount}
            showing={onlyConflicts}
            busy={busy === 'accept'}
            onShow={() => setOnlyConflicts((v) => !v)}
            onAcceptAnyway={() => void accept(seqs, true)}
          />
        </div>
      ) : null}
      {quota ? (
        <div role="alert" className="mx-4 mt-3 flex shrink-0 items-start gap-3 rounded-vx-sm bg-vx-danger-wash px-3.5 py-3 max-[720px]:mx-3">
          <CircleAlert size={18} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-vx-del-fg" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold leading-5 text-vx-text-1">Not enough space</p>
            <p className="vx-meta text-vx-text-2">
              {quota.details
                ? `Accepting these changes needs ${formatBytes(quota.details.overBytes)} more than you have. `
                : `${quota.message} `}
              Nothing was changed. Delete something you no longer need, or ask an admin for more space.
            </p>
          </div>
          <Button size="sm" variant="text" onClick={clearQuota}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] max-[720px]:grid-cols-1">
        <ReviewFileList
          className="border-r border-vx-hair max-[720px]:border-r-0"
          files={shown}
          selected={selected}
          onSelect={select}
          checked={checked}
          onCheck={(seq, on) =>
            setChecked((cur) => {
              const next = new Set(cur);
              if (on) next.add(seq);
              else next.delete(seq);
              return next;
            })
          }
          onCheckAll={open ? (on) => setChecked(on ? new Set(shown.filter((f) => f.status === 'pending').map((f) => f.seq)) : new Set()) : undefined}
        />
        {phone ? null : <div className="min-h-0 min-w-0">{pane}</div>}
      </div>

      {phone && paneOpen ? (
        <div role="dialog" aria-modal="true" aria-label="Review file" className="fixed inset-0 z-[60] flex flex-col bg-vx-surface">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-vx-hair px-2">
            <IconButton label="Back to the file list" onClick={() => setPaneOpen(false)}>
              <ArrowLeft size={20} strokeWidth={1.75} aria-hidden />
            </IconButton>
            <span className="vx-ui truncate text-vx-text-1">{title}</span>
          </div>
          <div className="min-h-0 flex-1">{pane}</div>
        </div>
      ) : null}
    </div>
  );
}

export default ProposalReview;

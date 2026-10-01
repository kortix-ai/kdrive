'use client';

// Accept / discard for the review page (MCP.md §14.7): calls the proposals API, maps its
// errors (stale_base → the conflict bar, proposal_closed → "Already decided",
// quota_exceeded → the not-enough-space row) and toasts the result (accept carries Undo).
import { useCallback, useState } from 'react';
import { UNDO_WINDOW_MS, type ProposalSummary, type QuotaDetails } from '@volumes/shared';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { useVx } from '@/lib/store';
import { errorText } from '@/lib/versioning/hooks';
import { changesWord } from './format';

/** What the last refused accept said about the drive having moved on. */
export interface StaleInfo {
  count: number;
  paths: string[];
  currentCommitId: string | null;
}

export function staleFrom(e: ApiError): StaleInfo {
  const raw = Array.isArray(e.details?.conflicts) ? (e.details.conflicts as unknown[]) : [];
  const paths = raw
    .map((c) => (c && typeof c === 'object' && typeof (c as { path?: unknown }).path === 'string' ? (c as { path: string }).path : null))
    .filter((p): p is string => !!p);
  const cur = e.details?.current_commit_id;
  return { count: Math.max(raw.length, 1), paths, currentCommitId: typeof cur === 'string' ? cur : null };
}

export function quotaFrom(e: ApiError): QuotaDetails | null {
  const d = e.details as Partial<QuotaDetails> | undefined;
  if (!d || typeof d.overBytes !== 'number') return null;
  return { usedBytes: d.usedBytes ?? 0, quotaBytes: d.quotaBytes ?? 0, requestedBytes: d.requestedBytes ?? 0, overBytes: d.overBytes };
}

export type ReviewBusy = 'accept' | 'discard' | null;

export function useReviewActions(ws: string | null, proposal: ProposalSummary | null, after: () => void) {
  const [busy, setBusy] = useState<ReviewBusy>(null);
  const [stale, setStale] = useState<StaleInfo | null>(null);
  /** Counts stale_base refusals, so a refusal the bar already shows still visibly answers the click. */
  const [staleTick, setStaleTick] = useState(0);
  const [quota, setQuota] = useState<{ details: QuotaDetails | null; message: string } | null>(null);

  const fail = useCallback(
    (e: unknown) => {
      const toast = useVx.getState().toast;
      if (e instanceof ApiError && e.code === 'stale_base') {
        setStale(staleFrom(e));
        setStaleTick((n) => n + 1);
      } else if (e instanceof ApiError && e.code === 'proposal_closed') {
        toast({ kind: 'info', message: 'Already decided' });
      } else if (e instanceof ApiError && e.code === 'quota_exceeded') {
        setQuota({ details: quotaFrom(e), message: e.message });
      } else {
        toast({ kind: 'error', message: errorText(e, "Couldn't finish that. Try again.") });
      }
      after();
    },
    [after],
  );

  const accept = useCallback(
    async (seqs: number[] | undefined, force = false) => {
      if (!ws || !proposal || busy) return false;
      setBusy('accept');
      setQuota(null);
      try {
        const r = await api.proposals.accept(ws, proposal.id, { seqs, force });
        setStale(null);
        const k = seqs?.length ?? proposal.pending;
        const message = `Accepted ${changesWord(k)} from ${proposal.agent.name}`;
        useVx.getState().toast(
          r.action
            ? { kind: 'success', message, undoActionId: r.action.id, undoWorkspaceId: ws, durationMs: UNDO_WINDOW_MS }
            : { kind: 'success', message },
        );
        useVx.getState().refresh();
        after();
        return true;
      } catch (e) {
        fail(e);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [ws, proposal, busy, after, fail],
  );

  const discard = useCallback(
    async (seqs: number[] | undefined) => {
      if (!ws || !proposal || busy) return false;
      setBusy('discard');
      try {
        await api.proposals.discard(ws, proposal.id, { seqs });
        const k = seqs?.length ?? proposal.pending;
        useVx.getState().toast({ kind: 'success', message: `Discarded ${changesWord(k)}` });
        useVx.getState().refresh();
        after();
        return true;
      } catch (e) {
        fail(e);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [ws, proposal, busy, after, fail],
  );

  return { busy, stale, staleTick, quota, accept, discard, clearQuota: () => setQuota(null) };
}

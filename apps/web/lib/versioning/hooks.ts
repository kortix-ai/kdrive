'use client';

// Data hooks shared by the versioning UI (timeline rail, time strip, banner, dialogs, pages).

import { useCallback, useMemo } from 'react';
import useSWR from 'swr';
import type { TimelineEntry } from '@volumes/shared';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { useTimeline } from '@/lib/api/hooks';
import { useVx } from '@/lib/store';

const quiet = {
  shouldRetryOnError: (err: unknown) => !(err instanceof ApiError && err.status >= 400 && err.status < 500),
  revalidateOnFocus: false,
};

/** Loaded timeline entries (newest first), the head commit and paging. */
export function useTimelineEntries() {
  const t = useTimeline(50);
  const pages = t.data;
  const entries = useMemo<TimelineEntry[]>(() => {
    const seen = new Set<string>();
    const out: TimelineEntry[] = [];
    for (const p of pages ?? []) {
      for (const e of p.entries) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        out.push(e);
      }
    }
    return out;
  }, [pages]);
  const headCommitId = pages?.[0]?.headCommitId ?? null;
  const last = pages?.[pages.length - 1];
  const hasMore = !!last?.nextCursor;
  const loadingMore = t.isValidating && !!pages && t.size > pages.length;
  const { setSize, size } = t;
  const loadMore = useCallback(() => {
    if (hasMore && !loadingMore) void setSize(size + 1);
  }, [hasMore, loadingMore, setSize, size]);
  return {
    entries,
    headCommitId,
    hasMore,
    loadMore,
    loadingMore,
    isLoading: t.isLoading,
    error: t.error as unknown,
    retry: () => void t.mutate(),
  };
}

/** One commit (immutable, so cached for the session). */
export function useCommit(ref: string | null | undefined) {
  const ws = useVx((s) => s.workspaceId);
  return useSWR(ws && ref ? ['commit', ws, ref] : null, () => api.versioning.commit(ws!, ref!), { ...quiet, revalidateIfStale: false });
}

/** Every kept version of a file. */
export function useFileVersions(path: string | null | undefined) {
  const ws = useVx((s) => s.workspaceId);
  return useSWR(ws && path ? ['versions', ws, path] : null, () => api.versioning.versions(ws!, path!), quiet);
}

/** Checkpoints + the shared tag budget. */
export function useCheckpoints(enabled = true) {
  const ws = useVx((s) => s.workspaceId);
  return useSWR(ws && enabled ? ['checkpoints', ws] : null, () => api.checkpoints.list(ws!), quiet);
}

/** Recently deleted items. */
export function useDeleted() {
  const ws = useVx((s) => s.workspaceId);
  return useSWR(ws ? ['deleted', ws] : null, () => api.versioning.deleted(ws!, { limit: 500 }), quiet);
}

/** Drive changes between two refs (a = older). */
export function useDriveCompare(a: string | null | undefined, b: string | null | undefined) {
  const ws = useVx((s) => s.workspaceId);
  return useSWR(ws && a && b ? ['compare-drive', ws, a, b] : null, () => api.versioning.compareDrive(ws!, { a: a!, b: b! }), quiet);
}

/** Error text for an API failure, with friendly copy for the versioning codes. */
export function errorText(e: unknown, fallback = 'Something went wrong.'): string {
  if (e instanceof ApiError) {
    if (e.code === 'version_gone') return 'This version is no longer kept.';
    if (e.code === 'tag_budget_exceeded') return 'All 100 checkpoint slots are used. Remove one first.';
    if (e.code === 'rate_limited') return 'Too many requests. Try again in a moment.';
    return e.message || fallback;
  }
  return e instanceof Error && e.message ? e.message : fallback;
}

export const isGone = (e: unknown) => e instanceof ApiError && (e.code === 'version_gone' || e.status === 410);

'use client';

import { useEffect } from 'react';
import useSWR, { type SWRConfiguration } from 'swr';
import useSWRInfinite from 'swr/infinite';
import type { TimelineResponse } from '@volumes/shared';
import { useVx } from '../store';
import { ApiError } from './client';
import { api } from './endpoints';

import { registerInfinite } from './swr';

export { revalidateAll } from './swr';

const noRetryOn4xx: SWRConfiguration = {
  shouldRetryOnError: (err: unknown) => !(err instanceof ApiError && err.status >= 400 && err.status < 500),
  revalidateOnFocus: false,
};

export function useConfig() {
  return useSWR('config', () => api.config(), { ...noRetryOn4xx, revalidateIfStale: false });
}

/** The signed-in user; error.status === 401 when signed out. */
export function useMe() {
  return useSWR('me', () => api.me.get(), noRetryOn4xx);
}

export function useUsage() {
  return useSWR('usage', () => api.me.usage(), noRetryOn4xx);
}

export function useWorkspaces() {
  return useSWR('workspaces', () => api.workspaces.list(), noRetryOn4xx);
}

type LsKey = [string, string, string, string | null];

/**
 * Listing of `path` in the current workspace, at the time-travel commit when set. Key ['ls', ws, path, at].
 * The fetcher reads everything from the key it is called with, never from the
 * render's closure: SWR runs a deferred revalidation for a key with the LATEST
 * fetcher, and a closure fetcher would then store a past listing under the
 * "now" key (and "now" drift chips would compare the past with itself).
 */
export function useListing(path: string) {
  const ws = useVx((s) => s.workspaceId);
  const at = useVx((s) => s.timeTravel?.commitId ?? null);
  return useSWR(ws ? (['ls', ws, path, at] as LsKey) : null, ([, w, p, a]: LsKey) => api.files.list(w, { path: p, at: a }), {
    ...noRetryOn4xx,
    keepPreviousData: true,
  });
}

/** The listing of `path` at head, as the baseline for "gone now / added later": its own key, always fresh. */
export function useNowListing(path: string, enabled: boolean) {
  const ws = useVx((s) => s.workspaceId);
  return useSWR(ws && enabled ? (['ls-now', ws, path] as const) : null, ([, w, p]) => api.files.list(w, { path: p }), {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0,
    shouldRetryOnError: false,
  });
}

export function useStat(path: string | null, at?: string | null) {
  const ws = useVx((s) => s.workspaceId);
  return useSWR(
    ws && path ? (['stat', ws, path, at ?? null] as LsKey) : null,
    ([, w, p, a]: LsKey) => api.files.stat(w, { path: p, at: a }),
    noRetryOn4xx,
  );
}

/** Timeline pages (newest first). `pages.flatMap(p => p.entries)`; `setSize(size + 1)` loads older. */
export function useTimeline(pageSize = 50) {
  const ws = useVx((s) => s.workspaceId);
  const res = useSWRInfinite<TimelineResponse>(
    (index, prev) => {
      if (!ws) return null;
      if (index === 0) return ['timeline', ws, pageSize, null];
      if (!prev?.nextCursor) return null;
      return ['timeline', ws, pageSize, prev.nextCursor];
    },
    (key: [string, string, number, string | null]) => api.versioning.timeline(key[1], { limit: key[2], before: key[3] }),
    { ...noRetryOn4xx, revalidateFirstPage: true },
  );
  // revalidateAll() cannot reach infinite keys by filter; let it call ours.
  const { mutate } = res;
  useEffect(() => registerInfinite(() => mutate()), [mutate]);
  return res;
}

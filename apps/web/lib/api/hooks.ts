'use client';

import { useEffect, useRef } from 'react';
import useSWR, { unstable_serialize, useSWRConfig, type SWRConfiguration } from 'swr';
import useSWRInfinite from 'swr/infinite';
import type { TimelineResponse } from '@volumes/shared';
import { useVx } from '../store';
import { ApiError } from './client';
import { api } from './endpoints';

import { listingFor } from './listing';
import { registerInfinite, sessionBound } from './swr';

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
  const key = ws ? (['ls', ws, path, at] as LsKey) : null;
  const res = useSWR(key, ([, w, p, a]: LsKey) => api.files.list(w, { path: p, at: a }), {
    ...noRetryOn4xx,
    keepPreviousData: true,
  });
  // keepPreviousData keeps the previous folder on screen while the next loads, but never
  // across a workspace switch: remember which workspace the shown data was fetched for (the
  // current key's own data, or the last key that had some).
  const { cache } = useSWRConfig();
  const dataWs = useRef<string | null>(null);
  if (key && cache.get(unstable_serialize(key))?.data !== undefined) dataWs.current = ws;
  const shownWs = dataWs.current;
  // Getters keep SWR's per-field render tracking.
  return {
    get data() {
      return listingFor(res.data, shownWs, ws);
    },
    get error() {
      return res.error;
    },
    get isValidating() {
      return res.isValidating;
    },
    get isLoading() {
      return res.isLoading;
    },
    mutate: res.mutate,
  };
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
    sessionBound((key: [string, string, number, string | null]) => api.versioning.timeline(key[1], { limit: key[2], before: key[3] })),
    { ...noRetryOn4xx, revalidateFirstPage: true },
  );
  // revalidateAll() cannot reach infinite keys by filter; let it call ours.
  const { mutate } = res;
  useEffect(() => registerInfinite(() => mutate()), [mutate]);
  return res;
}

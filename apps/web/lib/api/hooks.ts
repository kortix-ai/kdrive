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

/**
 * For signed-out pages (sign-in, OAuth consent): asks whether a session exists without a 401 (the auth server's
 * session probe answers 200 with null), then loads `me` only when one does. `signedOut` is true once known.
 */
export function useMeIfSignedIn() {
  const probe = useSWR(
    'session-probe',
    async () => {
      const r = await fetch('/api/auth/get-session', { credentials: 'include', cache: 'no-store' });
      if (!r.ok) throw new ApiError(r.status, 'session_probe', 'Could not check the session.');
      const j = (await r.json().catch(() => null)) as { session?: unknown } | null;
      return !!j?.session;
    },
    noRetryOn4xx,
  );
  const me = useSWR(probe.data ? 'me' : null, () => api.me.get(), noRetryOn4xx);
  const signedOut = probe.data === false || (me.error instanceof ApiError && me.error.status === 401);
  return { data: me.data, error: me.error ?? probe.error, signedOut };
}

export function useUsage() {
  return useSWR('usage', () => api.me.usage(), noRetryOn4xx);
}

export function useWorkspaces() {
  return useSWR('workspaces', () => api.workspaces.list(), noRetryOn4xx);
}

/** People of drive `id` (null: not loaded). */
export function useDrivePeople(id: string | null) {
  return useSWR(id ? ['people', id] : null, () => api.workspaces.people(id!), noRetryOn4xx);
}

/** Invitations to other people's drives (refreshed when the window regains focus). */
export function useInvitations(enabled = true) {
  return useSWR(enabled ? 'invitations' : null, () => api.invitations.list(), { ...noRetryOn4xx, refreshInterval: 60_000 });
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

// ── AI agents ───────────────────────────────────────────────────────────────

/** The user's agent tokens (never their secrets). */
export function useAgentTokens() {
  return useSWR('agent-tokens', () => api.agents.tokens(), noRetryOn4xx);
}

/** Apps connected through OAuth sign-in. */
export function useConnectedApps() {
  return useSWR('agent-apps', () => api.agents.apps(), noRetryOn4xx);
}

/** Open proposals in the current workspace (the sidebar count). Key ['proposals-count', ws]; refreshes every 30 s and on focus. */
export function useProposalCount() {
  const ws = useVx((s) => s.workspaceId);
  return useSWR(ws ? (['proposals-count', ws] as const) : null, ([, w]) => api.proposals.count(w), {
    ...noRetryOn4xx,
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });
}

/** Proposals of the current workspace: 'open' (waiting), 'closed' (decided) or 'all'. */
export function useProposals(status: 'open' | 'closed' | 'all' = 'open') {
  const ws = useVx((s) => s.workspaceId);
  return useSWR(ws ? (['proposals', ws, status] as const) : null, ([, w, st]) => api.proposals.list(w, { status: st }), noRetryOn4xx);
}

/** One proposal with its files, conflicts and compare sides. */
export function useProposal(id: string | null) {
  const ws = useVx((s) => s.workspaceId);
  return useSWR(ws && id ? (['proposal', ws, id] as const) : null, ([, w, i]) => api.proposals.get(w, i), noRetryOn4xx);
}

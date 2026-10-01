import { mutate } from 'swr';
import { cache } from 'swr/_internal';

/**
 * Revalidators of infinite (paged) lists, which the filter form of `mutate`
 * never reaches: SWR skips its `$inf$` cache keys. useTimeline registers here.
 */
const infinite = new Set<() => Promise<unknown>>();

export function registerInfinite(revalidate: () => Promise<unknown>): () => void {
  infinite.add(revalidate);
  return () => infinite.delete(revalidate);
}

/**
 * Revalidates every swr key (after a mutation, a workspace switch, …),
 * including paged lists like the timeline, so the Time Strip and the History
 * rail move to the new head right after the user's own action.
 * Called with the key filter only: passing `undefined` data would first wipe
 * every cached value (the shell would flash its loading state on each refresh).
 */
export function revalidateAll(): Promise<unknown> {
  return Promise.all([mutate(() => true), ...[...infinite].map((r) => r())]);
}

/** Bumped whenever the session ends; a request started before that belongs to the old session. */
let sessionEpoch = 0;

/** A response that arrived after the session it was requested in ended; it is dropped. */
export class SessionEndedError extends Error {
  constructor() {
    super('The session ended while this was loading.');
    this.name = 'SessionEndedError';
  }
}

/**
 * Wraps a fetcher so a response requested in one session is never cached in the next.
 * Plain keys are protected by SWR's own mutation timestamps; paged (useSWRInfinite) lists
 * write their pages when the request resolves, so theirs must go through this.
 */
export function sessionBound<A extends unknown[], R>(fetcher: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const at = sessionEpoch;
    const out = await fetcher(...args);
    if (at !== sessionEpoch) throw new SessionEndedError();
    return out;
  };
}

/**
 * Drops every cached response (sign-out): the next user in this tab never sees the last
 * user's identity, workspaces or listings. The filter form clears (and notifies) plain keys;
 * paged and subscription keys, which it skips, are deleted from the cache directly. Paged
 * requests still in flight are dropped when they resolve (see sessionBound).
 */
export async function clearSwrCache(): Promise<void> {
  sessionEpoch++;
  await mutate(() => true, undefined, { revalidate: false });
  for (const key of [...cache.keys()]) cache.delete(key);
}

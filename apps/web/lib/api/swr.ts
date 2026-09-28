import { mutate } from 'swr';

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

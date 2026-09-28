import { mutate } from 'swr';

/**
 * Revalidates every swr key (after a mutation, a workspace switch, …).
 * Called with the key filter only: passing `undefined` data would first wipe
 * every cached value (the shell would flash its loading state on each refresh).
 */
export function revalidateAll(): Promise<unknown> {
  return mutate(() => true);
}

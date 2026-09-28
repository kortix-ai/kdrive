import { mutate } from 'swr';

/** Revalidates every swr key (after a mutation, a workspace switch, …). */
export function revalidateAll(): Promise<unknown> {
  return mutate(() => true, undefined, { revalidate: true });
}

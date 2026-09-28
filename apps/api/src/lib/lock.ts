/**
 * Per-workspace async mutex. Every mutation of a workspace's volume runs
 * inside it, so Platinum results are always `fast` or `noop` and each ledger
 * action maps to exactly one head commit.
 */
const chains = new Map<string, Promise<void>>();

export async function withWorkspaceLock<T>(wsId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(wsId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const tail = prev.then(() => gate);
  chains.set(wsId, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (chains.get(wsId) === tail) chains.delete(wsId);
  }
}

/** True while some caller holds or waits for the workspace lock (tests). */
export function isWorkspaceLocked(wsId: string): boolean {
  return chains.has(wsId);
}

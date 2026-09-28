// Web Worker: SHA-256 over each 1 MiB slice of a File (crypto.subtle).
// Protocol (see hasher.ts):
//   in  { type: 'hash', id, file } | { type: 'cancel', id }
//   out { type: 'progress', id, hashed } | { type: 'done', id, blocks } | { type: 'error', id, message }
import { hashBlob } from './hash-core';

type In = { type: 'hash'; id: number; file: Blob } | { type: 'cancel'; id: number };
type Out =
  | { type: 'progress'; id: number; hashed: number }
  | { type: 'done'; id: number; blocks: string[] }
  | { type: 'error'; id: number; message: string; aborted?: boolean };

interface WorkerScope {
  onmessage: ((e: MessageEvent<In>) => void) | null;
  postMessage(msg: Out): void;
}

const scope = self as unknown as WorkerScope;
const cancelled = new Set<number>();

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    cancelled.add(msg.id);
    return;
  }
  const id = msg.id;
  const signal = {
    get aborted() {
      return cancelled.has(id);
    },
  };
  let last = 0;
  hashBlob(
    msg.file,
    (hashed) => {
      // at most ~every 4 MiB (and always the final block) to keep the channel quiet
      if (hashed - last >= 4 * 1_048_576 || hashed === msg.file.size) {
        last = hashed;
        scope.postMessage({ type: 'progress', id, hashed });
      }
    },
    signal,
  )
    .then((blocks) => scope.postMessage({ type: 'done', id, blocks }))
    .catch((err: unknown) =>
      scope.postMessage({
        type: 'error',
        id,
        message: err instanceof Error ? err.message : 'Could not read the file.',
        aborted: cancelled.has(id),
      }),
    )
    .finally(() => cancelled.delete(id));
};

// A pool of min(4, hardwareConcurrency) hashing Web Workers. Falls back to the
// main thread (crypto.subtle is async, so the UI stays responsive) when workers
// are unavailable, e.g. under tests or when the worker fails to boot.
import { HashAbortedError, hashBlob } from './hash-core';

export interface Hasher {
  /** Block hashes of `file`; `onProgress` gets cumulative hashed bytes. */
  hash(file: Blob, onProgress: (hashed: number) => void, signal?: AbortSignal): Promise<string[]>;
  dispose(): void;
}

type Out =
  | { type: 'progress'; id: number; hashed: number }
  | { type: 'done'; id: number; blocks: string[] }
  | { type: 'error'; id: number; message: string; aborted?: boolean };

interface Task {
  id: number;
  file: Blob;
  onProgress: (hashed: number) => void;
  resolve: (blocks: string[]) => void;
  reject: (e: unknown) => void;
  signal?: AbortSignal;
}

export function poolSize(): number {
  const hc = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
  return Math.max(1, Math.min(4, hc));
}

/** Main-thread hasher with the same interface (bounded concurrency). */
export function createMainThreadHasher(concurrency = 2): Hasher {
  let running = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (running >= concurrency) return;
    const run = queue.shift();
    if (run) run();
  };
  return {
    hash(file, onProgress, signal) {
      return new Promise<string[]>((resolve, reject) => {
        queue.push(() => {
          running++;
          hashBlob(file, onProgress, signal)
            .then(resolve, reject)
            .finally(() => {
              running--;
              next();
            });
        });
        next();
      });
    },
    dispose() {
      queue.length = 0;
    },
  };
}

function spawnWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module', name: 'vx-hash' });
  } catch {
    return null;
  }
}

/** Worker pool hasher; transparently degrades to the main thread. */
export function createHasher(size = poolSize()): Hasher {
  const fallback = createMainThreadHasher(2);
  const workers: { w: Worker; task: Task | null }[] = [];
  const queue: Task[] = [];
  let seq = 0;
  let broken = false;

  const fail = (slot: { w: Worker; task: Task | null }, err: unknown) => {
    const t = slot.task;
    slot.task = null;
    if (t) {
      // Retry the file on the main thread; the pool is considered broken.
      broken = true;
      fallback.hash(t.file, t.onProgress, t.signal).then(t.resolve, t.reject);
    }
    void err;
  };

  const ensureWorkers = () => {
    while (!broken && workers.length < size) {
      const w = spawnWorker();
      if (!w) {
        broken = true;
        break;
      }
      const slot: { w: Worker; task: Task | null } = { w, task: null };
      w.onmessage = (e: MessageEvent<Out>) => {
        const msg = e.data;
        const t = slot.task;
        if (!t || t.id !== msg.id) return;
        if (msg.type === 'progress') t.onProgress(msg.hashed);
        else if (msg.type === 'done') {
          slot.task = null;
          t.resolve(msg.blocks);
          pump();
        } else {
          slot.task = null;
          t.reject(msg.aborted ? new HashAbortedError() : new Error(msg.message));
          pump();
        }
      };
      w.onerror = (e) => {
        e.preventDefault?.();
        fail(slot, e);
        pump();
      };
      workers.push(slot);
    }
  };

  const pump = () => {
    if (broken) {
      // Drain everything left to the fallback.
      while (queue.length) {
        const t = queue.shift()!;
        fallback.hash(t.file, t.onProgress, t.signal).then(t.resolve, t.reject);
      }
      return;
    }
    for (const slot of workers) {
      if (slot.task) continue;
      let t = queue.shift();
      while (t && t.signal?.aborted) {
        t.reject(new HashAbortedError());
        t = queue.shift();
      }
      if (!t) return;
      slot.task = t;
      const task = t;
      task.signal?.addEventListener('abort', () => {
        if (slot.task === task) slot.w.postMessage({ type: 'cancel', id: task.id });
      });
      slot.w.postMessage({ type: 'hash', id: t.id, file: t.file });
    }
  };

  return {
    hash(file, onProgress, signal) {
      if (signal?.aborted) return Promise.reject(new HashAbortedError());
      ensureWorkers();
      if (broken && workers.every((s) => !s.task)) return fallback.hash(file, onProgress, signal);
      return new Promise<string[]>((resolve, reject) => {
        queue.push({ id: ++seq, file, onProgress, resolve, reject, signal });
        pump();
      });
    },
    dispose() {
      for (const s of workers) s.w.terminate();
      workers.length = 0;
      fallback.dispose();
    },
  };
}

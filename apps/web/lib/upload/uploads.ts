'use client';

// The app's single upload engine, wired to the real API, the hashing worker
// pool, the app store and the prompt dialogs.
import { api } from '../api/endpoints';
import { useVx } from '../store';
import { createUploadEngine, sleep, type StartOptions, type UploadEngine } from './engine';
import { createHasher, type Hasher } from './hasher';
import { askConflict, showQuota } from './prompts';

let engine: UploadEngine | null = null;
let hasher: Hasher | null = null;

export function getUploadEngine(): UploadEngine {
  if (engine) return engine;
  engine = createUploadEngine({
    api: {
      plan: (ws, req) => api.uploads.plan(ws, req),
      putBlock: (ws, id, sha, bytes, signal) => api.uploads.putBlock(ws, id, sha, bytes, signal),
      commit: (ws, id) => api.uploads.commit(ws, id),
      abort: (ws, id) => api.uploads.abort(ws, id),
    },
    hasher: () => (hasher ??= createHasher()),
    store: () => useVx.getState(),
    askConflict,
    showQuota,
    usage: async () => {
      const u = await api.me.usage();
      return { usedBytes: u.usedBytes, quotaBytes: u.quotaBytes };
    },
    sleep,
  });
  return engine;
}

/** Queues an upload of `sources` into `basePath` of the current (or given) workspace. */
export function startUpload(opts: Omit<StartOptions, 'workspaceId'> & { workspaceId?: string | null }): string | null {
  const s = useVx.getState();
  const ws = opts.workspaceId ?? s.workspaceId;
  if (!ws) return null;
  if (s.timeTravel) {
    s.toast({ kind: 'info', message: 'Go back to now to upload.' });
    return null;
  }
  return getUploadEngine().start({ workspaceId: ws, basePath: opts.basePath, sources: opts.sources });
}

/** Sign-out: cancels and forgets every upload in this tab (the engine is kept for the next user). */
export function endUploads(): void {
  engine?.reset();
}

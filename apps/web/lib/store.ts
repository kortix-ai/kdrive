'use client';

// The one client store (architecture §10.3). FROZEN public API: builders call
// these actions and never add state here. Local component state stays local.

import { create } from 'zustand';
import { UNDO_WINDOW_MS, type MeResponse } from '@volumes/shared';
import { api } from './api/endpoints';
import { revalidateAll } from './api/swr';

export type Panel = { kind: 'preview' | 'versions'; path: string; at: string | null } | null;
export type TimeTravel = { commitId: string; createdAt: string } | null;
export type UploadFileState = {
  id: string;
  path: string;
  size: number;
  hashed: number;
  sent: number;
  status: 'queued' | 'hashing' | 'planning' | 'uploading' | 'committing' | 'done' | 'error' | 'conflict';
  error?: string;
};
export type UploadJob = {
  id: string;
  workspaceId: string;
  basePath: string;
  files: UploadFileState[];
  status: 'active' | 'done' | 'error' | 'cancelled';
  actionId?: string;
  createdAt: number;
};
export type Toast = {
  id: string;
  kind: 'info' | 'success' | 'error';
  message: string;
  undoActionId?: string;
  /** The workspace `undoActionId` ran in (its Undo goes there, whatever is selected by then). */
  undoWorkspaceId?: string;
  expiresAt: number;
  durationMs: number;
};
export type UndoEntry = { id: string; label: string; actionId: string; workspaceId: string; at: number };
export type RestoreTarget = { scope: 'file' | 'folder' | 'drive'; path?: string; at: string } | null;

export interface VxState {
  me: MeResponse | null;
  /** persisted in localStorage['vx-ws']; falls back to me.defaultWorkspaceId */
  workspaceId: string | null;
  /** mirrors the /drive URL */
  path: string;
  selection: string[];
  anchor: string | null;
  timeTravel: TimeTravel;
  timelineOpen: boolean;
  panel: Panel;
  /** persisted in localStorage['vx-view'] */
  view: 'list' | 'grid';
  uploads: UploadJob[];
  toasts: Toast[];
  /** newest last, max 20 */
  undoStack: UndoEntry[];
  share: { path: string } | null;
  restore: RestoreTarget;
  checkpoint: { at: string | null } | null;
  duplicate: { at: string | null } | null;
  /** The Rename drive dialog (for the current drive) is open. */
  renamingDrive: boolean;
  refreshKey: number;

  setMe(me: MeResponse | null): void;
  /** clears selection, panel, timeTravel; bumps refreshKey */
  setWorkspace(id: string): void;
  /** clears selection */
  setPath(path: string): void;
  select(paths: string[], mode?: 'replace' | 'toggle' | 'range' | 'add'): void;
  clearSelection(): void;
  /** at defaults to timeTravel?.commitId */
  openPreview(path: string, opts?: { at?: string | null }): void;
  openVersions(path: string): void;
  closePanel(): void;
  toggleTimeline(open?: boolean): void;
  /** clears selection */
  enterTimeTravel(t: { commitId: string; createdAt: string }): void;
  exitTimeTravel(): void;
  /** refreshKey++ and swr revalidateAll() */
  refresh(): void;
  toast(t: { kind?: Toast['kind']; message: string; durationMs?: number; undoActionId?: string; undoWorkspaceId?: string }): string;
  dismissToast(id: string): void;
  /** pushes undoStack + an 8 s toast with Undo */
  /** `workspaceId`: where the action ran (defaults to the current workspace). */
  registerUndo(e: { label: string; actionId: string; workspaceId?: string | null }): void;
  /** POST /actions/:id/undo, refresh(), toast "Undone" */
  undo(toastIdOrActionId: string): Promise<void>;
  /** ⌘Z: newest undoStack entry for the current workspace */
  undoLast(): Promise<void>;
  openShare(path: string): void;
  closeShare(): void;
  openRestore(t: NonNullable<RestoreTarget>): void;
  closeRestore(): void;
  openCheckpoint(at?: string | null): void;
  closeCheckpoint(): void;
  openDuplicate(at?: string | null): void;
  closeDuplicate(): void;
  openRenameDrive(): void;
  closeRenameDrive(): void;
  setView(v: 'list' | 'grid'): void;
  addUploadJob(job: UploadJob): void;
  updateUploadJob(id: string, patch: Partial<UploadJob>): void;
  updateUploadFile(jobId: string, fileId: string, patch: Partial<UploadFileState>): void;
  removeUploadJob(id: string): void;
}

const LS_WS = 'vx-ws';
const LS_VIEW = 'vx-view';

function lsGet(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

let seq = 0;
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useVx = create<VxState>()((set, get) => ({
  me: null,
  workspaceId: null,
  path: '/',
  selection: [],
  anchor: null,
  timeTravel: null,
  timelineOpen: false,
  panel: null,
  view: 'list',
  uploads: [],
  toasts: [],
  undoStack: [],
  share: null,
  restore: null,
  checkpoint: null,
  duplicate: null,
  renamingDrive: false,
  refreshKey: 0,

  setMe(me) {
    if (!me) {
      // Signed out: forget everything that belonged to the user in this tab.
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      set({
        me: null,
        workspaceId: null,
        path: '/',
        selection: [],
        anchor: null,
        timeTravel: null,
        panel: null,
        toasts: [],
        undoStack: [],
        uploads: [],
        share: null,
        restore: null,
        checkpoint: null,
        duplicate: null,
        renamingDrive: false,
      });
      return;
    }
    const held = get().workspaceId;
    const cur = held ?? lsGet(LS_WS);
    const valid = cur && me.workspaces.some((w) => w.id === cur) ? cur : me.defaultWorkspaceId;
    const view = lsGet(LS_VIEW) === 'grid' ? 'grid' : get().view;
    // No default only while the user is held for email verification (no drive yet).
    if (valid && valid !== cur) lsSet(LS_WS, valid);
    if (held && held !== valid) {
      // The workspace in use is gone (deleted in another tab or by an admin): switch to the
      // default like setWorkspace does, and close anything aimed at the old one's paths, so a
      // Delete, Move or Restore never lands on the same paths in the default workspace.
      set((s) => ({
        me,
        view,
        workspaceId: valid,
        path: '/',
        selection: [],
        anchor: null,
        panel: null,
        timeTravel: null,
        share: null,
        restore: null,
        checkpoint: null,
        duplicate: null,
        renamingDrive: false,
        refreshKey: s.refreshKey + 1,
      }));
      get().toast({ kind: 'info', message: 'That drive is no longer available. Showing your default drive.' });
      void revalidateAll();
      return;
    }
    set({ me, workspaceId: valid, view });
  },

  setWorkspace(id) {
    lsSet(LS_WS, id);
    set((s) => ({
      workspaceId: id,
      selection: [],
      anchor: null,
      panel: null,
      timeTravel: null,
      path: '/',
      refreshKey: s.refreshKey + 1,
    }));
    void revalidateAll();
  },

  setPath(path) {
    if (path === get().path) return;
    set({ path, selection: [], anchor: null });
  },

  select(paths, mode = 'replace') {
    const s = get();
    if (mode === 'replace') {
      set({ selection: [...new Set(paths)], anchor: paths[paths.length - 1] ?? null });
    } else if (mode === 'add') {
      set({ selection: [...new Set([...s.selection, ...paths])], anchor: paths[paths.length - 1] ?? s.anchor });
    } else if (mode === 'toggle') {
      const next = new Set(s.selection);
      for (const p of paths) {
        if (next.has(p)) next.delete(p);
        else next.add(p);
      }
      set({ selection: [...next], anchor: paths[paths.length - 1] ?? s.anchor });
    } else {
      // range: the caller passes the ordered range (anchor → target); the anchor is kept
      set({ selection: [...new Set(paths)] });
    }
  },

  clearSelection() {
    set({ selection: [], anchor: null });
  },

  openPreview(path, opts) {
    const at = opts && 'at' in opts ? (opts.at ?? null) : (get().timeTravel?.commitId ?? null);
    set({ panel: { kind: 'preview', path, at } });
  },

  openVersions(path) {
    set({ panel: { kind: 'versions', path, at: get().timeTravel?.commitId ?? null } });
  },

  closePanel() {
    set({ panel: null });
  },

  toggleTimeline(open) {
    set((s) => ({ timelineOpen: open ?? !s.timelineOpen }));
  },

  enterTimeTravel(t) {
    set((s) => ({
      timeTravel: { commitId: t.commitId, createdAt: t.createdAt },
      selection: [],
      anchor: null,
      panel: s.panel ? { ...s.panel, at: t.commitId } : null,
    }));
  },

  exitTimeTravel() {
    set((s) => ({ timeTravel: null, panel: s.panel ? { ...s.panel, at: null } : null }));
  },

  refresh() {
    set((s) => ({ refreshKey: s.refreshKey + 1 }));
    void revalidateAll();
  },

  toast(t) {
    const id = uid('t');
    const durationMs = t.durationMs ?? (t.undoActionId ? UNDO_WINDOW_MS : t.kind === 'error' ? 6000 : 4000);
    const toast: Toast = {
      id,
      kind: t.kind ?? 'info',
      message: t.message,
      undoActionId: t.undoActionId,
      undoWorkspaceId: t.undoActionId ? t.undoWorkspaceId : undefined,
      expiresAt: Date.now() + durationMs,
      durationMs,
    };
    set((s) => ({ toasts: [...s.toasts, toast].slice(-3) }));
    if (typeof window !== 'undefined') {
      timers.set(
        id,
        setTimeout(() => get().dismissToast(id), durationMs),
      );
    }
    return id;
  },

  dismissToast(id) {
    const t = timers.get(id);
    if (t) clearTimeout(t);
    timers.delete(id);
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
  },

  registerUndo(e) {
    // An action can finish after a workspace switch (a long upload): its undo belongs to
    // the workspace it ran in, never to the one now selected.
    const ws = e.workspaceId ?? get().workspaceId;
    if (!ws) return;
    const entry: UndoEntry = { id: uid('u'), label: e.label, actionId: e.actionId, workspaceId: ws, at: Date.now() };
    set((s) => ({ undoStack: [...s.undoStack, entry].slice(-20) }));
    get().toast({ kind: 'info', message: e.label, undoActionId: e.actionId, undoWorkspaceId: ws, durationMs: UNDO_WINDOW_MS });
  },

  async undo(toastIdOrActionId) {
    const s = get();
    const toast = s.toasts.find((t) => t.id === toastIdOrActionId);
    const actionId = toast?.undoActionId ?? toastIdOrActionId;
    if (toast) s.dismissToast(toast.id);
    const entry = s.undoStack.find((u) => u.actionId === actionId);
    // The action's own workspace: from its undo entry, else from the toast that offered it
    // (a redo from "Undone" has no entry), else the current one (the timeline's own rows).
    const ws = entry?.workspaceId ?? toast?.undoWorkspaceId ?? s.workspaceId;
    if (!ws) return;
    try {
      const r = await api.versioning.undo(ws, actionId);
      set((st) => ({ undoStack: st.undoStack.filter((u) => u.actionId !== actionId) }));
      get().refresh();
      get().toast({ kind: 'success', message: 'Undone', undoActionId: r.action.undoable ? r.action.id : undefined, undoWorkspaceId: ws });
    } catch (e) {
      get().toast({ kind: 'error', message: e instanceof Error ? e.message : 'Could not undo.' });
    }
  },

  async undoLast() {
    const s = get();
    const ws = s.workspaceId;
    const entry = [...s.undoStack].reverse().find((u) => u.workspaceId === ws);
    if (!entry) {
      s.toast({ kind: 'info', message: 'Nothing to undo' });
      return;
    }
    await s.undo(entry.actionId);
  },

  openShare(path) {
    set({ share: { path } });
  },
  closeShare() {
    set({ share: null });
  },
  openRestore(t) {
    set({ restore: t });
  },
  closeRestore() {
    set({ restore: null });
  },
  openCheckpoint(at = null) {
    set({ checkpoint: { at: at ?? get().timeTravel?.commitId ?? null } });
  },
  closeCheckpoint() {
    set({ checkpoint: null });
  },
  openDuplicate(at = null) {
    set({ duplicate: { at: at ?? get().timeTravel?.commitId ?? null } });
  },
  closeDuplicate() {
    set({ duplicate: null });
  },
  openRenameDrive() {
    set({ renamingDrive: true });
  },
  closeRenameDrive() {
    set({ renamingDrive: false });
  },

  setView(v) {
    lsSet(LS_VIEW, v);
    set({ view: v });
  },

  addUploadJob(job) {
    set((s) => ({ uploads: [...s.uploads, job] }));
  },
  updateUploadJob(id, patch) {
    set((s) => ({ uploads: s.uploads.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));
  },
  updateUploadFile(jobId, fileId, patch) {
    set((s) => ({
      uploads: s.uploads.map((j) =>
        j.id === jobId ? { ...j, files: j.files.map((f) => (f.id === fileId ? { ...f, ...patch } : f)) } : j,
      ),
    }));
  },
  removeUploadJob(id) {
    set((s) => ({ uploads: s.uploads.filter((j) => j.id !== id) }));
  },
}));

/** Non-hook access for event handlers and modules. */
export const vx = () => useVx.getState();

'use client';

// Comments and tags on the client: their SWR hooks (keyed by workspace, refreshed by
// revalidateAll like every other key), lookups by path, and the little UI state they
// share between the drive, its menus and the preview panel (the app store stays frozen).
import useSWR, { mutate } from 'swr';
import { create } from 'zustand';
import type { CommentCount, CommentCountsResponse, FileLabel, LabelListResponse } from '@volumes/shared';
import { ApiError } from './api/client';
import { api } from './api/endpoints';
import { useVx } from './store';

const quiet = {
  shouldRetryOnError: (err: unknown) => !(err instanceof ApiError && err.status >= 400 && err.status < 500),
  revalidateOnFocus: false,
} as const;

const KEYS = new Set(['labels', 'label-items', 'comment-counts', 'comments']);

/** Refetch everything comments and tags show (after one of our own writes). */
export function revalidateAnnotations(): Promise<unknown> {
  return mutate((k) => Array.isArray(k) && KEYS.has(k[0] as string));
}

/** The drive's tags and which items carry them (any member may read them). */
export function useLabels() {
  const ws = useVx((s) => s.workspaceId);
  return useSWR(ws ? (['labels', ws] as const) : null, ([, w]) => api.labels.list(w), quiet);
}

/** Every item carrying tag `id`, across the drive (the tag filter). */
export function useLabelItems(id: string | null) {
  const ws = useVx((s) => s.workspaceId);
  return useSWR(ws && id ? (['label-items', ws, id] as const) : null, ([, w, i]) => api.labels.items(w, i), { ...quiet, keepPreviousData: true });
}

/** Per file with comments: the count and open threads. */
export function useCommentCounts() {
  const ws = useVx((s) => s.workspaceId);
  return useSWR(ws ? (['comment-counts', ws] as const) : null, ([, w]) => api.comments.counts(w), quiet);
}

/** The comments on one file. */
export function useComments(path: string | null) {
  const ws = useVx((s) => s.workspaceId);
  return useSWR(ws && path ? (['comments', ws, path] as const) : null, ([, w, p]) => api.comments.list(w, p), quiet);
}

// ── lookups (built once per response) ───────────────────────────────────────

type LabelIndex = { byId: Map<string, FileLabel>; byPath: Map<string, FileLabel[]> };
const labelIndexes = new WeakMap<LabelListResponse, LabelIndex>();

export function labelIndex(data: LabelListResponse | undefined): LabelIndex | null {
  if (!data) return null;
  let ix = labelIndexes.get(data);
  if (!ix) {
    const byId = new Map(data.labels.map((l) => [l.id, l]));
    const byPath = new Map<string, FileLabel[]>();
    for (const a of data.assignments) {
      const ls = a.labelIds.map((id) => byId.get(id)).filter((l): l is FileLabel => !!l);
      if (ls.length) byPath.set(a.path, ls.sort((x, y) => x.name.localeCompare(y.name)));
    }
    ix = { byId, byPath };
    labelIndexes.set(data, ix);
  }
  return ix;
}

const countIndexes = new WeakMap<CommentCountsResponse, Map<string, CommentCount>>();

export function commentCountOf(data: CommentCountsResponse | undefined, path: string): CommentCount | null {
  if (!data) return null;
  let ix = countIndexes.get(data);
  if (!ix) {
    ix = new Map(data.counts.map((c) => [c.path, c]));
    countIndexes.set(data, ix);
  }
  return ix.get(path) ?? null;
}

// ── UI state ────────────────────────────────────────────────────────────────

export type LabelPickerState = { x: number; y: number; flipY?: number; paths: string[] } | null;

interface AnnotationsUi {
  /** The Comments section of the preview panel is open. */
  commentsOpen: boolean;
  /** Bumped to move focus to the comment box (opened from a menu). */
  composeTick: number;
  /** The drive view shows only the items with this tag (in this workspace). */
  filter: { ws: string; labelId: string } | null;
  picker: LabelPickerState;
  manageOpen: boolean;
  setCommentsOpen(open: boolean): void;
  setFilter(f: { ws: string; labelId: string } | null): void;
  openPicker(p: NonNullable<LabelPickerState>): void;
  closePicker(): void;
  setManageOpen(open: boolean): void;
}

export const useAnnotationsUi = create<AnnotationsUi>()((set) => ({
  commentsOpen: false,
  composeTick: 0,
  filter: null,
  picker: null,
  manageOpen: false,
  setCommentsOpen: (commentsOpen) => set({ commentsOpen }),
  setFilter: (filter) => set({ filter }),
  openPicker: (picker) => set({ picker }),
  closePicker: () => set({ picker: null }),
  setManageOpen: (manageOpen) => set({ manageOpen }),
}));

/** Opens the file's preview with its comments, and puts the cursor in the comment box. */
export function openComments(path: string): void {
  useVx.getState().openPreview(path, { at: null });
  useAnnotationsUi.setState((s) => ({ commentsOpen: true, composeTick: s.composeTick + 1 }));
}

/** The active tag filter for the current workspace, if any. */
export function useActiveFilter(): string | null {
  const ws = useVx((s) => s.workspaceId);
  return useAnnotationsUi((s) => (s.filter && s.filter.ws === ws ? s.filter.labelId : null));
}

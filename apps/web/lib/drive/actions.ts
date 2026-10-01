'use client';

// Drive commands shared by the toolbar, selection bar, context menu, keyboard
// and drag-and-drop. Mutations are optimistic and end with an Undo toast
// (registerUndo) because every action is a version that can be restored.
import { basename, dirname, joinPath, type ActionSummary, type FileEntry } from '@volumes/shared';
import { isApiError } from '../api/client';
import { api } from '../api/endpoints';
import { actionText } from '../format';
import { useVx } from '../store';
import { compareHref, contentUrl, zipUrl } from '../urls';
import { clearPending, markPending, markRemoving, optimistic, withAdded, withRenamed, withoutPaths } from './optimistic';

const vx = () => useVx.getState();

export function friendlyError(e: unknown, fallback = 'Something went wrong.'): string {
  if (isApiError(e)) {
    switch (e.code) {
      case 'path_exists':
        return 'Something with that name already exists there.';
      case 'path_not_found':
        return 'That item no longer exists. The list was refreshed.';
      case 'quota_exceeded':
        return 'Not enough storage space for this.';
      case 'version_gone':
        return 'This version is no longer kept.';
      case 'rate_limited':
        return 'Too many requests. Try again in a moment.';
      case 'upstream_unavailable':
        return 'Storage is unavailable right now. Try again in a moment.';
      default:
        return e.message || fallback;
    }
  }
  return e instanceof Error && e.message ? e.message : fallback;
}

export function itemsLabel(entries: readonly { name: string }[]): string {
  if (entries.length === 1) return entries[0].name;
  return `${entries.length} items`;
}

function afterAction(ws: string, action: ActionSummary, fallbackLabel: string, preferOwnLabel = false) {
  const s = vx();
  const label = preferOwnLabel ? fallbackLabel : actionText(action.summary, action.restoredTo) || fallbackLabel;
  if (action.undoable && action.status === 'committed') s.registerUndo({ label, actionId: action.id, workspaceId: ws });
  s.refresh();
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Storage said "busy, try again": all upload slots taken, the write ceiling, a brief outage. */
export function isBusyError(e: unknown): boolean {
  return isApiError(e) && (e.status === 429 || e.status === 503 || e.code === 'rate_limited' || e.code === 'upstream_unavailable');
}

/**
 * Runs `fn`, retrying while storage is busy (Retry-After, else a growing
 * backoff) for up to `maxMs`. `onWait` fires before each wait, so the caller
 * can say what is going on instead of failing.
 */
export async function retryBusy<T>(fn: () => Promise<T>, opts: { maxMs?: number; onWait?: () => void } = {}): Promise<T> {
  const deadline = Date.now() + (opts.maxMs ?? 2 * 60_000);
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isBusyError(e) || Date.now() >= deadline) throw e;
      opts.onWait?.();
      const ra = isApiError(e) && e.retryAfterSeconds ? e.retryAfterSeconds * 1000 : 0;
      await wait(Math.min(Math.max(ra, 1000 * 2 ** Math.min(attempt, 4)), Math.max(0, deadline - Date.now())));
    }
  }
}

/** Collapses the rows (160 ms), removes them, deletes on the server, then offers Undo for 8 s. */
export async function deleteItems(ws: string, entries: readonly FileEntry[]): Promise<boolean> {
  if (!entries.length) return false;
  const paths = entries.map((e) => e.path);
  const byDir = groupByDir(paths);
  markPending(paths, 'delete');
  markRemoving(paths);
  await wait(160);
  try {
    const r = await optimistic(
      ws,
      [...byDir.entries()].map(([dir, ps]) => ({ dir, update: (l) => withoutPaths(l, ps) })),
      () => api.files.remove(ws, paths),
    );
    const s = vx();
    s.select(s.selection.filter((p) => !paths.includes(p)), 'replace');
    const panel = s.panel;
    if (panel && paths.some((p) => panel.path === p || panel.path.startsWith(p + '/'))) s.closePanel();
    afterAction(ws, r.action, `Deleted ${itemsLabel(entries)}`, true);
    return true;
  } catch (e) {
    vx().toast({ kind: 'error', message: `Couldn't delete ${itemsLabel(entries)}. ${friendlyError(e)}` });
    return false;
  } finally {
    clearPending(paths);
  }
}

export async function renameItem(ws: string, entry: FileEntry, newName: string): Promise<boolean> {
  const dir = dirname(entry.path);
  const to = joinPath(dir, newName);
  if (to === entry.path) return true;
  const wasSelected = vx().selection.includes(entry.path);
  markPending([to], 'rename');
  try {
    const r = await optimistic(ws, [{ dir, update: (l) => withRenamed(l, entry.path, to) }], () => api.files.move(ws, [{ from: entry.path, to }]));
    const s = vx();
    if (wasSelected) s.select([...s.selection.filter((p) => p !== entry.path && p !== to), to], 'replace');
    if (s.panel?.path === entry.path) {
      if (s.panel.kind === 'preview') s.openPreview(to, { at: s.panel.at });
      else s.openVersions(to);
    }
    afterAction(ws, r.action, `Renamed ${entry.name} to ${newName}`);
    return true;
  } catch (e) {
    vx().toast({ kind: 'error', message: `Couldn't rename ${entry.name}. ${friendlyError(e)}` });
    return false;
  } finally {
    clearPending([to]);
  }
}

export type MoveOutcome = { ok: true } | { ok: false; exists: string[] } | { ok: false; error: string };

/**
 * Moves (or copies) `paths` into `dest`. Moves are optimistic (rows leave their
 * folder at once). `renames` maps a source path to a new name (keep both).
 * A name clash comes back as `{ exists }` so the caller can offer Keep both / Replace.
 */
export async function moveItems(
  ws: string,
  paths: readonly string[],
  dest: string,
  opts: { copy?: boolean; overwrite?: boolean; renames?: Map<string, string>; quiet?: boolean } = {},
): Promise<MoveOutcome> {
  if (!paths.length) return { ok: true };
  const items = paths.map((p) => ({ from: p, to: joinPath(dest, opts.renames?.get(p) ?? basename(p)) }));
  const edits = opts.copy ? [] : [...groupByDir(paths).entries()].map(([dir, ps]) => ({ dir, update: (l: Parameters<typeof withoutPaths>[0]) => withoutPaths(l, ps) }));
  markPending(paths, 'move');
  try {
    const r = await optimistic(ws, edits, () => (opts.copy ? api.files.copy(ws, items, opts.overwrite) : api.files.move(ws, items, opts.overwrite)));
    const s = vx();
    if (!opts.copy) s.select(s.selection.filter((p) => !paths.includes(p)), 'replace');
    const destName = dest === '/' ? 'My Drive' : basename(dest);
    afterAction(ws, r.action, `${opts.copy ? 'Copied' : 'Moved'} ${paths.length === 1 ? basename(paths[0]) : `${paths.length} items`} to ${destName}`);
    return { ok: true };
  } catch (e) {
    if (isApiError(e) && e.code === 'path_exists') {
      const raw = (e.details as { paths?: unknown }).paths;
      const exists = Array.isArray(raw) ? raw.map(String) : items.map((i) => i.to);
      return { ok: false, exists };
    }
    const msg = friendlyError(e);
    if (!opts.quiet) vx().toast({ kind: 'error', message: `Couldn't ${opts.copy ? 'copy' : 'move'} ${paths.length === 1 ? basename(paths[0]) : `${paths.length} items`}. ${msg}` });
    return { ok: false, error: msg };
  } finally {
    clearPending(paths);
  }
}

export async function createFolder(ws: string, parent: string, name: string): Promise<string | null> {
  const path = joinPath(parent, name);
  markPending([path], 'create');
  try {
    const r = await optimistic(
      ws,
      [{ dir: parent, update: (l) => withAdded(l, { path, name, type: 'dir', size: 0, mtime: Date.now() }) }],
      // A new folder is an upload plan: when every upload slot is busy it waits its turn.
      () => retryBusy(() => api.files.createFolder(ws, path), { onWait: () => markPending([path], 'waiting') }),
    );
    afterAction(ws, r.action, `Created folder ${name}`);
    return path;
  } catch (e) {
    vx().toast({ kind: 'error', message: `Couldn't create ${name}. ${friendlyError(e)}` });
    return null;
  } finally {
    clearPending([path]);
  }
}

/** Starts a browser download without leaving the page. */
export function triggerDownload(url: string): void {
  if (typeof document === 'undefined') return;
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.download = '';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** A file downloads as itself; a folder or several items as one zip. */
export function downloadEntries(ws: string, entries: readonly FileEntry[], at: string | null): void {
  if (!entries.length) return;
  if (entries.length === 1 && entries[0].type === 'file') {
    triggerDownload(contentUrl(ws, entries[0].path, { at, download: true }));
    return;
  }
  triggerDownload(zipUrl(ws, entries.map((e) => e.path), at));
}

/** Opens the compare page for a file's current version against the one before it. */
export async function compareWithPrevious(ws: string, path: string, push: (href: string) => void): Promise<void> {
  try {
    const r = await api.versioning.versions(ws, path);
    const cur = r.versions.findIndex((v) => v.isCurrent);
    const curIdx = cur >= 0 ? cur : 0;
    const current = r.versions[curIdx];
    const prev = r.versions.slice(curIdx + 1).find((v) => v.commitId !== current?.commitId);
    if (!current || !prev) {
      vx().toast({ kind: 'info', message: `${basename(path)} has no earlier version yet.` });
      return;
    }
    push(compareHref(path, prev.commitId, current.commitId));
  } catch (e) {
    vx().toast({ kind: 'error', message: `Couldn't load versions. ${friendlyError(e)}` });
  }
}

function groupByDir(paths: readonly string[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const p of paths) {
    const d = dirname(p);
    const list = m.get(d);
    if (list) list.push(p);
    else m.set(d, [p]);
  }
  return m;
}

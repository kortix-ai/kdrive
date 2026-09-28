'use client';

// The drive (architecture §9.4, DESIGN §6.2–6.3, 6.12–6.14): top bar, column
// header / selection bar, virtualised list or grid, marquee, drag-and-drop
// moves, context menus, inline rename and new folder, keyboard map, search.
// In the past (store.timeTravel) every read passes `at`, writes are disabled
// with the reason, and rows say how they differ from now.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Copy, Download, FolderInput, Share2, Trash, X } from 'lucide-react';
import { basename, dirname, type FileEntry } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cx } from '@/components/ui/cx';
import { isApiError } from '@/lib/api/client';
import { useListing, useNowListing } from '@/lib/api/hooks';
import { compareWithPrevious, deleteItems, downloadEntries, createFolder, moveItems, renameItem } from '@/lib/drive/actions';
import { computeDrift } from '@/lib/drive/drift';
import { computeGridLayout } from '@/lib/drive/layout';
import { requestReveal, setDragging, useDriveRows } from '@/lib/drive/optimistic';
import {
  DRAG_MIME,
  clickSelection,
  isInternalDrag,
  itemsInRect,
  movablePaths,
  normRect,
  rangeBetween,
  stepFocus,
  type ItemRect,
  type Rect,
} from '@/lib/drive/selection';
import { DEFAULT_SORT, loadSort, nextSort, saveSort, sortEntries, type SortKey, type SortSpec } from '@/lib/drive/sort';
import { formatTimeTravelLabel } from '@/lib/format';
import { isTypingTarget, useHotkeys } from '@/lib/keys';
import { useVx } from '@/lib/store';
import { compareHref, driveHref } from '@/lib/urls';
import { useUploadPrompts } from '@/lib/upload/prompts';
import { startUpload } from '@/lib/upload/uploads';
import { pickUploadSources } from '@/lib/upload/walk';
import DriveContextMenu, { buildDriveMenu, type DriveCommands } from './context-menu';
import { DriveCtx, READ_ONLY_REASON, type DriveCtxValue } from './drive-context';
import EmptyDrive, { type EmptyKind } from './empty-drive';
import FileGrid from './file-grid';
import FileList, { type ListRow } from './file-list';
import { Bytes, Check, LIST_COLS, ROW_H } from './file-row';
import MoveCopyDialog, { type MoveCopyRequest } from './move-copy-dialog';
import { SearchPalette } from './search-box';
import type { PaletteItem } from './search-results';
import SelectionRect from './selection-rect';
import Toolbar from './toolbar';
import s from './drive.module.css';

type MenuState = { x: number; y: number; targets: FileEntry[] } | null;

function SortHead({ label, k, sort, onSort, align = 'left' }: { label: string; k: SortKey; sort: SortSpec; onSort: (k: SortKey) => void; align?: 'left' | 'right' }) {
  const on = sort.key === k;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cx('vx-label inline-flex items-center gap-1 hover:text-vx-text-1', on && 'text-vx-text-2', align === 'right' && 'justify-end')}
    >
      {label}
      <span aria-hidden className={cx('w-2', on ? 'opacity-100' : 'opacity-0')}>
        {sort.dir === 'asc' ? '▲' : '▼'}
      </span>
    </button>
  );
}

export default function FileBrowser({ path }: { path: string }) {
  const router = useRouter();
  const ws = useVx((st) => st.workspaceId);
  const me = useVx((st) => st.me);
  const tt = useVx((st) => st.timeTravel);
  const view = useVx((st) => st.view);
  const selectionArr = useVx((st) => st.selection);
  const anchor = useVx((st) => st.anchor);
  const panel = useVx((st) => st.panel);
  const storeDialogOpen = useVx((st) => !!(st.share || st.restore || st.checkpoint || st.duplicate));
  const promptOpen = useUploadPrompts((st) => !!(st.conflict || st.quota));
  const { pending, removing, dragging, reveal } = useDriveRows();

  const at = tt?.commitId ?? null;
  const past = !!tt;
  const pastLabel = tt ? formatTimeTravelLabel(tt.createdAt) : '';
  const rootName = me?.workspaces.find((w) => w.id === ws)?.name ?? 'My Drive';

  const listing = useListing(path);
  const nowListing = useNowListing(path, past);

  const [sort, setSort] = useState<SortSpec>(DEFAULT_SORT);
  useEffect(() => setSort(loadSort()), []);
  const onSort = (k: SortKey) => {
    const next = nextSort(sort, k);
    setSort(next);
    saveSort(next);
  };

  const [focus, setFocus] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<MenuState>(null);
  const [moveReq, setMoveReq] = useState<MoveCopyRequest | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addedLaterOpen, setAddedLaterOpen] = useState(false);
  const [dropDir, setDropDir] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [width, setWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset per-folder UI when the folder or the viewed version changes.
  useEffect(() => {
    setFocus(null);
    setRenaming(null);
    setCreating(false);
    setAddedLaterOpen(false);
    setMenu(null);
  }, [path, at, ws]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [ws]);

  // ── data ────────────────────────────────────────────────────────────────
  const data = listing.data;
  const err = listing.error as unknown;
  const errCode = isApiError(err) ? err.code : null;
  const hardError = errCode === 'version_gone' || errCode === 'path_not_found' || errCode === 'not_a_directory' || errCode === 'invalid_path' || errCode === 'not_found';
  const stale = !!data && data.path !== path;
  const entries = useMemo(() => (data && !hardError ? sortEntries(data.entries, sort) : []), [data, sort, hardError]);
  const byPath = useMemo(() => new Map(entries.map((e) => [e.path, e])), [entries]);
  const order = useMemo(() => entries.map((e) => e.path), [entries]);
  // The folder may not exist any more: then every past row is "gone now".
  const goneNow = isApiError(nowListing.error, 'path_not_found') || isApiError(nowListing.error, 'not_a_directory');
  // Drift compares THIS version's listing with a fresh one at head: never while
  // either is still the previous frame (stepping, re-entering time travel).
  const nowFresh = !!nowListing.data && !nowListing.isValidating && nowListing.data.path === path;
  const drift = useMemo(() => {
    if (!past || !data || stale || data.commitId !== at) return null;
    if (goneNow) return computeDrift(data.entries, []);
    return nowFresh ? computeDrift(data.entries, nowListing.data!.entries) : null;
  }, [past, data, stale, at, nowFresh, nowListing.data, goneNow]);
  const addedLater = useMemo(() => (drift ? sortEntries(drift.addedLater, sort) : []), [drift, sort]);
  const selection = useMemo(() => new Set(selectionArr), [selectionArr]);
  const selectedEntries = useMemo(() => selectionArr.map((p) => byPath.get(p)).filter((e): e is FileEntry => !!e), [selectionArr, byPath]);
  const draggingSet = useMemo(() => new Set(dragging), [dragging]);

  // Select + scroll to a search result once its folder is listed.
  useEffect(() => {
    if (!reveal || !data || stale || dirname(reveal) !== path) return;
    if (byPath.has(reveal)) {
      useVx.getState().select([reveal], 'replace');
      setFocus(reveal);
    }
    requestReveal(null);
  }, [reveal, data, stale, path, byPath]);

  // Drop selected paths that vanished from the listing (moved elsewhere, refreshed).
  useEffect(() => {
    if (!data || stale || listing.isValidating) return;
    const st = useVx.getState();
    if (st.selection.length && st.selection.some((p) => !byPath.has(p))) st.select(st.selection.filter((p) => byPath.has(p)), 'replace');
  }, [data, stale, byPath, listing.isValidating]);

  // ── rows / layout ─────────────────────────────────────────────────────────
  const listRows: ListRow[] = useMemo(() => {
    const rows: ListRow[] = [];
    if (creating) rows.push({ kind: 'new' });
    for (const e of entries) rows.push({ kind: 'entry', entry: e });
    if (addedLater.length) {
      rows.push({ kind: 'footer', count: addedLater.length });
      if (addedLaterOpen) for (const e of addedLater) rows.push({ kind: 'ghost', entry: e });
    }
    return rows;
  }, [creating, entries, addedLater, addedLaterOpen]);

  const gridLayout = useMemo(
    () =>
      view === 'grid'
        ? computeGridLayout({
            width: width || 800,
            folders: entries.filter((e) => e.type === 'dir'),
            files: entries.filter((e) => e.type !== 'dir'),
            creating,
            ghosts: addedLaterOpen ? addedLater : [],
            addedLaterCount: addedLater.length,
          })
        : null,
    [view, width, entries, creating, addedLater, addedLaterOpen],
  );

  const itemRects: ItemRect[] = useMemo(() => {
    if (gridLayout) return gridLayout.itemRects;
    const out: ItemRect[] = [];
    listRows.forEach((r, i) => {
      if (r.kind === 'entry') out.push({ path: r.entry.path, rect: { x: 0, y: i * ROW_H, w: width || 1000, h: ROW_H } });
    });
    return out;
  }, [gridLayout, listRows, width]);

  const focusIndex = focus ? listRows.findIndex((r) => r.kind === 'entry' && r.entry.path === focus) : -1;
  const focusRow = focus && gridLayout ? (gridLayout.rowOf.get(focus) ?? -1) : -1;

  // ── commands ──────────────────────────────────────────────────────────────
  const vx = useVx.getState;
  const readOnly = () => vx().toast({ kind: 'info', message: READ_ONLY_REASON });

  const targets = useCallback((): FileEntry[] => {
    const sel = useVx.getState().selection.map((p) => byPath.get(p)).filter((e): e is FileEntry => !!e);
    if (sel.length) return sel;
    const f = focus ? byPath.get(focus) : undefined;
    return f ? [f] : [];
  }, [byPath, focus]);

  const single = (): FileEntry | null => {
    const t = targets();
    return t.length === 1 ? t[0] : null;
  };

  const uploadFiles = (folder: boolean) => {
    if (past) return readOnly();
    void pickUploadSources(folder).then((sources) => {
      if (sources) startUpload({ basePath: path, sources });
    });
  };

  const newFolder = () => {
    if (past) return readOnly();
    setRenaming(null);
    setCreating(true);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const openEntry = (e: FileEntry) => {
    if (e.type === 'dir') router.push(driveHref(e.path));
    else vx().openPreview(e.path);
  };

  const cmd: DriveCommands = {
    open: openEntry,
    preview: (e) => vx().openPreview(e.path),
    download: (es) => ws && downloadEntries(ws, es, at),
    rename: (e) => {
      if (past) return readOnly();
      setCreating(false);
      setRenaming(e.path);
      setFocus(e.path);
    },
    moveTo: (es) => (past ? readOnly() : setMoveReq({ mode: 'move', entries: es, startDir: path })),
    copyTo: (es) => (past ? readOnly() : setMoveReq({ mode: 'copy', entries: es, startDir: path })),
    versions: (e) => vx().openVersions(e.path),
    comparePrevious: (e) => ws && void compareWithPrevious(ws, e.path, (href) => router.push(href)),
    compareWithNow: (e) => at && router.push(compareHref(e.path, at, nowListing.data?.commitId ?? 'head')),
    share: (e) => vx().openShare(e.path),
    checkpoint: () => vx().openCheckpoint(null),
    remove: (es) => {
      if (past) return readOnly();
      if (ws && es.length) void deleteItems(ws, es);
    },
    restore: (e) => at && vx().openRestore({ scope: e.type === 'dir' ? 'folder' : 'file', path: e.path, at }),
    showInPresent: (e) => {
      vx().exitTimeTravel();
      requestReveal(e.path);
      if (dirname(e.path) !== path) router.push(driveHref(dirname(e.path)));
    },
    uploadFiles: () => uploadFiles(false),
    uploadFolder: () => uploadFiles(true),
    newFolder,
  };

  const canDropInto = (dest: string) => {
    const d = useDriveRows.getState().dragging;
    return d.length > 0 && movablePaths(d, dest, dirname).length > 0;
  };

  const dropInto = async (dest: string, copy: boolean) => {
    const d = useDriveRows.getState().dragging;
    setDragging([]);
    setDropDir(null);
    if (!ws || past) return;
    const paths = copy ? d.filter((p) => !(dest === p || dest.startsWith(p + '/'))) : movablePaths(d, dest, dirname);
    if (!paths.length) return;
    const r = await moveItems(ws, paths, dest, { copy });
    if (!r.ok && 'exists' in r) {
      const es = paths.map((p) => byPath.get(p) ?? { path: p, name: basename(p), type: 'file' as const, size: 0, mtime: 0 });
      setMoveReq({ mode: copy ? 'copy' : 'move', entries: es, startDir: dest, exists: r.exists });
    }
  };

  const onPalettePick = (it: PaletteItem, revealIt: boolean) => {
    const st = vx();
    if (it.kind === 'goto') {
      if (it.entry.isHead) st.exitTimeTravel();
      else st.enterTimeTravel({ commitId: it.entry.commitId, createdAt: it.entry.createdAt });
      return;
    }
    const e = it.entry;
    if (e.type === 'dir' && !revealIt) {
      router.push(driveHref(e.path));
      return;
    }
    const parent = dirname(e.path);
    requestReveal(e.path);
    if (parent !== path) router.push(driveHref(parent));
    if (e.type === 'file' && !revealIt) st.openPreview(e.path);
  };

  // ── keyboard ──────────────────────────────────────────────────────────────
  const overlayOpen = paletteOpen || !!menu || !!moveReq || storeDialogOpen || promptOpen;

  const moveFocus = (delta: number, extend: boolean) => {
    const next = stepFocus(order, focus, delta);
    if (!next) return;
    const st = vx();
    if (extend) {
      const a = st.anchor ?? focus ?? next;
      if (!st.anchor) st.select([a], 'replace');
      st.select(rangeBetween(order, a, next), 'range');
    } else {
      st.select([next], 'replace');
      const e = byPath.get(next);
      if (st.panel?.kind === 'preview' && e?.type === 'file') st.openPreview(next);
    }
    setFocus(next);
  };
  const vStep = gridLayout ? gridLayout.cols : 1;

  useHotkeys(
    {
      '/': () => setPaletteOpen(true),
      'mod+k': () => setPaletteOpen(true),
      u: () => uploadFiles(false),
      'shift+u': () => uploadFiles(true),
      n: newFolder,
      v: () => vx().setView(view === 'list' ? 'grid' : 'list'),
      f2: () => {
        const t = single();
        if (t) cmd.rename(t);
      },
      delete: () => cmd.remove(targets()),
      backspace: () => cmd.remove(targets()),
      'mod+backspace': () => cmd.remove(targets()),
      d: () => cmd.download(targets()),
      m: () => {
        const t = targets();
        if (t.length) cmd.moveTo(t);
      },
      'shift+m': () => {
        const t = targets();
        if (t.length) cmd.copyTo(t);
      },
      s: () => {
        const t = single();
        if (t) cmd.share(t);
      },
      'shift+h': () => {
        const t = single();
        if (t?.type === 'file') cmd.versions(t);
      },
      ...(past
        ? {
            r: () => {
              const t = single();
              if (t) cmd.restore(t);
            },
          }
        : {
            c: () => {
              const t = single();
              if (t?.type === 'file') cmd.comparePrevious(t);
            },
          }),
      arrowdown: () => moveFocus(vStep, false),
      arrowup: () => moveFocus(-vStep, false),
      'shift+arrowdown': () => moveFocus(vStep, true),
      'shift+arrowup': () => moveFocus(-vStep, true),
      j: () => moveFocus(vStep, false),
      k: () => moveFocus(-vStep, false),
      'shift+j': () => moveFocus(vStep, true),
      'shift+k': () => moveFocus(-vStep, true),
      ...(gridLayout && panel?.kind !== 'preview'
        ? {
            arrowright: () => moveFocus(1, false),
            arrowleft: () => moveFocus(-1, false),
            'shift+arrowright': () => moveFocus(1, true),
            'shift+arrowleft': () => moveFocus(-1, true),
          }
        : {}),
      'mod+a': () => {
        vx().select(order, 'replace');
      },
    },
    { enabled: !overlayOpen && !renaming && !creating && !!ws },
  );

  // ↵ opens, Space toggles the preview. Handled here (not useHotkeys) so a
  // focused button or link keeps its own ↵ / Space activation.
  const openKeys = useRef<(e: KeyboardEvent) => void>(() => {});
  openKeys.current = (e) => {
    if (overlayOpen || renaming || creating) return;
    const t = (focus ? byPath.get(focus) : undefined) ?? single();
    if (!t) return;
    e.preventDefault();
    if (e.key === 'Enter') openEntry(t);
    else {
      const st = vx();
      if (st.panel?.kind === 'preview' && st.panel.path === t.path) st.closePanel();
      else if (t.type === 'file') st.openPreview(t.path);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing || isTypingTarget(e.target)) return;
      if ((e.target as HTMLElement | null)?.closest?.('button,a,[role="menuitem"],[role="option"] button,summary,[role="dialog"]')) return;
      openKeys.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Esc layer: close the panel, then clear the selection (then "back to now" belongs to the banner).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"],[role="menu"]')) return;
      const st = useVx.getState();
      if (st.panel) {
        e.preventDefault();
        st.closePanel();
      } else if (st.selection.length) {
        e.preventDefault();
        st.clearSelection();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // ── marquee ───────────────────────────────────────────────────────────────
  const onBlankMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('[role="option"],button,input,a,[data-no-marquee]')) return;
    const el = scrollRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (e.clientX > box.left + el.clientWidth) return; // scrollbar
    const toContent = (cx0: number, cy0: number) => ({ x: cx0 - box.left + el.scrollLeft, y: cy0 - box.top + el.scrollTop });
    const start = toContent(e.clientX, e.clientY);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = additive ? useVx.getState().selection : [];
    if (!additive) useVx.getState().clearSelection();
    setFocus(null);
    let moved = false;
    let last = { x: e.clientX, y: e.clientY };
    let raf = 0;
    const update = () => {
      const b = el.getBoundingClientRect();
      const cur = { x: last.x - b.left + el.scrollLeft, y: last.y - b.top + el.scrollTop };
      const rect = normRect(start, cur);
      if (!moved && rect.w < 4 && rect.h < 4) return;
      moved = true;
      setMarquee(rect);
      const hits = itemsInRect(itemRects, rect);
      useVx.getState().select([...new Set([...base, ...hits])], 'range');
    };
    const onMove = (ev: MouseEvent) => {
      last = { x: ev.clientX, y: ev.clientY };
      const b = el.getBoundingClientRect();
      if (ev.clientY < b.top + 24) el.scrollTop -= 16;
      else if (ev.clientY > b.bottom - 24) el.scrollTop += 16;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    const onUp = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      el.removeEventListener('scroll', onScroll);
      setMarquee(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    el.addEventListener('scroll', onScroll);
  };

  // ── item handlers (context) ──────────────────────────────────────────────
  const ctx: DriveCtxValue = {
    ws: ws ?? '',
    at,
    past,
    pastLabel,
    path,
    selection,
    focus,
    drift: drift?.byPath ?? null,
    pending,
    removing,
    dragging: draggingSet,
    dropDir,
    renaming,
    siblings: entries,
    addedLaterOpen,
    onItemMouseDown: (e, entry) => {
      if (e.button !== 0) return;
      setFocus(entry.path);
      if (!e.shiftKey && !e.metaKey && !e.ctrlKey && !selection.has(entry.path)) vx().select([entry.path], 'replace');
    },
    onItemClick: (e, entry) => {
      const mods = { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey };
      const st = vx();
      if (mods.shift || mods.toggle) {
        const r = clickSelection(order, st.selection, anchor, entry.path, mods);
        st.select(r.paths, r.mode);
      } else if (st.selection.length !== 1 || st.selection[0] !== entry.path) {
        st.select([entry.path], 'replace');
      }
      if (!mods.shift && !mods.toggle && st.panel?.kind === 'preview' && entry.type === 'file' && st.panel.path !== entry.path) st.openPreview(entry.path);
    },
    onOpen: openEntry,
    onContextMenu: (e, entry) => {
      e.preventDefault();
      e.stopPropagation();
      if (!entry) {
        setMenu({ x: e.clientX, y: e.clientY, targets: [] });
        return;
      }
      let t = selectedEntries;
      if (!selection.has(entry.path)) {
        vx().select([entry.path], 'replace');
        t = [entry];
      }
      setFocus(entry.path);
      setMenu({ x: e.clientX, y: e.clientY, targets: t });
    },
    onMenuButton: (e, entry) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      let t = selectedEntries;
      if (!selection.has(entry.path)) {
        vx().select([entry.path], 'replace');
        t = [entry];
      }
      setMenu({ x: r.right - 220, y: r.bottom + 4, targets: t });
    },
    onCheck: (entry) => vx().select([entry.path], 'toggle'),
    onDragStart: (e, entry) => {
      if (past) {
        e.preventDefault();
        return;
      }
      const paths = selection.has(entry.path) ? [...selectionArr] : [entry.path];
      if (!selection.has(entry.path)) vx().select([entry.path], 'replace');
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(paths));
      e.dataTransfer.setData('text/plain', paths.map((p) => basename(p)).join('\n'));
      e.dataTransfer.effectAllowed = 'copyMove';
      const chip = document.createElement('div');
      chip.textContent = paths.length === 1 ? basename(paths[0]) : `${paths.length} items`;
      chip.style.cssText =
        'position:fixed;top:-100px;left:-100px;padding:4px 8px;font:500 12px var(--vx-font-mono);color:var(--vx-text-1);background:var(--vx-float);border:1px solid var(--vx-hair-strong);white-space:nowrap';
      document.body.appendChild(chip);
      e.dataTransfer.setDragImage(chip, -8, -8);
      setTimeout(() => chip.remove(), 0);
      setDragging(paths);
    },
    onDragEnd: () => {
      setDragging([]);
      setDropDir(null);
    },
    onFolderDragOver: (e, entry) => {
      if (past || !isInternalDrag(e.dataTransfer) || !canDropInto(entry.path)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move';
      if (dropDir !== entry.path) setDropDir(entry.path);
    },
    onFolderDragLeave: (e, entry) => {
      const to = e.relatedTarget as Node | null;
      if (to && (e.currentTarget as Node).contains(to)) return;
      setDropDir((d) => (d === entry.path ? null : d));
    },
    onFolderDrop: (e, entry) => {
      if (!isInternalDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      void dropInto(entry.path, e.altKey);
    },
    onRestore: (entry) => cmd.restore(entry),
    onRenameSubmit: (entry, name) => {
      setRenaming(null);
      if (ws) void renameItem(ws, entry, name);
    },
    onRenameCancel: () => {
      setRenaming(null);
      scrollRef.current?.focus({ preventScroll: true });
    },
    onCreateFolder: (name) => {
      setCreating(false);
      if (!ws) return;
      void createFolder(ws, path, name).then((p) => {
        if (p) {
          vx().select([p], 'replace');
          setFocus(p);
        }
      });
      scrollRef.current?.focus({ preventScroll: true });
    },
    onCancelCreate: () => {
      setCreating(false);
      scrollRef.current?.focus({ preventScroll: true });
    },
    onToggleAddedLater: () => setAddedLaterOpen((o) => !o),
  };

  // ── render ────────────────────────────────────────────────────────────────
  let empty: EmptyKind | null = null;
  if (hardError) {
    if (errCode === 'version_gone') empty = { kind: 'version-gone' };
    else empty = past ? { kind: 'past-missing', when: pastLabel } : { kind: 'missing' };
  } else if (err && !data) {
    empty = { kind: 'error', message: err instanceof Error ? err.message : 'Unknown error.' };
  } else if (data && !stale && entries.length === 0 && !creating && !addedLater.length) {
    empty = past ? { kind: 'past-empty', when: pastLabel } : path === '/' ? { kind: 'drive' } : { kind: 'folder' };
  }
  const loadingFirst = !data && !err;
  const fetching = !!data && (listing.isValidating || stale);
  const selSize = selectedEntries.reduce((n, e) => n + (e.type === 'file' ? e.size : 0), 0);
  const one = selectedEntries.length === 1 ? selectedEntries[0] : null;

  const menuItems = menu ? buildDriveMenu({ targets: menu.targets, past, drift: drift?.byPath ?? null, cmd }) : [];

  if (!ws) return null;

  return (
    <DriveCtx.Provider value={ctx}>
      <div className="relative flex h-full min-h-0 flex-col">
        <Toolbar
          path={path}
          rootName={rootName}
          past={past}
          view={view}
          onView={(v) => vx().setView(v)}
          onNavigate={(p) => router.push(driveHref(p))}
          onDropItems={(dest) => void dropInto(dest, false)}
          canDropInto={canDropInto}
          onOpenSearch={() => setPaletteOpen(true)}
          onNewFolder={newFolder}
          onUploadFiles={() => uploadFiles(false)}
          onUploadFolder={() => uploadFiles(true)}
        />

        <div className="relative">{fetching ? <span className={past ? s.pastLine : s.nowLine} aria-hidden /> : null}</div>

        {selectedEntries.length > 0 ? (
          <div key="sel" className={cx(s.selIn, 'flex h-8 shrink-0 items-center gap-1 border-b border-vx-hair bg-vx-surface-2 pl-3 pr-2')} role="toolbar" aria-label="Selection">
            <span className="flex w-7 items-center">
              <Check
                on
                visible
                label={selectedEntries.length === entries.length ? 'Clear selection' : 'Select all'}
                onToggle={() => (selectedEntries.length === entries.length ? vx().clearSelection() : vx().select(order, 'replace'))}
              />
            </span>
            <span className="vx-meta mr-2 whitespace-nowrap text-vx-text-1">
              {selectedEntries.length} selected
              {selSize ? (
                <span className="text-vx-text-3">
                  {' '}
                  · <Bytes n={selSize} />
                </span>
              ) : null}
            </span>
            <Button size="sm" variant="ghost" icon={<Download size={13} aria-hidden />} kbd="D" onClick={() => cmd.download(selectedEntries)}>
              {one?.type === 'file' ? 'Download' : 'Download .zip'}
            </Button>
            {past ? (
              <>
                {one ? (
                  <Button size="sm" variant="restore" kbd="R" onClick={() => cmd.restore(one)}>
                    Restore
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" icon={<FolderInput size={13} aria-hidden />} kbd="M" onClick={() => cmd.moveTo(selectedEntries)} className="max-[1000px]:[&>kbd]:hidden">
                  Move
                </Button>
                <Button size="sm" variant="ghost" icon={<Copy size={13} aria-hidden />} kbd="⇧M" onClick={() => cmd.copyTo(selectedEntries)} className="max-[1000px]:[&>kbd]:hidden">
                  Copy
                </Button>
              </>
            )}
            {one ? (
              <Button size="sm" variant="ghost" icon={<Share2 size={13} aria-hidden />} kbd="S" onClick={() => cmd.share(one)} className="max-[1100px]:hidden">
                Share
              </Button>
            ) : null}
            {one?.type === 'file' ? (
              <Button size="sm" variant="ghost" icon={<Clock size={13} aria-hidden />} kbd="⇧H" onClick={() => cmd.versions(one)} className="max-[1200px]:hidden">
                Versions
              </Button>
            ) : null}
            {past ? (
              <Tooltip label={READ_ONLY_REASON}>
                <Button size="sm" variant="ghost" icon={<Trash size={13} aria-hidden />} disabled>
                  Delete
                </Button>
              </Tooltip>
            ) : (
              <Button size="sm" variant="ghost" icon={<Trash size={13} aria-hidden />} kbd="⌫" onClick={() => cmd.remove(selectedEntries)} className="text-vx-danger hover:text-vx-danger">
                Delete
              </Button>
            )}
            <span className="flex-1" />
            <Button size="sm" variant="ghost" icon={<X size={13} aria-hidden />} kbd="Esc" onClick={() => vx().clearSelection()} aria-label="Clear selection" />
          </div>
        ) : (
          <div
            key="head"
            className={cx('h-8 shrink-0 items-center border-b border-vx-hair bg-vx-surface-2 px-3', view === 'grid' ? 'flex gap-4' : 'grid')}
            style={view === 'list' ? { gridTemplateColumns: LIST_COLS } : undefined}
          >
            <span className="flex items-center">
              <Check on={false} visible={false} label="Select all" onToggle={() => vx().select(order, 'replace')} />
            </span>
            {view === 'list' ? <span /> : null}
            <span className="flex min-w-0 items-center justify-between pr-3">
              <SortHead label="Name" k="name" sort={sort} onSort={onSort} />
              {view === 'list' ? (
                <span className="vx-meta text-vx-text-4">
                  {data && !hardError ? `${entries.length.toLocaleString()} ${entries.length === 1 ? 'item' : 'items'}` : ''}
                </span>
              ) : null}
            </span>
            <span className={cx('vx-col-mtime', view === 'list' && 'text-right')}>
              <SortHead label="Modified" k="mtime" sort={sort} onSort={onSort} align={view === 'list' ? 'right' : 'left'} />
            </span>
            <span className={cx(view === 'list' && 'text-right')}>
              <SortHead label="Size" k="size" sort={sort} onSort={onSort} align={view === 'list' ? 'right' : 'left'} />
            </span>
            {view === 'grid' ? (
              <span className="vx-meta ml-auto text-vx-text-4">{data && !hardError ? `${entries.length.toLocaleString()} items` : ''}</span>
            ) : (
              <span />
            )}
          </div>
        )}

        {err && data && !hardError ? (
          <div className="vx-meta flex h-7 shrink-0 items-center gap-2 border-b border-vx-hair px-3 text-vx-danger" role="alert">
            Couldn't refresh this folder. <button type="button" className="vx-ui text-vx-text-2 hover:text-vx-text-1" onClick={() => void listing.mutate()}>Retry</button>
          </div>
        ) : null}

        <div
          ref={scrollRef}
          tabIndex={0}
          aria-label="Drive contents"
          onMouseDown={onBlankMouseDown}
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest('[role="option"]')) return;
            ctx.onContextMenu(e, null);
          }}
          className={cx('relative min-h-0 flex-1 overflow-auto outline-none', stale && 'opacity-60 transition-opacity duration-[120ms]')}
        >
          {loadingFirst ? (
            <div aria-busy className="px-3 pt-2">
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="grid h-8 items-center" style={{ gridTemplateColumns: LIST_COLS }}>
                  <span />
                  <span className="skeleton h-3.5 w-3.5" />
                  <span className="skeleton skel-line" style={{ width: `${30 + ((i * 37) % 40)}%` }} />
                  <span className="vx-col-mtime skeleton skel-line ml-auto w-12" />
                  <span className="skeleton skel-line ml-auto w-10" />
                  <span />
                </div>
              ))}
            </div>
          ) : empty ? (
            <EmptyDrive
              state={empty}
              onUpload={() => uploadFiles(false)}
              onNewFolder={newFolder}
              onBackToNow={() => vx().exitTimeTravel()}
              onGoHome={() => router.push('/drive')}
              onRetry={() => void listing.mutate()}
            />
          ) : gridLayout ? (
            <FileGrid layout={gridLayout} scrollRef={scrollRef} focusRow={focusRow} />
          ) : (
            <FileList rows={listRows} scrollRef={scrollRef} focusIndex={focusIndex} />
          )}
          <SelectionRect rect={marquee} />
        </div>
      </div>

      <DriveContextMenu at={menu ? { x: menu.x, y: menu.y } : null} items={menuItems} onClose={() => setMenu(null)} />
      <MoveCopyDialog ws={ws} rootName={rootName} req={moveReq} onClose={() => setMoveReq(null)} />
      <SearchPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onPick={onPalettePick} rootName={rootName} />
    </DriveCtx.Provider>
  );
}


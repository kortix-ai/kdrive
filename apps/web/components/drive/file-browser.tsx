'use client';

// The drive (architecture §9.4, DESIGN-v2 §6.2–6.3, 6.13–6.15, §7): the sheet head
// (crumbs, title, meta, view, details), glass folder cards over a file table (list) or
// file cards (grid), the floating selection bar, virtualisation,
// marquee, drag-and-drop moves, context menus, inline rename and new folder, keyboard
// map, search palette.
// In the past (store.timeTravel) every read passes `at`, writes are disabled
// with the reason, and rows say how they differ from now.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, CircleAlert } from 'lucide-react';
import { basename, dirname, type FileEntry } from '@volumes/shared';
import { fileKind, fileKindColor } from '@/components/ui/file-icon';
import { cx } from '@/components/ui/cx';
import { isApiError } from '@/lib/api/client';
import { useListing, useNowListing } from '@/lib/api/hooks';
import { compareWithPrevious, deleteItems, downloadEntries, createFolder, moveItems, renameItem } from '@/lib/drive/actions';
import { computeDrift } from '@/lib/drive/drift';
import { computeGridLayout } from '@/lib/drive/layout';
import { requestReveal, setDragging, useDriveRows } from '@/lib/drive/optimistic';
import { toggleStars, useDriveStars } from '@/lib/drive/stars';
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
import { formatMoment, formatRelative } from '@/lib/format';
import { isTypingTarget, useHotkeys } from '@/lib/keys';
import { useShellIntents } from '@/lib/shell-intents';
import { currentRole, useVx, VIEW_ONLY_REASON } from '@/lib/store';
import { compareHref, driveHref } from '@/lib/urls';
import { useUploadPrompts } from '@/lib/upload/prompts';
import { startUpload } from '@/lib/upload/uploads';
import { pickUploadSources } from '@/lib/upload/walk';
import DriveContextMenu, { buildDriveMenu, buildFolderMenu, type DriveCommands } from './context-menu';
import { DriveCtx, READ_ONLY_REASON, type DriveCtxValue } from './drive-context';
import EmptyDrive, { DriveEmpty, type EmptyKind } from './empty-drive';
import FileGrid from './file-grid';
import { PHONE_ROW_H, ROW_H, RowCheck, listCols } from './file-row';
import MoveCopyDialog, { type MoveCopyRequest } from './move-copy-dialog';
import { SearchPalette } from './search-box';
import type { PaletteItem } from './search-results';
import SelectionBar from './selection-bar';
import SelectionRect from './selection-rect';
import Toolbar from './toolbar';
import { TaggedBar } from '@/components/labels/tagged-bar';
import { openComments, useActiveFilter, useAnnotationsUi, useLabelItems } from '@/lib/annotations';
import s from './drive.module.css';

type MenuState = { x: number; y: number; flipY?: number; align?: 'start' | 'end'; targets: FileEntry[] } | null;

/** Column header button (UNIFY-SPEC §12.1): `.vx-colhead` (Mono 12 UPPERCASE); the sort column is text-1 with a 12 px arrow. */
function SortHead({ label, k, sort, onSort, align = 'left' }: { label: string; k: SortKey; sort: SortSpec; onSort: (k: SortKey) => void; align?: 'left' | 'right' }) {
  const on = sort.key === k;
  const Arrow = sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cx(
        'vx-colhead -mx-1 inline-flex h-7 items-center gap-1 rounded-vx-sm px-1 transition-colors duration-[120ms] hover:!text-vx-text-1',
        on ? '!text-vx-text-1' : '!text-vx-text-3',
        align === 'right' && 'flex-row-reverse',
      )}
    >
      {label}
      <Arrow size={12} strokeWidth={2} aria-hidden className={cx('shrink-0', on ? 'opacity-100' : 'opacity-0')} />
    </button>
  );
}

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** The drag ghost (DESIGN-v2 §6.2): a float chip (r4, shadow-3 incl. its hair ring) with the icon + name or "2 items". */
function dragGhost(paths: string[], first: FileEntry | undefined): HTMLElement {
  const chip = document.createElement('div');
  chip.style.cssText =
    'position:fixed;top:-200px;left:-200px;display:flex;align-items:center;gap:8px;height:32px;padding:0 12px 0 10px;border-radius:4px;background:var(--vx-float);color:var(--vx-text-1);box-shadow:var(--vx-shadow-3);font:500 13px/20px var(--vx-font-sans);white-space:nowrap';
  const kind = first ? fileKind(first.name, first.type) : 'other';
  const icon = document.createElement('span');
  icon.style.cssText =
    kind === 'folder'
      ? 'width:16px;height:13px;border:1.6px solid var(--vx-ft-folder);border-radius:2px;box-sizing:border-box'
      : `width:14px;height:16px;border-radius:2px;border:1.6px solid ${fileKindColor(kind)};background:color-mix(in srgb, ${fileKindColor(kind)} var(--vx-ft-tint), transparent);box-sizing:border-box`;
  const label = document.createElement('span');
  label.textContent = paths.length === 1 ? basename(paths[0]) : `${paths.length} items`;
  chip.append(icon, label);
  return chip;
}

export default function FileBrowser({ path }: { path: string }) {
  const router = useRouter();
  const ws = useVx((st) => st.workspaceId);
  const me = useVx((st) => st.me);
  const tt = useVx((st) => st.timeTravel);
  const role = useVx(currentRole);
  const view = useVx((st) => st.view);
  const selectionArr = useVx((st) => st.selection);
  const anchor = useVx((st) => st.anchor);
  const panel = useVx((st) => st.panel);
  const timelineOpen = useVx((st) => st.timelineOpen);
  const storeDialogOpen = useVx((st) => !!(st.share || st.restore || st.checkpoint || st.duplicate));
  const promptOpen = useUploadPrompts((st) => !!(st.conflict || st.quota));
  const { pending, removing, dragging, reveal } = useDriveRows();
  const starred = useDriveStars();

  const at = tt?.commitId ?? null;
  const past = !!tt;
  // A viewer of someone else's drive changes nothing: the same lock as the past, with its own reason.
  const viewOnly = role === 'viewer';
  const locked = past || viewOnly;
  const pastLabel = tt ? formatMoment(tt.createdAt) : '';
  const rootName = me?.workspaces.find((w) => w.id === ws)?.name ?? 'My Drive';

  // The tab names what is open: the previewed file, else the folder (the drive's name at the root).
  const leaf = (p: string) => p.split('/').filter(Boolean).pop() ?? '';
  useDocumentTitle(`${(panel?.path && leaf(panel.path)) || (path === '/' ? rootName : leaf(path)) || rootName} · KDRIVE`);

  const listing = useListing(path);
  const nowListing = useNowListing(path, past);
  // A tag filter (toolbar) shows the items with that tag across the drive instead of this folder.
  const labelFilter = useActiveFilter();
  const tagged = useLabelItems(past ? null : labelFilter);
  const filtering = !!labelFilter && !past;
  // Opening a folder (from the tagged list or the crumbs) leaves the filter.
  const lastPath = useRef(path);
  useEffect(() => {
    if (lastPath.current !== path) useAnnotationsUi.getState().setFilter(null);
    lastPath.current = path;
  }, [path]);

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
  const phone = useMedia('(max-width: 720px)');
  // Compact columns when a panel or the rail takes room, or the sheet is narrow; the row
  // actions then overlay the date instead of taking a column.
  const density: DriveCtxValue['density'] = phone ? 'phone' : panel || timelineOpen || (width > 0 && width < 760) ? 'compact' : 'wide';
  const rowH = phone ? PHONE_ROW_H : ROW_H;

  // Reset per-folder UI when the folder or the viewed version changes.
  useEffect(() => {
    setFocus(null);
    setRenaming(null);
    setCreating(false);
    setAddedLaterOpen(false);
    setMenu(null);
  }, [path, at, ws]);

  // A Move/Copy picker belongs to the workspace it was opened in.
  useEffect(() => setMoveReq(null), [ws]);

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
  const entries = useMemo(
    () => (filtering ? sortEntries(tagged.data?.items ?? [], sort) : data && !hardError ? sortEntries(data.entries, sort) : []),
    [filtering, tagged.data, data, sort, hardError],
  );
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

  // ── layout: folder cards, then a file table (list) or file cards (grid) ─────
  const listView = view === 'list';
  const gridLayout = useMemo(
    () =>
      computeGridLayout({
        width: width || 800,
        folders: entries.filter((e) => e.type === 'dir'),
        files: entries.filter((e) => e.type !== 'dir'),
        creating,
        ghosts: addedLaterOpen ? addedLater : [],
        addedLaterCount: addedLater.length,
        addedLaterNames: addedLater.map((e) => e.name),
        phone,
        listRowH: listView ? rowH : undefined,
      }),
    [listView, width, entries, creating, addedLater, addedLaterOpen, phone, rowH],
  );

  const itemRects: ItemRect[] = gridLayout.itemRects;
  const focusRow = focus ? (gridLayout.rowOf.get(focus) ?? -1) : -1;

  // ── commands ──────────────────────────────────────────────────────────────
  const vx = useVx.getState;
  const readOnly = () => vx().toast({ kind: 'info', message: viewOnly ? VIEW_ONLY_REASON : READ_ONLY_REASON });

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
    if (locked) return readOnly();
    void pickUploadSources(folder).then((sources) => {
      if (sources) startUpload({ basePath: path, sources });
    });
  };

  const newFolder = () => {
    if (locked) return readOnly();
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
      if (locked) return readOnly();
      setCreating(false);
      setRenaming(e.path);
      setFocus(e.path);
    },
    moveTo: (es) => (locked ? readOnly() : ws && setMoveReq({ ws, mode: 'move', entries: es, startDir: path })),
    copyTo: (es) => (locked ? readOnly() : ws && setMoveReq({ ws, mode: 'copy', entries: es, startDir: path })),
    versions: (e) => vx().openVersions(e.path),
    comparePrevious: (e) => ws && void compareWithPrevious(ws, e.path, (href) => router.push(href)),
    compareWithNow: (e) => at && router.push(compareHref(e.path, at, nowListing.data?.commitId ?? 'head')),
    share: (e) => (viewOnly ? readOnly() : vx().openShare(e.path)),
    star: (es) => ws && !past && void toggleStars(ws, es, starred),
    requestFiles: (e) => (viewOnly ? readOnly() : vx().openShare(e.path, 'upload')),
    checkpoint: () => (viewOnly ? readOnly() : vx().openCheckpoint(null)),
    remove: (es) => {
      if (locked) return readOnly();
      if (ws && es.length) void deleteItems(ws, es);
    },
    restore: (e) => (viewOnly ? readOnly() : at && vx().openRestore({ scope: e.type === 'dir' ? 'folder' : 'file', path: e.path, at })),
    showInPresent: (e) => {
      vx().exitTimeTravel();
      requestReveal(e.path);
      if (dirname(e.path) !== path) router.push(driveHref(dirname(e.path)));
    },
    uploadFiles: () => uploadFiles(false),
    uploadFolder: () => uploadFiles(true),
    newFolder,
    comments: (e) => openComments(e.path),
    tags: (es, pos) => {
      if (past) return readOnly();
      const p = pos ?? (menu ? { x: menu.x, y: menu.y, flipY: menu.flipY } : { x: window.innerWidth / 2 - 130, y: 120 });
      useAnnotationsUi.getState().openPicker({ ...p, paths: es.map((e) => e.path) });
    },
  };

  const canDropInto = (dest: string) => {
    const d = useDriveRows.getState().dragging;
    return d.length > 0 && movablePaths(d, dest, dirname).length > 0;
  };

  const dropInto = async (dest: string, copy: boolean) => {
    const d = useDriveRows.getState().dragging;
    setDragging([]);
    setDropDir(null);
    if (!ws || locked) return;
    const paths = copy ? d.filter((p) => !(dest === p || dest.startsWith(p + '/'))) : movablePaths(d, dest, dirname);
    if (!paths.length) return;
    const r = await moveItems(ws, paths, dest, { copy });
    if (!r.ok && 'exists' in r) {
      const es = paths.map((p) => byPath.get(p) ?? { path: p, name: basename(p), type: 'file' as const, size: 0, mtime: 0 });
      setMoveReq({ ws, mode: copy ? 'copy' : 'move', entries: es, startDir: dest, exists: r.exists });
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
  // Up/down steps a whole row of the section the focus is in (one file at a time in the table).
  const vStep = focus && byPath.get(focus)?.type === 'dir' ? gridLayout.folderCols : gridLayout.cols;

  // The shell's search pill and "+ New › New folder" land here.
  useShellIntents({ search: () => setPaletteOpen(true), 'new-folder': newFolder });

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
        const t = targets();
        if (t.length && !past) cmd.star(t);
      },
      'shift+s': () => {
        const t = single();
        if (t) cmd.share(t);
      },
      'shift+h': () => {
        const t = single();
        if (t?.type === 'file') cmd.versions(t);
      },
      ...(past
        ? {
            // R restores the selected item; with nothing selected, the folder in view (the whole drive at the root).
            r: () => {
              const t = single();
              if (t) cmd.restore(t);
              else if (at) vx().openRestore(path === '/' ? { scope: 'drive', at } : { scope: 'folder', path, at });
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
      ...((!listView || (focus && byPath.get(focus)?.type === 'dir')) && panel?.kind !== 'preview'
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
    viewOnly,
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
    density,
    anySelected: selectionArr.length > 0,
    starred,
    cmd,
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
      setMenu({ x: r.right, y: r.bottom + 4, flipY: r.top - 4, align: 'end', targets: t });
    },
    onCheck: (entry) => vx().select([entry.path], 'toggle'),
    onDragStart: (e, entry) => {
      if (locked) {
        e.preventDefault();
        return;
      }
      const paths = selection.has(entry.path) ? [...selectionArr] : [entry.path];
      if (!selection.has(entry.path)) vx().select([entry.path], 'replace');
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(paths));
      e.dataTransfer.setData('text/plain', paths.map((p) => basename(p)).join('\n'));
      e.dataTransfer.effectAllowed = 'copyMove';
      const chip = dragGhost(paths, byPath.get(paths[0]) ?? entry);
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
      if (locked || !isInternalDrag(e.dataTransfer) || !canDropInto(entry.path)) return;
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
  } else if (filtering) {
    empty = null;
  } else if (data && !stale && entries.length === 0 && !creating && !addedLater.length) {
    empty = past ? { kind: 'past-empty', when: pastLabel } : path === '/' ? { kind: 'drive' } : { kind: 'folder' };
  }
  const loadingFirst = filtering ? !tagged.data : !data && !err;
  const fetching = !!data && (listing.isValidating || stale);
  const countLabel = filtering || (data && !hardError) ? `${entries.length.toLocaleString()} ${entries.length === 1 ? 'item' : 'items'}` : '';
  const menuItems = menu ? buildDriveMenu({ targets: menu.targets, past, drift: drift?.byPath ?? null, cmd, viewOnly, starred }) : [];
  const folderMenu = buildFolderMenu({
    past,
    cmd,
    share: () => vx().openShare(path),
    requestFiles: () => vx().openShare(path, 'upload'),
    history: () => vx().toggleTimeline(true),
    downloadZip: () => ws && downloadEntries(ws, [{ path, name: path === '/' ? rootName : basename(path), type: 'dir', size: 0, mtime: 0 }], at),
    renameDrive: path === '/' && role === 'owner' ? () => vx().openRenameDrive() : undefined,
    people: path === '/' ? { open: () => vx().openPeople(), owner: role === 'owner' } : undefined,
    viewOnly,
  });
  const detailsOpen = panel?.kind === 'preview' && panel.path === path;
  const allSelected = selectedEntries.length > 0 && selectedEntries.length === entries.length;
  // "8 files · 4 folders · updated 2 h ago" under the title.
  const nDirs = entries.filter((e) => e.type === 'dir').length;
  const nFiles = entries.length - nDirs;
  const newest = entries.reduce((m, e) => Math.max(m, e.mtime || 0), 0);
  const summary =
    (filtering || (data && !hardError)) && entries.length
      ? [
          nFiles ? `${nFiles.toLocaleString()} ${nFiles === 1 ? 'file' : 'files'}` : null,
          nDirs ? `${nDirs.toLocaleString()} ${nDirs === 1 ? 'folder' : 'folders'}` : null,
          newest && !filtering ? `updated ${formatRelative(newest).toLowerCase()}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : filtering
        ? ''
        : data && !hardError && !stale
          ? 'Empty'
          : '';
  // The table's column header (list view): select all · Name · Modified · Size · count.
  const listHead = phone ? (
    <div className="flex h-full items-center gap-5 px-3">
      <SortHead label="Name" k="name" sort={sort} onSort={onSort} />
      <SortHead label="Modified" k="mtime" sort={sort} onSort={onSort} />
      <SortHead label="Size" k="size" sort={sort} onSort={onSort} />
    </div>
  ) : (
    <div className={cx(s.item, 'grid h-full items-center pl-1', density === 'wide' ? 'pr-2' : 'pr-3')} style={{ gridTemplateColumns: listCols(density) }}>
      <span className="flex items-center justify-center">
        <RowCheck
          on={allSelected}
          onToggle={() => (allSelected ? vx().clearSelection() : vx().select(order, 'replace'))}
          label="Select all"
          className={cx(!allSelected && s.reveal)}
        />
      </span>
      <span className="flex min-w-0 items-center pr-4">
        <SortHead label="Name" k="name" sort={sort} onSort={onSort} />
      </span>
      <span className="vx-col-mtime min-w-0 pr-3">
        <SortHead label="Modified" k="mtime" sort={sort} onSort={onSort} />
      </span>
      <span className="flex min-w-0 justify-end pr-2">
        <SortHead label="Size" k="size" sort={sort} onSort={onSort} align="right" />
      </span>
      {density === 'wide' ? <span className="truncate pr-2 text-right font-mono text-[12px] leading-4 text-vx-text-3">{countLabel}</span> : null}
    </div>
  );
  // The grid view sorts from its first heading.
  const sortSlot = (
    <div className="flex items-center gap-4">
      <SortHead label="Name" k="name" sort={sort} onSort={onSort} />
      <span className="vx-col-mtime">
        <SortHead label="Modified" k="mtime" sort={sort} onSort={onSort} />
      </span>
      <SortHead label="Size" k="size" sort={sort} onSort={onSort} />
    </div>
  );

  if (!ws) return null;

  return (
    <DriveCtx.Provider value={ctx}>
      <div className="relative flex h-full min-h-0 flex-col">
        {fetching ? <span className={cx(s.loadLine, past && s.past)} aria-hidden /> : null}
        <Toolbar
          path={path}
          rootName={rootName}
          past={past}
          view={view}
          onView={(v) => vx().setView(v)}
          onNavigate={(p) => router.push(driveHref(p))}
          onDropItems={(dest) => void dropInto(dest, false)}
          canDropInto={canDropInto}
          folderMenu={folderMenu}
          detailsOpen={detailsOpen}
          onDetails={() => (detailsOpen ? vx().closePanel() : vx().openPreview(path))}
          phone={phone}
          missing={hardError}
          summary={summary}
        />

        {filtering ? <TaggedBar labelId={labelFilter!} count={tagged.data?.items.length ?? null} /> : null}

        {err && data && !hardError ? (
          <div className="mx-3 mt-2 flex shrink-0 items-center gap-2 rounded-vx-sm border border-vx-danger-edge bg-vx-danger-wash px-3 py-1.5 text-[13px] leading-5 text-vx-danger" role="alert">
            <CircleAlert size={16} strokeWidth={1.75} className="shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">Couldn't refresh this folder.</span>
            <button type="button" className="h-7 shrink-0 rounded-vx-sm px-2 font-medium text-vx-text-1 underline-offset-[3px] hover:underline" onClick={() => void listing.mutate()}>
              Retry
            </button>
          </div>
        ) : null}

        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* The selection bar floats over the top of the list while anything is selected, so nothing below it moves. */}
          {selectedEntries.length > 0 ? (
            <div className={cx('pointer-events-none absolute inset-x-0 top-1 z-20 flex justify-center', phone ? 'px-2' : 'px-5')}>
              <div className="pointer-events-auto w-full max-w-[880px] rounded-vx-md shadow-vx-3">
                <SelectionBar
                  key="sel"
                  entries={selectedEntries}
                  total={entries.length}
                  past={past}
                  cmd={cmd}
                  phone={phone}
                  onClear={() => vx().clearSelection()}
                  onSelectAll={() => vx().select(order, 'replace')}
                  onMore={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ x: r.right, y: r.bottom + 4, flipY: r.top - 4, align: 'end', targets: selectedEntries });
                  }}
                />
              </div>
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
            className={cx(s.scroller, 'vx-inset-focus relative min-h-0 flex-1 overflow-auto rounded-b-vx-lg outline-none', stale && 'opacity-60 transition-opacity duration-[120ms]')}
          >
            {loadingFirst ? (
              <div aria-busy className={phone ? 'px-4 pt-14' : 'px-6 pt-14'}>
                {Array.from({ length: 12 }, (_, i) => (
                  <div key={i} className={cx(s.row, 'relative grid items-center', phone ? 'pl-2' : 'pl-1 pr-3')} style={{ height: rowH, gridTemplateColumns: phone ? '40px minmax(0,1fr)' : listCols(density) }}>
                    {phone ? null : <span />}
                    <span className="flex min-w-0 items-center gap-3 pl-0.5 pr-4">
                      <span className="skeleton h-7 w-7 shrink-0 !rounded-vx-sm" />
                      {phone ? null : <span className="skeleton skel-line" style={{ width: `${30 + ((i * 37) % 40)}%` }} />}
                    </span>
                    {phone ? (
                      <span className="flex flex-col gap-2">
                        <span className="skeleton skel-line" style={{ width: `${40 + ((i * 37) % 40)}%` }} />
                        <span className="skeleton h-2.5 w-28" />
                      </span>
                    ) : (
                      <>
                        <span className="vx-col-mtime pr-3">
                          <span className="skeleton skel-line w-20" />
                        </span>
                        <span className="flex justify-end pr-2">
                          <span className="skeleton skel-line w-12" />
                        </span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : filtering && entries.length === 0 ? (
              <DriveEmpty art="search" title="Nothing carries this tag yet." body="Tag files and folders from their menu, or from the bar that appears when you select some." />
            ) : empty ? (
              <EmptyDrive
                state={empty}
                onUpload={() => uploadFiles(false)}
                onNewFolder={newFolder}
                onBackToNow={() => vx().exitTimeTravel()}
                onGoHome={() => router.push('/drive')}
                onRetry={() => void listing.mutate()}
              />
            ) : (
              <FileGrid layout={gridLayout} scrollRef={scrollRef} focusRow={focusRow} listHead={listView ? listHead : undefined} sortSlot={sortSlot} />
            )}
            <SelectionRect rect={marquee} />
          </div>
        </div>
      </div>

      <DriveContextMenu at={menu ? { x: menu.x, y: menu.y, flipY: menu.flipY } : null} align={menu?.align} items={menuItems} onClose={() => setMenu(null)} />
      <MoveCopyDialog ws={ws} rootName={rootName} req={moveReq} onClose={() => setMoveReq(null)} />
      <SearchPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onPick={onPalettePick} rootName={rootName} />
    </DriveCtx.Provider>
  );
}

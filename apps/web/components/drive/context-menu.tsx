'use client';

// Drive context menus (DESIGN §6.13, DESIGN-v2 §6.14: 36 px items, 18 px icons, restore items
// in the past colour, Delete in del-fg): items now, items in the past, gone-now
// rows, and blank space. Multi-select trims to what applies. Write actions in
// the past appear disabled with the reason instead of vanishing.
import {
  Bookmark,
  Copy,
  Download,
  Eye,
  SquareArrowOutUpRight,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderUp,
  GitCompareArrows,
  Pencil,
  RotateCcw,
  Share2,
  Trash,
  Upload,
  Clock,
  ArrowRight,
} from 'lucide-react';
import type { FileEntry } from '@volumes/shared';
import { ContextMenu, type MenuItem } from '@/components/ui/menu';
import type { Drift } from '@/lib/drive/drift';
import { READ_ONLY_REASON } from './drive-context';

export interface DriveCommands {
  open(e: FileEntry): void;
  preview(e: FileEntry): void;
  download(es: FileEntry[]): void;
  rename(e: FileEntry): void;
  moveTo(es: FileEntry[]): void;
  copyTo(es: FileEntry[]): void;
  versions(e: FileEntry): void;
  comparePrevious(e: FileEntry): void;
  compareWithNow(e: FileEntry): void;
  share(e: FileEntry): void;
  checkpoint(): void;
  remove(es: FileEntry[]): void;
  restore(e: FileEntry): void;
  showInPresent(e: FileEntry): void;
  uploadFiles(): void;
  uploadFolder(): void;
  newFolder(): void;
}

const I = 18;
const W = 1.75;

export function buildDriveMenu(o: {
  targets: FileEntry[];
  past: boolean;
  drift: ReadonlyMap<string, Drift> | null;
  cmd: DriveCommands;
}): MenuItem[] {
  const { targets, past, cmd } = o;
  if (!targets.length) {
    return [
      { id: 'up', label: 'Upload files', icon: <Upload size={I} strokeWidth={W} />, kbd: 'U', onSelect: cmd.uploadFiles, disabled: past, reason: READ_ONLY_REASON },
      { id: 'upd', label: 'Upload folder', icon: <FolderUp size={I} strokeWidth={W} />, kbd: '⇧U', onSelect: cmd.uploadFolder, disabled: past, reason: READ_ONLY_REASON },
      { id: 'nf', label: 'New folder', icon: <FolderPlus size={I} strokeWidth={W} />, kbd: 'N', onSelect: cmd.newFolder, disabled: past, reason: READ_ONLY_REASON },
    ];
  }
  const one = targets.length === 1 ? targets[0] : null;
  const isFile = one?.type === 'file';
  const isDir = one?.type === 'dir';
  const dlLabel = one && isFile ? 'Download' : 'Download .zip';

  if (past) {
    const gone = one ? o.drift?.get(one.path) === 'gone' : false;
    if (one && gone) {
      return [
        { id: 'restore', label: 'Restore to original place', icon: <RotateCcw size={I} strokeWidth={W} />, tone: 'past', kbd: 'R', onSelect: () => cmd.restore(one) },
        { id: 'open', label: 'Open', icon: isDir ? <FolderOpen size={I} strokeWidth={W} /> : <SquareArrowOutUpRight size={I} strokeWidth={W} />, kbd: '↵', onSelect: () => cmd.open(one) },
        { id: 'dl', label: dlLabel, icon: <Download size={I} strokeWidth={W} />, kbd: 'D', onSelect: () => cmd.download(targets) },
        ...(isFile ? [{ id: 'versions', label: 'Compare with last version', icon: <Clock size={I} strokeWidth={W} />, onSelect: () => cmd.versions(one) } as MenuItem] : []),
      ];
    }
    const items: MenuItem[] = [];
    if (one) {
      items.push({ id: 'open', label: 'Open', icon: isDir ? <FolderOpen size={I} strokeWidth={W} /> : <SquareArrowOutUpRight size={I} strokeWidth={W} />, kbd: '↵', onSelect: () => cmd.open(one) });
      if (isFile) items.push({ id: 'preview', label: 'Preview', icon: <Eye size={I} strokeWidth={W} />, kbd: 'Space', onSelect: () => cmd.preview(one) });
    }
    items.push({ id: 'dl', label: dlLabel, icon: <Download size={I} strokeWidth={W} />, kbd: 'D', onSelect: () => cmd.download(targets) });
    items.push({ id: 's1', type: 'separator' });
    if (one && isFile) {
      items.push({ id: 'versions', label: 'Versions', icon: <Clock size={I} strokeWidth={W} />, kbd: '⇧H', onSelect: () => cmd.versions(one) });
      items.push({ id: 'cmp', label: 'Compare with now', icon: <GitCompareArrows size={I} strokeWidth={W} />, kbd: 'C', onSelect: () => cmd.compareWithNow(one) });
    }
    if (one) items.push({ id: 'share', label: 'Share pinned link…', icon: <Share2 size={I} strokeWidth={W} />, kbd: 'S', onSelect: () => cmd.share(one) });
    items.push({ id: 's2', type: 'separator' });
    if (one) items.push({ id: 'restore', label: 'Restore this…', icon: <RotateCcw size={I} strokeWidth={W} />, tone: 'past', kbd: 'R', onSelect: () => cmd.restore(one) });
    items.push({ id: 'mv', label: 'Move to…', icon: <FolderInput size={I} strokeWidth={W} />, onSelect: () => cmd.moveTo(targets), disabled: true, reason: READ_ONLY_REASON });
    items.push({ id: 'del', label: 'Delete', icon: <Trash size={I} strokeWidth={W} />, onSelect: () => cmd.remove(targets), disabled: true, reason: READ_ONLY_REASON, danger: true });
    if (one) {
      items.push({ id: 's3', type: 'separator' });
      items.push({ id: 'present', label: 'Show in present', icon: <ArrowRight size={I} strokeWidth={W} />, onSelect: () => cmd.showInPresent(one) });
    }
    return items;
  }

  const items: MenuItem[] = [];
  if (one) {
    items.push({ id: 'open', label: 'Open', icon: isDir ? <FolderOpen size={I} strokeWidth={W} /> : <SquareArrowOutUpRight size={I} strokeWidth={W} />, kbd: '↵', onSelect: () => cmd.open(one) });
    if (isFile) items.push({ id: 'preview', label: 'Preview', icon: <Eye size={I} strokeWidth={W} />, kbd: 'Space', onSelect: () => cmd.preview(one) });
  }
  items.push({ id: 'dl', label: dlLabel, icon: <Download size={I} strokeWidth={W} />, kbd: 'D', onSelect: () => cmd.download(targets) });
  items.push({ id: 's1', type: 'separator' });
  if (one) items.push({ id: 'rename', label: 'Rename', icon: <Pencil size={I} strokeWidth={W} />, kbd: 'F2', onSelect: () => cmd.rename(one) });
  items.push({ id: 'mv', label: 'Move to…', icon: <FolderInput size={I} strokeWidth={W} />, kbd: 'M', onSelect: () => cmd.moveTo(targets) });
  items.push({ id: 'cp', label: 'Copy to…', icon: <Copy size={I} strokeWidth={W} />, kbd: '⇧M', onSelect: () => cmd.copyTo(targets) });
  if (one) {
    items.push({ id: 's2', type: 'separator' });
    if (isFile) {
      items.push({ id: 'versions', label: 'Versions', icon: <Clock size={I} strokeWidth={W} />, kbd: '⇧H', onSelect: () => cmd.versions(one) });
      items.push({ id: 'cmp', label: 'Compare with previous', icon: <GitCompareArrows size={I} strokeWidth={W} />, kbd: 'C', onSelect: () => cmd.comparePrevious(one) });
    }
    items.push({ id: 'share', label: 'Share…', icon: <Share2 size={I} strokeWidth={W} />, kbd: 'S', onSelect: () => cmd.share(one) });
    items.push({ id: 'cpt', label: 'Checkpoint…', icon: <Bookmark size={I} strokeWidth={W} />, kbd: 'P', onSelect: cmd.checkpoint });
  }
  items.push({ id: 's3', type: 'separator' });
  items.push({
    id: 'del',
    label: targets.length > 1 ? `Delete ${targets.length} items` : 'Delete',
    icon: <Trash size={I} strokeWidth={W} />,
    kbd: '⌫',
    danger: true,
    onSelect: () => cmd.remove(targets),
  });
  return items;
}

/**
 * The current folder's menu (the ▾ on the last crumb, DESIGN-v2 §6.2): New folder, Upload
 * files, Upload folder · Share…, Versions (the History rail), Download .zip. Write items stay
 * visible but disabled in the past.
 */
export function buildFolderMenu(o: {
  past: boolean;
  cmd: Pick<DriveCommands, 'newFolder' | 'uploadFiles' | 'uploadFolder'>;
  share: () => void;
  history: () => void;
  downloadZip: () => void;
}): MenuItem[] {
  const { past, cmd } = o;
  return [
    { id: 'nf', label: 'New folder', icon: <FolderPlus size={I} strokeWidth={W} />, kbd: 'N', onSelect: cmd.newFolder, disabled: past, reason: READ_ONLY_REASON },
    { id: 'up', label: 'Upload files', icon: <Upload size={I} strokeWidth={W} />, kbd: 'U', onSelect: cmd.uploadFiles, disabled: past, reason: READ_ONLY_REASON },
    { id: 'upd', label: 'Upload folder', icon: <FolderUp size={I} strokeWidth={W} />, kbd: '⇧U', onSelect: cmd.uploadFolder, disabled: past, reason: READ_ONLY_REASON },
    { id: 's1', type: 'separator' },
    { id: 'share', label: past ? 'Share pinned link…' : 'Share…', icon: <Share2 size={I} strokeWidth={W} />, onSelect: o.share },
    { id: 'history', label: 'Versions', icon: <Clock size={I} strokeWidth={W} />, kbd: 'H', onSelect: o.history },
    { id: 'zip', label: 'Download .zip', icon: <Download size={I} strokeWidth={W} />, onSelect: o.downloadZip },
  ];
}

export default function DriveContextMenu({
  at,
  items,
  onClose,
  align,
}: {
  at: { x: number; y: number; flipY?: number } | null;
  items: MenuItem[];
  onClose: () => void;
  align?: 'start' | 'end';
}) {
  return <ContextMenu at={at} items={items} onClose={onClose} align={align} />;
}

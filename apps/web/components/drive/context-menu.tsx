'use client';

// Drive context menus (DESIGN §6.13): items now, items in the past, gone-now
// rows, and blank space. Multi-select trims to what applies. Write actions in
// the past appear disabled with the reason instead of vanishing.
import {
  Bookmark,
  Copy,
  Download,
  Eye,
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

const I = 14;

export function buildDriveMenu(o: {
  targets: FileEntry[];
  past: boolean;
  drift: ReadonlyMap<string, Drift> | null;
  cmd: DriveCommands;
}): MenuItem[] {
  const { targets, past, cmd } = o;
  if (!targets.length) {
    return [
      { id: 'up', label: 'Upload files', icon: <Upload size={I} />, kbd: 'U', onSelect: cmd.uploadFiles, disabled: past, reason: READ_ONLY_REASON },
      { id: 'upd', label: 'Upload folder', icon: <FolderUp size={I} />, kbd: '⇧U', onSelect: cmd.uploadFolder, disabled: past, reason: READ_ONLY_REASON },
      { id: 'nf', label: 'New folder', icon: <FolderPlus size={I} />, kbd: 'N', onSelect: cmd.newFolder, disabled: past, reason: READ_ONLY_REASON },
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
        { id: 'restore', label: 'Restore to original place', icon: <RotateCcw size={I} />, kbd: 'R', onSelect: () => cmd.restore(one) },
        { id: 'open', label: 'Open', icon: isDir ? <FolderOpen size={I} /> : <Eye size={I} />, kbd: '↵', onSelect: () => cmd.open(one) },
        { id: 'dl', label: dlLabel, icon: <Download size={I} />, kbd: 'D', onSelect: () => cmd.download(targets) },
        ...(isFile ? [{ id: 'versions', label: 'Compare with last version', icon: <Clock size={I} />, onSelect: () => cmd.versions(one) } as MenuItem] : []),
      ];
    }
    const items: MenuItem[] = [];
    if (one) {
      items.push({ id: 'open', label: 'Open', icon: isDir ? <FolderOpen size={I} /> : <Eye size={I} />, kbd: '↵', onSelect: () => cmd.open(one) });
      if (isFile) items.push({ id: 'preview', label: 'Preview', icon: <Eye size={I} />, kbd: 'Space', onSelect: () => cmd.preview(one) });
    }
    items.push({ id: 'dl', label: dlLabel, icon: <Download size={I} />, kbd: 'D', onSelect: () => cmd.download(targets) });
    items.push({ id: 's1', type: 'separator' });
    if (one && isFile) {
      items.push({ id: 'versions', label: 'Versions', icon: <Clock size={I} />, kbd: '⇧H', onSelect: () => cmd.versions(one) });
      items.push({ id: 'cmp', label: 'Compare with now', icon: <GitCompareArrows size={I} />, kbd: 'C', onSelect: () => cmd.compareWithNow(one) });
    }
    if (one) items.push({ id: 'share', label: 'Share pinned link…', icon: <Share2 size={I} />, kbd: 'S', onSelect: () => cmd.share(one) });
    items.push({ id: 's2', type: 'separator' });
    if (one) items.push({ id: 'restore', label: 'Restore this…', icon: <RotateCcw size={I} />, kbd: 'R', onSelect: () => cmd.restore(one) });
    items.push({ id: 'mv', label: 'Move to…', icon: <FolderInput size={I} />, onSelect: () => cmd.moveTo(targets), disabled: true, reason: READ_ONLY_REASON });
    items.push({ id: 'del', label: 'Delete', icon: <Trash size={I} />, onSelect: () => cmd.remove(targets), disabled: true, reason: READ_ONLY_REASON, danger: true });
    if (one) {
      items.push({ id: 's3', type: 'separator' });
      items.push({ id: 'present', label: 'Show in present', icon: <ArrowRight size={I} />, onSelect: () => cmd.showInPresent(one) });
    }
    return items;
  }

  const items: MenuItem[] = [];
  if (one) {
    items.push({ id: 'open', label: 'Open', icon: isDir ? <FolderOpen size={I} /> : <Eye size={I} />, kbd: '↵', onSelect: () => cmd.open(one) });
    if (isFile) items.push({ id: 'preview', label: 'Preview', icon: <Eye size={I} />, kbd: 'Space', onSelect: () => cmd.preview(one) });
  }
  items.push({ id: 'dl', label: dlLabel, icon: <Download size={I} />, kbd: 'D', onSelect: () => cmd.download(targets) });
  items.push({ id: 's1', type: 'separator' });
  if (one) items.push({ id: 'rename', label: 'Rename', icon: <Pencil size={I} />, kbd: 'F2', onSelect: () => cmd.rename(one) });
  items.push({ id: 'mv', label: 'Move to…', icon: <FolderInput size={I} />, kbd: 'M', onSelect: () => cmd.moveTo(targets) });
  items.push({ id: 'cp', label: 'Copy to…', icon: <Copy size={I} />, kbd: '⇧M', onSelect: () => cmd.copyTo(targets) });
  if (one) {
    items.push({ id: 's2', type: 'separator' });
    if (isFile) {
      items.push({ id: 'versions', label: 'Versions', icon: <Clock size={I} />, kbd: '⇧H', onSelect: () => cmd.versions(one) });
      items.push({ id: 'cmp', label: 'Compare with previous', icon: <GitCompareArrows size={I} />, kbd: 'C', onSelect: () => cmd.comparePrevious(one) });
    }
    items.push({ id: 'share', label: 'Share…', icon: <Share2 size={I} />, kbd: 'S', onSelect: () => cmd.share(one) });
    items.push({ id: 'cpt', label: 'Checkpoint…', icon: <Bookmark size={I} />, kbd: 'P', onSelect: cmd.checkpoint });
  }
  items.push({ id: 's3', type: 'separator' });
  items.push({
    id: 'del',
    label: targets.length > 1 ? `Delete ${targets.length} items` : 'Delete',
    icon: <Trash size={I} />,
    kbd: '⌫',
    danger: true,
    onSelect: () => cmd.remove(targets),
  });
  return items;
}

export default function DriveContextMenu({ at, items, onClose }: { at: { x: number; y: number } | null; items: MenuItem[]; onClose: () => void }) {
  return <ContextMenu at={at} items={items} onClose={onClose} />;
}

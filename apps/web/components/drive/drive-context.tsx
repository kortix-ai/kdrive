'use client';

// Shared per-folder state and handlers for rows and tiles, so the virtualised
// list and grid stay thin. Provided by FileBrowser.
import { createContext, useContext } from 'react';
import type { FileEntry } from '@volumes/shared';
import type { Drift } from '@/lib/drive/drift';
import type { PendingKind } from '@/lib/drive/optimistic';
import type { DriveCommands } from './context-menu';

export interface DriveItemHandlers {
  onItemMouseDown(e: React.MouseEvent, entry: FileEntry): void;
  onItemClick(e: React.MouseEvent, entry: FileEntry): void;
  onOpen(entry: FileEntry): void;
  onContextMenu(e: React.MouseEvent, entry: FileEntry | null): void;
  onMenuButton(e: React.MouseEvent, entry: FileEntry): void;
  onCheck(entry: FileEntry): void;
  onDragStart(e: React.DragEvent, entry: FileEntry): void;
  onDragEnd(): void;
  onFolderDragOver(e: React.DragEvent, entry: FileEntry): void;
  onFolderDragLeave(e: React.DragEvent, entry: FileEntry): void;
  onFolderDrop(e: React.DragEvent, entry: FileEntry): void;
  onRestore(entry: FileEntry): void;
  onRenameSubmit(entry: FileEntry, name: string): void;
  onRenameCancel(): void;
  onCreateFolder(name: string): void;
  onCancelCreate(): void;
  onToggleAddedLater(): void;
}

export interface DriveCtxValue extends DriveItemHandlers {
  ws: string;
  /** Commit being viewed (null = now). */
  at: string | null;
  past: boolean;
  /** A viewer of someone else's drive: nothing can be changed or shared. */
  viewOnly: boolean;
  /** "14 Sep, 16:40" when in the past */
  pastLabel: string;
  path: string;
  selection: ReadonlySet<string>;
  focus: string | null;
  drift: ReadonlyMap<string, Drift> | null;
  pending: Readonly<Record<string, PendingKind>>;
  removing: Readonly<Record<string, true>>;
  dragging: ReadonlySet<string>;
  dropDir: string | null;
  renaming: string | null;
  /** Current folder's entries (rename / new-folder validation). */
  siblings: readonly FileEntry[];
  addedLaterOpen: boolean;
  /** wide: 5 list columns · compact: panel or rail open, or a narrow sheet · phone: ≤ 720 px. */
  density: 'wide' | 'compact' | 'phone';
  /** At least one item is selected (checkboxes stay visible). */
  anySelected: boolean;
  /** Row and card actions (Download · Share · Versions). */
  cmd: DriveCommands;
}

export const DriveCtx = createContext<DriveCtxValue | null>(null);

export function useDriveCtx(): DriveCtxValue {
  const v = useContext(DriveCtx);
  if (!v) throw new Error('useDriveCtx outside FileBrowser');
  return v;
}

export const READ_ONLY_REASON = 'Read-only in the past. Restore first, or go back to now.';

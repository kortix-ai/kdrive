'use client';

// New folder, inline (`N` or "+ Folder"): an editable row at the top of the
// list, or a folder tile at the start of the grid. ↵ creates (optimistic row
// with a pending hairline), Esc cancels.
import { Folder } from 'lucide-react';
import { nextFreeName } from '@volumes/shared';
import { cx } from '@/components/ui/cx';
import { useDriveCtx } from './drive-context';
import { LIST_COLS } from './file-row';
import { NameInput, nameError } from './rename-dialog';

export function defaultFolderName(siblings: readonly { name: string }[]): string {
  return nextFreeName('New folder', new Set(siblings.map((s) => s.name)));
}

export function NewFolderEditor({ variant, style }: { variant: 'row' | 'tile'; style?: React.CSSProperties }) {
  const ctx = useDriveCtx();
  const initial = defaultFolderName(ctx.siblings);
  const input = (
    <NameInput
      initial={initial}
      selectTo={initial.length}
      validate={(n) => nameError(n, ctx.siblings)}
      onSubmit={ctx.onCreateFolder}
      onCancel={ctx.onCancelCreate}
      label="New folder name"
    />
  );
  if (variant === 'tile') {
    return (
      <div style={style} className="flex h-16 items-center gap-3 border border-vx-accent-edge bg-vx-accent-wash px-3">
        <Folder size={20} strokeWidth={1.5} className="shrink-0 text-vx-text-2" aria-hidden />
        {input}
      </div>
    );
  }
  return (
    <div
      style={{ ...style, gridTemplateColumns: LIST_COLS }}
      className={cx('grid h-8 items-center bg-vx-accent-wash px-3 shadow-[inset_2px_0_0_var(--vx-accent-edge)]')}
    >
      <span />
      <Folder size={16} strokeWidth={1.5} className="text-vx-text-2" aria-hidden />
      <span className="flex min-w-0 pr-3">{input}</span>
      <span className="vx-col-mtime vx-meta text-right text-vx-text-4">now</span>
      <span className="vx-meta text-right text-vx-text-4">—</span>
      <span />
    </div>
  );
}

export default NewFolderEditor;

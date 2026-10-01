'use client';

// New folder, inline (`N`, or "+ New › New folder"): an editable row at the top of the
// list (full-bleed, the selected row's left bar), or a folder card at the start of the grid
// (r6, 1 px accent-edge), on the selection fill. ↵ creates
// (optimistic row with a pending bar), Esc cancels.
import { nextFreeName } from '@volumes/shared';
import { cx } from '@/components/ui/cx';
import { FileIcon } from '@/components/ui/file-icon';
import { useDriveCtx } from './drive-context';
import { listCols } from './file-row';
import s from './drive.module.css';
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
      <div style={style} className="flex h-11 items-center gap-2.5 rounded-vx-md border border-vx-accent-edge bg-vx-selection pl-3 pr-2">
        <FileIcon name="" type="dir" size={20} />
        {input}
      </div>
    );
  }
  const phone = ctx.density === 'phone';
  return (
    <div
      style={{ ...style, gridTemplateColumns: phone ? '40px minmax(0,1fr) 44px' : listCols(ctx.density) }}
      className={cx(s.row, s.selBar, 'relative grid items-center bg-vx-selection text-vx-on-selection', phone ? 'pl-2' : 'pl-1 pr-3')}
    >
      {phone ? null : <span />}
      {phone ? <FileIcon name="" type="dir" size={28} /> : null}
      <span className={cx('flex min-w-0 items-center gap-3', !phone && 'pr-4')}>
        {phone ? null : <FileIcon name="" type="dir" size={20} />}
        {input}
      </span>
      {phone ? null : (
        <>
          <span className="vx-col-mtime vx-meta-row pr-3">Now</span>
          <span className="vx-meta-row pr-2 text-right">—</span>
        </>
      )}
      <span />
    </div>
  );
}

export default NewFolderEditor;

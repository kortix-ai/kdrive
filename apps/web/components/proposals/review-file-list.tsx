'use client';

// The file list of a proposal review (MCP.md §14.7): 40 h rows with a checkbox (pending rows
// only), the type icon, the path (moves and copies read `from → to`), the change badge, a
// "Changed since" drift chip for conflicts, and the state of decided rows. ↑/↓ move between rows.
import { basename, type ProposalConflict, type ProposalFile } from '@volumes/shared';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cx } from '@/components/ui/cx';
import { FileIcon } from '@/components/ui/file-icon';
import { ChangeTag } from '@/components/versioning/change-kind';
import { CHANGE_KIND, fileLabel, middleTruncate } from './format';

const CONFLICT_TEXT: Record<ProposalConflict['reason'], string> = {
  changed: 'Changed in the drive after the agent read it.',
  created: 'Created in the drive after the agent read it.',
  deleted: 'Deleted from the drive after the agent read it.',
  type: 'Turned into a folder (or a file) after the agent read it.',
};

/** "Changed since" (UNIFY-SPEC §12.1 row tag): Mono 11, r2, h 18, a hair-strong ring and a 6 px tick dot. */
export function ChangedSinceChip({ conflict }: { conflict: ProposalConflict }) {
  return (
    <span
      title={CONFLICT_TEXT[conflict.reason]}
      data-drift=""
      className="inline-flex h-[18px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-vx-xs border border-vx-hair-strong px-1.5 font-mono text-[11px] leading-4 text-vx-text-3"
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-vx-tick" />
      Changed since
    </span>
  );
}

const folderOf = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/';

/** What a row shows: the file name (a move reads "name → /Dest", a rename "old → new") over its folder. */
export function rowText(f: Pick<ProposalFile, 'path' | 'fromPath' | 'op'>): { title: string; folder: string } {
  const name = basename(f.path) || f.path;
  if ((f.op === 'move' || f.op === 'copy') && f.fromPath) {
    const from = basename(f.fromPath) || f.fromPath;
    const sameFolder = folderOf(f.fromPath) === folderOf(f.path);
    return { title: sameFolder ? `${from} → ${name}` : from === name ? `${from} → ${folderOf(f.path)}` : `${from} → ${f.path}`, folder: folderOf(f.fromPath) };
  }
  return { title: name, folder: folderOf(f.path) };
}

export function ReviewFileList({
  files,
  selected,
  onSelect,
  checked,
  onCheck,
  onCheckAll,
  className,
}: {
  files: ProposalFile[];
  selected: number | null;
  onSelect: (seq: number) => void;
  checked: Set<number>;
  onCheck: (seq: number, on: boolean) => void;
  /** Ticks (or clears) every pending row shown. */
  onCheckAll?: (on: boolean) => void;
  className?: string;
}) {
  const pending = files.filter((f) => f.status === 'pending');
  const tickedShown = pending.filter((f) => checked.has(f.seq)).length;

  const move = (e: React.KeyboardEvent<HTMLElement>, i: number) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const next = files[Math.max(0, Math.min(files.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    onSelect(next.seq);
    const root = e.currentTarget.closest('[data-review-list]');
    root?.querySelector<HTMLElement>(`[data-seq="${next.seq}"]`)?.focus();
  };

  return (
    <div data-review-list="" className={cx('flex min-h-0 flex-col', className)}>
      {onCheckAll && pending.length ? (
        <div className="flex h-9 shrink-0 items-center gap-3 border-b border-vx-hair bg-vx-bg-2 px-3 text-vx-text-3">
          <Checkbox
            label="Select every waiting file"
            checked={tickedShown > 0 && tickedShown === pending.length}
            indeterminate={tickedShown > 0 && tickedShown < pending.length}
            onChange={(on) => onCheckAll(on)}
          />
          <span className="vx-colhead">{tickedShown ? `${tickedShown} of ${pending.length} selected` : `${pending.length} waiting`}</span>
        </div>
      ) : null}
      <ul aria-label="Proposed changes" className="min-h-0 flex-1 overflow-y-auto">
        {files.map((f, i) => {
          const on = f.seq === selected;
          const label = fileLabel(f);
          const name = basename(f.path) || f.path;
          const text = rowText(f);
          const decided = f.status !== 'pending';
          return (
            <li
              key={f.seq}
              className={cx(
                'group grid min-h-12 grid-cols-[16px_minmax(0,1fr)] items-center gap-x-3 border-b border-vx-hair-soft pl-3 pr-2 transition-colors duration-[120ms] max-[720px]:min-h-14',
                on ? 'vx-selected' : 'hover:bg-vx-raise',
              )}
            >
              {decided ? (
                <span aria-hidden />
              ) : (
                <Checkbox label={`Select ${label}`} checked={checked.has(f.seq)} onChange={(v) => onCheck(f.seq, v)} />
              )}
              <button
                type="button"
                data-seq={f.seq}
                aria-current={on ? 'true' : undefined}
                onClick={() => onSelect(f.seq)}
                onKeyDown={(e) => move(e, i)}
                className="vx-inset-focus flex min-h-10 min-w-0 items-center gap-2.5 rounded-vx-sm py-1.5 text-left"
              >
                <FileIcon name={name} type={f.entryType === 'dir' ? 'dir' : 'file'} size={20} muted={decided} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span title={label} className={cx('truncate text-[14px] font-medium leading-5', decided ? 'text-vx-text-3' : 'text-vx-text-1')}>
                    {text.title}
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
                    <ChangeTag kind={CHANGE_KIND[f.change]} />
                    <span className="min-w-0 truncate font-mono text-[12px] leading-4 text-vx-text-3" title={text.folder}>
                      {middleTruncate(text.folder, 32)}
                    </span>
                    {f.conflict && !decided ? <ChangedSinceChip conflict={f.conflict} /> : null}
                    {f.status === 'accepted' ? (
                      <Badge tone="live" pip>
                        Accepted
                      </Badge>
                    ) : f.status === 'discarded' ? (
                      <Badge tone="dashed">Discarded</Badge>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default ReviewFileList;

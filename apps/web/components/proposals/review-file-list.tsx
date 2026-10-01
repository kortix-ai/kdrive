'use client';

// The file list of a proposal review (MCP.md §14.7): 40 h rows with a checkbox (pending rows
// only), the type icon, the path (moves and copies read `from → to`), the change badge, a
// "Changed since" drift chip for conflicts, and the state of decided rows. ↑/↓ move between rows.
import { basename, type ProposalConflict, type ProposalFile } from '@volumes/shared';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cx } from '@/components/ui/cx';
import { FileIcon } from '@/components/ui/file-icon';
import { CHANGE_LABEL, CHANGE_TONE, fileLabel, middleTruncate } from './format';

const CONFLICT_TEXT: Record<ProposalConflict['reason'], string> = {
  changed: 'Changed in the drive after the agent read it.',
  created: 'Created in the drive after the agent read it.',
  deleted: 'Deleted from the drive after the agent read it.',
  type: 'Turned into a folder (or a file) after the agent read it.',
};

/** "Changed since" (DESIGN-v2 drift chip): 22 px pill, 12/500, a 6 px tick dot. */
export function ChangedSinceChip({ conflict }: { conflict: ProposalConflict }) {
  return (
    <span
      title={CONFLICT_TEXT[conflict.reason]}
      data-drift=""
      className="inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-vx-surface-3 px-2 text-[12px] font-medium leading-4 text-vx-text-2"
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-vx-tick" />
      Changed since
    </span>
  );
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
        <div className="flex h-10 shrink-0 items-center gap-3 border-b border-vx-hair-soft px-3 text-[13px] font-medium leading-5 text-vx-text-3">
          <Checkbox
            label="Select every waiting file"
            checked={tickedShown > 0 && tickedShown === pending.length}
            indeterminate={tickedShown > 0 && tickedShown < pending.length}
            onChange={(on) => onCheckAll(on)}
          />
          <span className="tabular-nums">{tickedShown ? `${tickedShown} of ${pending.length} selected` : `${pending.length} waiting`}</span>
        </div>
      ) : null}
      <ul aria-label="Proposed changes" className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {files.map((f, i) => {
          const on = f.seq === selected;
          const label = fileLabel(f);
          const name = basename(f.path) || f.path;
          const decided = f.status !== 'pending';
          return (
            <li
              key={f.seq}
              className={cx(
                'group grid min-h-10 grid-cols-[18px_minmax(0,1fr)] items-center gap-x-3 rounded-vx-sm pl-2.5 pr-2 transition-colors duration-[120ms] max-[720px]:min-h-11',
                on ? 'bg-vx-selection text-vx-on-selection' : 'hover:bg-vx-hover',
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
                  <span
                    title={label}
                    className={cx('truncate text-[14px] leading-5', decided ? 'text-vx-text-3' : on ? 'font-medium' : 'text-vx-text-1')}
                  >
                    {middleTruncate(label, 44)}
                  </span>
                  <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1">
                    <Badge tone={CHANGE_TONE[f.change]}>{CHANGE_LABEL[f.change]}</Badge>
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

'use client';

import { basename, dirname, type CompareKind, type FileSide, type FileVersion } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { Segmented } from '@/components/ui/segmented';
import { formatRelative } from '@/lib/format';
import { CommitId } from './readout';

export type TextMode = 'split' | 'unified';
export type ImageMode = 'side' | 'swipe';

export interface CompareModes {
  text: TextMode;
  image: ImageMode;
  changesOnly: boolean;
}

/** A side chip: "@7c19e02 · 2h ▾" (a past side is amber, now is text-1). */
function SideChip({
  which,
  refId,
  side,
  isNow,
  versions,
  onPick,
}: {
  which: 'A' | 'B';
  refId: string;
  side: FileSide | null;
  isNow: boolean;
  versions: FileVersion[];
  onPick: (commitId: string) => void;
}) {
  const items: MenuItem[] = versions.length
    ? [
        { id: 'lbl', type: 'label', label: `Version ${which}` },
        ...versions.map<MenuItem>((v) => ({
          id: v.commitId,
          checked: v.commitId === refId || v.commitId === side?.commitId,
          label: (
            <span className="flex items-center gap-2">
              <CommitId id={v.commitId} className="text-vx-text-2" />
              <span className="text-vx-text-4">{v.isCurrent ? 'now' : formatRelative(v.createdAt)}</span>
              {v.checkpointNames.length ? <span className="truncate text-vx-accent">◆ {v.checkpointNames[0]}</span> : null}
            </span>
          ),
          onSelect: () => onPick(v.commitId),
        })),
      ]
    : [{ id: 'none', type: 'label', label: 'No other versions kept' }];
  return (
    <Menu
      items={items}
      trigger={(p) => (
        <button
          type="button"
          {...p}
          className={cx(
            'inline-flex h-7 items-center gap-1.5 border px-2 font-mono text-[11.5px] tabular-nums transition-colors duration-[120ms]',
            isNow ? 'border-vx-hair text-vx-text-1 hover:border-vx-hair-strong' : 'border-vx-past-edge text-vx-past hover:bg-vx-past-wash',
          )}
        >
          <span className="text-vx-text-4">{which}</span>
          <CommitId id={side?.commitId ?? refId} />
          <span className="opacity-70">· {isNow ? 'now' : side ? formatRelative(side.createdAt) : '—'}</span>
          <span aria-hidden className="text-vx-text-4">
            ▾
          </span>
        </button>
      )}
    />
  );
}

/** Compare header (48 px): ✕, name + path, A ⇄ B pickers, mode seg per kind, downloads, restore A. */
export function CompareHeader({
  path,
  kind,
  a,
  b,
  refA,
  refB,
  aIsNow,
  bIsNow,
  versions,
  modes,
  onModes,
  onClose,
  onSwap,
  onPick,
  onRestoreA,
}: {
  path: string;
  kind: CompareKind | null;
  a: FileSide | null;
  b: FileSide | null;
  refA: string;
  refB: string;
  aIsNow: boolean;
  bIsNow: boolean;
  versions: FileVersion[];
  modes: CompareModes;
  onModes: (m: CompareModes) => void;
  onClose: () => void;
  onSwap: () => void;
  onPick: (which: 'a' | 'b', commitId: string) => void;
  onRestoreA: () => void;
}) {
  const name = basename(path) || path;
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-vx-hair px-3">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close compare (Esc)"
        title="Close (Esc)"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center font-mono text-[12px] text-vx-text-3 hover:bg-vx-surface-2 hover:text-vx-text-1"
      >
        ✕
      </button>
      <div className="flex min-w-0 shrink items-baseline gap-2">
        <span className="vx-title truncate" title={path}>
          {name}
        </span>
        <span className="vx-meta truncate text-vx-text-3 max-[900px]:hidden">{dirname(path)}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <SideChip which="A" refId={refA} side={a} isNow={aIsNow} versions={versions} onPick={(c) => onPick('a', c)} />
        <button
          type="button"
          onClick={onSwap}
          aria-label="Swap A and B (X)"
          title="Swap A and B (X)"
          className="inline-flex h-7 w-7 items-center justify-center font-mono text-[12px] text-vx-text-3 hover:bg-vx-surface-2 hover:text-vx-text-1"
        >
          ⇄
        </button>
        <SideChip which="B" refId={refB} side={b} isNow={bIsNow} versions={versions} onPick={(c) => onPick('b', c)} />
      </div>
      <div className="flex-1" />
      {kind === 'text' ? (
        <Segmented
          size="sm"
          label="Diff layout"
          value={modes.text}
          onChange={(v) => onModes({ ...modes, text: v })}
          options={[
            { value: 'split', label: 'Split' },
            { value: 'unified', label: 'Unified' },
          ]}
        />
      ) : kind === 'image' ? (
        <Segmented
          size="sm"
          label="Image compare mode"
          value={modes.image}
          onChange={(v) => onModes({ ...modes, image: v })}
          options={[
            { value: 'side', label: 'Side' },
            { value: 'swipe', label: 'Swipe', disabled: !a || !b },
          ]}
        />
      ) : kind === 'csv' ? (
        <Segmented
          size="sm"
          label="Rows shown"
          value={modes.changesOnly ? 'changes' : 'all'}
          onChange={(v) => onModes({ ...modes, changesOnly: v === 'changes' })}
          options={[
            { value: 'all', label: 'All rows' },
            { value: 'changes', label: 'Changes only' },
          ]}
        />
      ) : null}
      <div className="flex shrink-0 items-center gap-1 max-[1100px]:hidden">
        {a ? (
          <a href={a.downloadUrl} download className="inline-flex h-7 items-center px-2 font-mono text-[12px] text-vx-text-3 hover:bg-vx-surface-2 hover:text-vx-text-1">
            ↓ A
          </a>
        ) : null}
        {b ? (
          <a href={b.downloadUrl} download className="inline-flex h-7 items-center px-2 font-mono text-[12px] text-vx-text-3 hover:bg-vx-surface-2 hover:text-vx-text-1">
            ↓ B
          </a>
        ) : null}
      </div>
      <Button
        size="sm"
        variant="restore"
        disabled={!a || aIsNow}
        title={!a ? 'A has no copy of this file' : aIsNow ? 'A is the current version' : 'Restore this file to version A'}
        onClick={onRestoreA}
      >
        Restore A
      </Button>
    </header>
  );
}

/** The 28 px summary line under the header. */
export function SummaryBar({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="vx-meta flex h-7 shrink-0 items-center gap-3 border-b border-vx-hair bg-vx-surface px-4 text-vx-text-3">
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {right}
    </div>
  );
}

/** "Not present at this version" ghost frame for a missing side. */
export function MissingSide({ which, className }: { which: 'A' | 'B'; className?: string }) {
  return (
    <div className={cx('flex min-h-[160px] flex-col items-center justify-center gap-1 border border-dashed border-vx-hair-dash', className)}>
      <span className="vx-label text-vx-text-4">{which}</span>
      <span className="vx-meta text-vx-text-3">Not present at this version</span>
    </div>
  );
}

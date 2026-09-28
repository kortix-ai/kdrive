'use client';

import { ArrowLeft, ArrowLeftRight, ChevronDown, Download } from 'lucide-react';
import { basename, dirname, type CompareKind, type FileSide, type FileVersion } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { FileIcon } from '@/components/ui/file-icon';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { Segmented } from '@/components/ui/segmented';
import { Tooltip } from '@/components/ui/tooltip';
import { formatTimeTravelLabel } from '@/lib/format';
import { friendlyWhen } from '@/lib/versioning/timeline';
import { CommitId } from './readout';

export type TextMode = 'split' | 'unified';
export type ImageMode = 'side' | 'swipe';

export interface CompareModes {
  text: TextMode;
  image: ImageMode;
  changesOnly: boolean;
}

/** 18 px side disc: amber "A" (the past side), blue "B". */
export function SideDisc({ which, size = 18, className }: { which: 'A' | 'B'; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full text-[11px] font-bold leading-none',
        which === 'A' ? 'bg-vx-past text-vx-on-past' : 'bg-vx-accent text-vx-on-accent',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {which}
    </span>
  );
}

/**
 * Side picker pill (DESIGN-v2 §6.7): A is amber (past-wash + past-edge inset), B is white with a
 * hair-strong border. Shows the date (or "Now") and the mono @commit; ▾ when it opens a menu.
 */
export function SidePill({
  which,
  commitId,
  createdAt,
  isNow,
  menu,
  className,
  ...rest
}: {
  which: 'A' | 'B';
  commitId: string | null;
  createdAt: string | null;
  isNow: boolean;
  menu?: boolean;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'>) {
  const a = which === 'A';
  const cls = cx(
    'inline-flex h-9 min-w-0 shrink-0 items-center gap-2 whitespace-nowrap rounded-full pl-2 pr-3 text-[14px] leading-5 transition-colors duration-[120ms]',
    a ? 'bg-vx-past-wash shadow-[inset_0_0_0_1px_var(--vx-past-edge)]' : 'border border-vx-hair-strong bg-vx-surface',
    menu && (a ? 'hover:brightness-[.98]' : 'hover:bg-vx-hover'),
    className,
  );
  const inner = (
    <>
      <SideDisc which={which} />
      <span className={cx('font-semibold tabular-nums', a ? 'text-vx-past-strong' : 'text-vx-text-1')}>
        {isNow ? 'Now' : createdAt ? formatTimeTravelLabel(createdAt) : '…'}
      </span>
      {commitId ? <CommitId id={commitId} className={cx('text-[12px] max-[1100px]:hidden', a ? 'text-vx-past' : 'text-vx-text-3')} /> : null}
      {menu ? <ChevronDown size={16} strokeWidth={1.75} aria-hidden className={a ? 'text-vx-past' : 'text-vx-text-3'} /> : null}
    </>
  );
  if (!menu) return <span className={cls}>{inner}</span>;
  return (
    <button type="button" aria-label={`Version ${which}`} className={cls} {...rest}>
      {inner}
    </button>
  );
}

function SidePicker({
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
          label: v.isCurrent ? 'Now' : friendlyWhen(v.createdAt),
          hint: (
            <span className="flex min-w-0 items-center gap-1.5">
              <CommitId id={v.commitId} />
              {v.checkpointNames.length ? <span className="truncate text-vx-accent">· {v.checkpointNames[0]}</span> : null}
            </span>
          ),
          onSelect: () => onPick(v.commitId),
        })),
      ]
    : [{ id: 'none', type: 'label', label: 'No other versions kept' }];
  return (
    <Menu
      items={items}
      minWidth={260}
      trigger={(p) => <SidePill {...p} menu which={which} commitId={side?.commitId ?? refId} createdAt={side?.createdAt ?? null} isNow={isNow} />}
    />
  );
}

/**
 * Compare head (64 px; DESIGN-v2 §6.7): back, type icon, name over its path, picker A (amber) ⇄ picker B,
 * the mode control for the kind, Download (A / B) and "Restore A". On phones the pickers stack under the title.
 */
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
  const downloads: MenuItem[] = [
    { id: 'a', label: 'Download A', icon: <SideDisc which="A" />, disabled: !a, reason: 'A has no copy of this file', onSelect: () => a && triggerDownload(a.downloadUrl) },
    { id: 'b', label: 'Download B', icon: <SideDisc which="B" />, disabled: !b, reason: 'B has no copy of this file', onSelect: () => b && triggerDownload(b.downloadUrl) },
  ];
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-vx-hair py-3 pl-2 pr-3 max-[720px]:pr-4 min-[721px]:h-16 min-[721px]:flex-nowrap min-[721px]:py-0">
      <Tooltip label="Back" kbd="Esc" side="bottom">
        <IconButton label="Close compare (Esc)" nativeTitle={false} onClick={onClose}>
          <ArrowLeft size={20} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </Tooltip>
      <FileIcon name={name} type="file" size={32} className="max-[720px]:hidden" />
      <div className="flex min-w-0 flex-1 flex-col min-[721px]:max-w-[360px]">
        <span className="truncate text-[20px] font-semibold leading-[26px] tracking-[-0.015em] text-vx-text-1" title={path}>
          {name}
        </span>
        <span className="vx-meta truncate text-vx-text-3">{['My Drive', ...dirname(path).split('/').filter(Boolean)].join(' / ')}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1 max-[720px]:order-last max-[720px]:w-full max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:pl-2">
        <SidePicker which="A" refId={refA} side={a} isNow={aIsNow} versions={versions} onPick={(c) => onPick('a', c)} />
        <Tooltip label="Swap A and B" kbd="X" className="max-[720px]:self-center">
          <IconButton label="Swap A and B (X)" nativeTitle={false} size="sm" onClick={onSwap} className="max-[720px]:rotate-90">
            <ArrowLeftRight size={18} strokeWidth={1.75} aria-hidden />
          </IconButton>
        </Tooltip>
        <SidePicker which="B" refId={refB} side={b} isNow={bIsNow} versions={versions} onPick={(c) => onPick('b', c)} />
      </div>
      <div className="hidden flex-1 min-[721px]:block" />
      {kind === 'text' ? (
        <Segmented
          label="Diff layout"
          className="max-[720px]:hidden"
          value={modes.text}
          onChange={(v) => onModes({ ...modes, text: v })}
          options={[
            { value: 'split', label: 'Split' },
            { value: 'unified', label: 'Unified' },
          ]}
        />
      ) : kind === 'image' ? (
        <Segmented
          label="Image compare mode"
          className="max-[720px]:order-last"
          value={modes.image}
          onChange={(v) => onModes({ ...modes, image: v })}
          options={[
            { value: 'side', label: 'Side' },
            { value: 'swipe', label: 'Swipe', disabled: !a || !b },
          ]}
        />
      ) : kind === 'csv' ? (
        <Segmented
          label="Rows shown"
          className="max-[720px]:order-last"
          value={modes.changesOnly ? 'changes' : 'all'}
          onChange={(v) => onModes({ ...modes, changesOnly: v === 'changes' })}
          options={[
            { value: 'all', label: 'All rows' },
            { value: 'changes', label: 'Changes only' },
          ]}
        />
      ) : null}
      <Menu
        align="end"
        items={downloads}
        trigger={(p) => (
          <IconButton {...p} label="Download a version">
            <Download size={20} strokeWidth={1.75} aria-hidden />
          </IconButton>
        )}
      />
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

function triggerDownload(url: string) {
  const el = document.createElement('a');
  el.href = url;
  el.download = '';
  document.body.appendChild(el);
  el.click();
  el.remove();
}

/** The 48 px summary row under the head: counts on the left, navigation on the right. */
export function SummaryBar({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-vx-hair px-5 py-2 text-[13px] leading-5 text-vx-text-3 max-[720px]:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2 truncate">{children}</div>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </div>
  );
}

/** "Not present at this version" frame for a missing side. */
export function MissingSide({ which, className }: { which: 'A' | 'B'; className?: string }) {
  return (
    <div className={cx('flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-vx-md border border-dashed border-vx-hair-dash', className)}>
      <SideDisc which={which} size={24} />
      <span className="vx-body text-vx-text-3">Not present at this version</span>
    </div>
  );
}

'use client';

import { ArrowLeft, ArrowLeftRight, ChevronDown, Download, RotateCcw } from 'lucide-react';
import { basename, dirname, type CompareKind, type FileSide, type FileVersion } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { FileIcon } from '@/components/ui/file-icon';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { Segmented } from '@/components/ui/segmented';
import { Tooltip } from '@/components/ui/tooltip';
import { formatMoment } from '@/lib/format';
import { friendlyWhen } from '@/lib/versioning/timeline';
import { CommitId } from './readout';

export type TextMode = 'split' | 'unified';
export type ImageMode = 'side' | 'swipe';

export interface CompareModes {
  text: TextMode;
  image: ImageMode;
  changesOnly: boolean;
}

/**
 * 16 px side disc (UNIFY-SPEC §12.4): brass "A" (the past side), platinum / graphite "B" (the accent ink).
 * `tone="neutral"` is for a side that is not the past (a proposal's "Now"): surface-3, 1 px hair-strong, text-2,
 * so amber keeps meaning the past only.
 */
export function SideDisc({ which, size = 16, tone, className }: { which: 'A' | 'B'; size?: number; tone?: SideTone; className?: string }) {
  const t = tone ?? (which === 'A' ? 'past' : 'accent');
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-medium leading-none',
        t === 'past' ? 'bg-vx-past text-vx-on-past' : t === 'neutral' ? 'border border-vx-hair-strong bg-vx-surface-3 text-vx-text-2' : 'bg-vx-accent text-vx-on-accent',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {which}
    </span>
  );
}

export type SideTone = 'past' | 'neutral' | 'accent';
/** How a compare view names its sides. Omitted: the side's date, a brass A and a platinum B. */
export interface CompareSides {
  a?: { label: string; tone?: SideTone };
  b?: { label: string; tone?: SideTone };
}

/** A side's head label: the given label ("Now", "Proposed"), else the version's moment. */
export function sideLabel(side: FileSide | null, given?: string): string {
  return given ?? (side ? formatMoment(side.createdAt) : 'Not present');
}

/** A Mono diff tag (UNIFY-SPEC §14.3): `+6 lines` in add colours, `−5 lines` in del colours, neutral otherwise; r2. */
export function DiffTag({ tone = 'neutral', children, className }: { tone?: 'add' | 'del' | 'neutral'; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-vx-xs px-1.5 font-mono text-[12px] leading-4 tabular-nums',
        tone === 'add' ? 'bg-vx-add-bg text-vx-add-fg' : tone === 'del' ? 'bg-vx-del-bg text-vx-del-fg' : 'bg-vx-surface-3 text-vx-text-2',
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Side picker (UNIFY-SPEC §12.4): h 32, r4. A is the past (past-wash + past-edge inset, past-strong date, past
 * commit); B has a hair-strong frame (text-1 date, text-3 commit). Date (or "Now") in Inter 13/600, the @commit
 * in Mono 12; ▾ when it opens a menu.
 */
export function SidePill({
  which,
  commitId,
  createdAt,
  isNow,
  menu,
  seconds,
  showCommit,
  className,
  ...rest
}: {
  which: 'A' | 'B';
  commitId: string | null;
  createdAt: string | null;
  isNow: boolean;
  menu?: boolean;
  /** Add :ss to the time (both sides fall in the same minute, so minutes alone read as one moment). */
  seconds?: boolean;
  /** Keep the @commit visible at every width (the times alone cannot tell the sides apart). */
  showCommit?: boolean;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'>) {
  const a = which === 'A';
  const cls = cx(
    'inline-flex h-8 min-w-0 shrink-0 items-center gap-2 whitespace-nowrap rounded-vx-sm pl-2 pr-2.5 text-[13px] leading-5 transition-colors duration-[120ms]',
    a ? 'bg-vx-past-wash shadow-[inset_0_0_0_1px_var(--vx-past-edge)]' : 'border border-vx-hair-strong',
    menu && (a ? 'hover:shadow-[inset_0_0_0_1px_var(--vx-past)]' : 'hover:bg-vx-raise'),
    className,
  );
  const inner = (
    <>
      <SideDisc which={which} />
      <span className={cx('font-semibold tabular-nums', a ? 'text-vx-past-strong' : 'text-vx-text-1')}>
        {isNow ? 'Now' : createdAt ? formatMoment(createdAt) + (seconds ? `:${String(new Date(createdAt).getSeconds()).padStart(2, '0')}` : '') : '…'}
      </span>
      {commitId ? <CommitId id={commitId} className={cx('!text-[12px]', !showCommit && 'max-[1100px]:hidden', a ? 'text-vx-past' : 'text-vx-text-3')} /> : null}
      {menu ? <ChevronDown size={14} strokeWidth={1.75} aria-hidden className={a ? 'text-vx-past' : 'text-vx-text-3'} /> : null}
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
              {v.checkpointNames.length ? <span className="truncate text-vx-text-2">· ◆ {v.checkpointNames[0]}</span> : null}
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
 * Compare head (52 px; UNIFY-SPEC §12.4, DESIGN-v2 §6.7): back, type icon, name over its path, picker A (past) ⇄ picker B,
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
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-vx-hair py-2.5 pl-2 pr-3 max-[720px]:pr-3 min-[1200px]:h-[52px] min-[1200px]:flex-nowrap min-[1200px]:py-0">
      <Tooltip label="Back" kbd="Esc" side="bottom">
        <IconButton label="Close compare (Esc)" nativeTitle={false} onClick={onClose}>
          <ArrowLeft size={18} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </Tooltip>
      <FileIcon name={name} type="file" size={24} className="max-[720px]:hidden" />
      {/* The name takes the free width; below 1200 the A ⇄ B pickers drop to a second row so it never truncates early. */}
      <div className="flex min-w-[160px] flex-1 flex-col">
        <span className="vx-title truncate" title={path}>
          {name}
        </span>
        <span className="vx-meta truncate text-vx-text-3">{['My Drive', ...dirname(path).split('/').filter(Boolean)].join(' / ')}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 max-[1199px]:order-last max-[1199px]:w-full min-[721px]:max-[1199px]:pl-11 max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:px-1">
        <SidePicker which="A" refId={refA} side={a} isNow={aIsNow} versions={versions} onPick={(c) => onPick('a', c)} />
        <Tooltip label="Swap A and B" kbd="X" className="max-[720px]:self-center">
          <IconButton label="Swap A and B (X)" nativeTitle={false} size="sm" onClick={onSwap} className="max-[720px]:rotate-90">
            <ArrowLeftRight size={16} strokeWidth={1.75} aria-hidden />
          </IconButton>
        </Tooltip>
        <SidePicker which="B" refId={refB} side={b} isNow={bIsNow} versions={versions} onPick={(c) => onPick('b', c)} />
      </div>
      {kind === 'text' ? (
        <Segmented
          label="Diff layout"
          className="ml-auto max-[720px]:hidden"
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
          className="min-[721px]:ml-auto max-[720px]:order-last"
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
          className="min-[721px]:ml-auto max-[720px]:order-last"
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
          <IconButton {...p} label="Download a version" className={kind === 'text' || kind === 'image' || kind === 'csv' ? undefined : 'ml-auto'}>
            <Download size={18} strokeWidth={1.75} aria-hidden />
          </IconButton>
        )}
      />
      <Button
        size="sm"
        variant="restore"
        icon={<RotateCcw size={14} strokeWidth={1.75} aria-hidden />}
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

/** The 44 px summary row under the head: counts on the left, navigation on the right. */
export function SummaryBar({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-vx-hair px-4 py-1.5 text-[13px] leading-5 text-vx-text-3 max-[720px]:px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 truncate">{children}</div>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </div>
  );
}

/** "Not present at this version" frame for a missing side. */
export function MissingSide({ which, className }: { which: 'A' | 'B'; className?: string }) {
  return (
    <div className={cx('flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-vx-md border border-dashed border-vx-hair-dash', className)}>
      <SideDisc which={which} size={20} />
      <span className="vx-body text-vx-text-3">Not present at this version</span>
    </div>
  );
}

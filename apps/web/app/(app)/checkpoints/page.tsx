'use client';

// /checkpoints — named versions kept until removed (UNIFY-SPEC §14.3; DESIGN-v2 §6.9).
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, Copy, Ellipsis, Eye, Pencil, Plus, RotateCcw, StickyNote, Trash } from 'lucide-react';
import type { Checkpoint, TagBudget } from '@volumes/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { ContextMenu, type MenuItem } from '@/components/ui/menu';
import { Page, PageHeader } from '@/components/ui/page';
import { Tooltip } from '@/components/ui/tooltip';
import { CheckpointDiamond } from '@/components/versioning/checkpoint-badge';
import { CheckpointEditDialog } from '@/components/versioning/checkpoint-dialog';
import { Bytes, When } from '@/components/versioning/readout';
import { RetentionNote } from '@/components/versioning/retention-note';
import { api } from '@/lib/api/endpoints';
import { useVx } from '@/lib/store';
import { driveCompareHref } from '@/lib/urls';
import { errorText, useCheckpoints, useCommit, useTimelineEntries } from '@/lib/versioning/hooks';
import { plural } from '@/lib/versioning/timeline';

const CP_GRID =
  'grid grid-cols-[36px_minmax(0,1.3fr)_minmax(0,1fr)_132px_88px_64px] items-center gap-x-3 pr-3 max-[900px]:grid-cols-[36px_minmax(0,1fr)_132px_88px_64px] max-[720px]:grid-cols-[28px_minmax(0,1fr)_32px] max-[720px]:pr-1';

/** 6 px r2 meter split in two: checkpoints (accent ink) then pinned links (the outline grey, so it reads on the track). */
function BudgetMeter({ budget }: { budget: TagBudget }) {
  const max = Math.max(1, budget.max);
  const cp = Math.min(100, (budget.checkpoints / max) * 100);
  const links = Math.min(100 - cp, (budget.pinnedLinks / max) * 100);
  return (
    <span
      role="img"
      aria-label={`${budget.used} of ${budget.max} slots used`}
      className="flex h-1.5 w-full gap-px overflow-hidden rounded-vx-xs bg-vx-meter-track"
    >
      <span className="h-full bg-vx-accent" style={{ width: `${cp}%` }} />
      <span className="h-full bg-vx-outline" style={{ width: `${links}%` }} />
    </span>
  );
}

function VersionDate({ cp, known, className }: { cp: Checkpoint; known: string | undefined; className?: string }) {
  const commit = useCommit(known ? null : cp.commitId);
  const at = known ?? commit.data?.createdAt;
  return at ? <When at={at} absolute className={className} /> : <span className={className}>…</span>;
}

export default function CheckpointsPage() {
  const router = useRouter();
  const ws = useVx((s) => s.workspaceId);
  const enter = useVx((s) => s.enterTimeTravel);
  const openCheckpoint = useVx((s) => s.openCheckpoint);
  const openRestore = useVx((s) => s.openRestore);
  const openDuplicate = useVx((s) => s.openDuplicate);
  const refresh = useVx((s) => s.refresh);
  const toast = useVx((s) => s.toast);
  const { data, error, isLoading, mutate } = useCheckpoints();
  const { entries, headCommitId } = useTimelineEntries();
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
  const [editing, setEditing] = useState<{ cp: Checkpoint; focus: 'name' | 'note' } | null>(null);
  const [removing, setRemoving] = useState<Checkpoint | null>(null);

  // Commit times from the loaded timeline; the rest are fetched per row.
  const commitTimes = useMemo(() => new Map(entries.map((e) => [e.commitId, e.createdAt])), [entries]);
  const list = useMemo(() => [...(data?.checkpoints ?? [])].sort((x, y) => y.createdAt.localeCompare(x.createdAt)), [data]);
  const budget = data?.budget;

  const view = async (cp: Checkpoint) => {
    let createdAt = commitTimes.get(cp.commitId);
    if (!createdAt && ws) createdAt = await api.versioning.commit(ws, cp.commitId).then((c) => c.createdAt, () => undefined);
    if (cp.commitId === headCommitId) useVx.getState().exitTimeTravel();
    else enter({ commitId: cp.commitId, createdAt: createdAt ?? cp.createdAt });
    router.push('/drive');
  };

  const items = (cp: Checkpoint): MenuItem[] => [
    { id: 'view', label: 'View', icon: <Eye size={16} strokeWidth={1.75} />, onSelect: () => void view(cp) },
    {
      id: 'cmp',
      label: 'Compare with now',
      icon: <ArrowLeftRight size={16} strokeWidth={1.75} />,
      disabled: cp.commitId === headCommitId,
      reason: 'This checkpoint is the current version.',
      onSelect: () => router.push(driveCompareHref(cp.commitId, headCommitId ?? 'head')),
    },
    {
      id: 'restore',
      label: 'Restore drive…',
      icon: <RotateCcw size={16} strokeWidth={1.75} />,
      tone: 'past',
      disabled: cp.commitId === headCommitId,
      reason: 'The drive is already at this version.',
      onSelect: () => openRestore({ scope: 'drive', at: cp.commitId }),
    },
    { id: 'dup', label: 'Duplicate as new drive…', icon: <Copy size={16} strokeWidth={1.75} />, onSelect: () => openDuplicate(cp.commitId) },
    { id: 'sep', type: 'separator' },
    { id: 'rename', label: 'Rename', icon: <Pencil size={16} strokeWidth={1.75} />, onSelect: () => setEditing({ cp, focus: 'name' }) },
    { id: 'note', label: 'Edit note', icon: <StickyNote size={16} strokeWidth={1.75} />, onSelect: () => setEditing({ cp, focus: 'note' }) },
    { id: 'sep2', type: 'separator' },
    { id: 'del', label: 'Delete', icon: <Trash size={16} strokeWidth={1.75} />, danger: true, onSelect: () => setRemoving(cp) },
  ];

  const full = !!budget && budget.used >= budget.max;
  const openMenu = (cp: Checkpoint, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu({ at: { x: r.right - 240, y: r.bottom + 4 }, items: items(cp) });
  };

  return (
    <Page>
      <PageHeader
        eyebrow="History"
        title="Checkpoints"
        lead="A checkpoint names a version and keeps it until you remove it. Checkpoints and pinned share links use the same 100 slots."
        actions={
          <Button
            variant="outline"
            kbd="P"
            icon={<Plus size={16} strokeWidth={1.75} aria-hidden />}
            disabled={full}
            title={full ? 'All 100 checkpoint slots are used. Remove one first.' : undefined}
            onClick={() => openCheckpoint(null)}
          >
            New checkpoint
          </Button>
        }
      />

      <div className="mt-5 rounded-vx-md bg-vx-surface-2 px-4 py-3">
        {budget ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="vx-eyebrow">Slots</span>
              <p className="font-mono text-[12px] leading-5 tabular-nums text-vx-text-3">
                <span className="font-medium text-vx-text-1">
                  {budget.used} of {budget.max}
                </span>{' '}
                kept
                {budget.pinnedLinks ? (
                  <>
                    {' '}
                    · {budget.pinnedLinks} used by pinned {budget.pinnedLinks === 1 ? 'link' : 'links'}
                  </>
                ) : null}
              </p>
            </div>
            <div className="mt-2.5">
              <BudgetMeter budget={budget} />
            </div>
          </>
        ) : (
          <>
            <span className="skeleton skel-line w-56" />
            <span className="skeleton mt-3 block h-1.5 w-full" />
          </>
        )}
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div aria-busy>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex h-11 items-center gap-4 border-b border-vx-hair-soft px-3">
                <span className="skeleton h-2 w-2 rotate-45" />
                <span className="skeleton skel-line w-40" />
                <span className="skeleton skel-line w-64 max-[720px]:hidden" />
              </div>
            ))}
          </div>
        ) : error ? (
          <EmptyState
            tone="past"
            title="Couldn't load checkpoints."
            body={errorText(error)}
            actions={
              <Button variant="tonal" onClick={() => void mutate()}>
                Retry
              </Button>
            }
          />
        ) : !list.length ? (
          <EmptyState
            art="checkpoints"
            title="Name a moment to keep it forever."
            body="Press P on any version."
            actions={
              <Button variant="tonal" icon={<Plus size={16} strokeWidth={1.75} aria-hidden />} onClick={() => openCheckpoint(null)}>
                New checkpoint
              </Button>
            }
          />
        ) : (
          <div role="table" aria-label="Checkpoints">
            <div role="row" className={cx(CP_GRID, 'vx-colhead h-9 border-b border-vx-hair')}>
              <span role="columnheader" aria-label="Checkpoint" />
              <span role="columnheader">Name</span>
              <span role="columnheader" className="max-[900px]:hidden">
                Note
              </span>
              <span role="columnheader" className="max-[720px]:hidden">
                Version
              </span>
              <span role="columnheader" className="text-right max-[720px]:hidden">
                Size
              </span>
              <span role="columnheader" className="text-right max-[720px]:hidden">
                Files
              </span>
              <span role="columnheader" aria-label="Actions" className="hidden max-[720px]:block" />
            </div>
            <div>
              {list.map((cp) => {
                const isNow = cp.commitId === headCommitId;
                return (
                  <div
                    key={cp.id}
                    role="row"
                    className={cx(CP_GRID, 'group relative min-h-11 border-b border-vx-hair-soft py-1.5 transition-colors duration-[120ms] hover:bg-vx-raise focus-within:bg-vx-raise')}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ at: { x: e.clientX, y: e.clientY }, items: items(cp) });
                    }}
                    onDoubleClick={() => void view(cp)}
                  >
                    <span role="cell" className="flex justify-center text-vx-text-1">
                      <CheckpointDiamond size={8} />
                    </span>
                    <span role="cell" className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[14px] font-semibold leading-5 text-vx-text-1" title={cp.name}>
                          {cp.name}
                        </span>
                        {cp.auto ? <Badge tone="dashed">Auto</Badge> : null}
                        {isNow ? <Badge tone="current">Now</Badge> : null}
                      </span>
                      {cp.note ? (
                        <span className="vx-micro truncate text-vx-text-3 min-[901px]:hidden" title={cp.note}>
                          {cp.note}
                        </span>
                      ) : null}
                      <span className="vx-meta truncate text-vx-text-3 min-[721px]:hidden">
                        <VersionDate cp={cp} known={commitTimes.get(cp.commitId)} /> · <Bytes n={cp.logicalBytes} /> · {plural(cp.fileCount, 'file')}
                      </span>
                    </span>
                    <span role="cell" className="min-w-0 truncate text-[14px] leading-5 text-vx-text-3 max-[900px]:hidden" title={cp.note || undefined}>
                      {cp.note || <span className="text-vx-text-3">—</span>}
                    </span>
                    <span role="cell" className="vx-meta-row text-vx-text-3 max-[720px]:hidden">
                      <VersionDate cp={cp} known={commitTimes.get(cp.commitId)} />
                    </span>
                    <span role="cell" className="vx-meta-row text-right text-vx-text-3 max-[720px]:hidden">
                      <Bytes n={cp.logicalBytes} />
                    </span>
                    <span role="cell" className="vx-meta-row text-right tabular-nums text-vx-text-3 max-[720px]:hidden">
                      {cp.fileCount.toLocaleString('en-US')}
                    </span>
                    {/* hover actions overlay the right end of the row */}
                    <span
                      role="cell"
                      className="vxv-reveal absolute inset-y-0 right-0 flex items-center gap-0.5 bg-vx-raise pl-3 pr-2 max-[720px]:static max-[720px]:bg-transparent max-[720px]:p-0 max-[720px]:!opacity-100"
                    >
                      <span className="flex items-center gap-0.5 max-[720px]:hidden">
                        <Tooltip label="View">
                          <IconButton size="sm" label={`View ${cp.name}`} nativeTitle={false} className="hover:!bg-vx-pressed" onClick={() => void view(cp)}>
                            <Eye size={16} strokeWidth={1.75} aria-hidden />
                          </IconButton>
                        </Tooltip>
                        <Tooltip label={isNow ? 'This checkpoint is the current version.' : 'Compare with now'}>
                          <IconButton
                            size="sm"
                            label={`Compare ${cp.name} with now`}
                            nativeTitle={false}
                            className="hover:!bg-vx-pressed"
                            disabled={isNow}
                            onClick={() => router.push(driveCompareHref(cp.commitId, headCommitId ?? 'head'))}
                          >
                            <ArrowLeftRight size={16} strokeWidth={1.75} aria-hidden />
                          </IconButton>
                        </Tooltip>
                        <Tooltip label={isNow ? 'The drive is already at this version.' : 'Restore drive…'}>
                          <IconButton
                            size="sm"
                            label={`Restore drive to ${cp.name}`}
                            nativeTitle={false}
                            disabled={isNow}
                            className="!text-vx-past hover:!bg-vx-past-wash"
                            onClick={() => openRestore({ scope: 'drive', at: cp.commitId })}
                          >
                            <RotateCcw size={16} strokeWidth={1.75} aria-hidden />
                          </IconButton>
                        </Tooltip>
                      </span>
                      <IconButton size="sm" label={`More actions for ${cp.name}`} className="hover:!bg-vx-pressed" onClick={(e) => openMenu(cp, e.currentTarget)}>
                        <Ellipsis size={16} strokeWidth={1.75} aria-hidden />
                      </IconButton>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {list.length ? <RetentionNote className="mt-4" /> : null}
      </div>

      <ContextMenu at={menu?.at ?? null} items={menu?.items ?? []} onClose={() => setMenu(null)} />
      {editing ? <CheckpointEditDialog checkpoint={editing.cp} focus={editing.focus} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={!!removing}
        danger
        title="Remove checkpoint"
        confirmLabel="Remove"
        onClose={() => setRemoving(null)}
        body={
          removing ? (
            <>
              Remove <span className="font-medium text-vx-text-1">“{removing.name}”</span>? The version itself stays in history only while normal retention keeps it.
              This frees one of the {budget?.max ?? 100} slots checkpoints share with pinned links.
            </>
          ) : null
        }
        onConfirm={async () => {
          if (!ws || !removing) return;
          await api.checkpoints.remove(ws, removing.id);
          toast({ kind: 'success', message: `Removed checkpoint “${removing.name}”` });
          refresh();
          void mutate();
        }}
      />
    </Page>
  );
}

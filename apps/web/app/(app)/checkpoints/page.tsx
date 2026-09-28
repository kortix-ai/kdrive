'use client';

// /checkpoints — named versions kept until removed (DESIGN.md §6.9).
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, Copy, Eye, Pencil, RotateCcw, StickyNote, Trash } from 'lucide-react';
import type { Checkpoint, TagBudget } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { ContextMenu, type MenuItem } from '@/components/ui/menu';
import { Badge } from '@/components/versioning/checkpoint-badge';
import { CheckpointEditDialog } from '@/components/versioning/checkpoint-dialog';
import { Bytes, When } from '@/components/versioning/readout';
import { RetentionNote } from '@/components/versioning/retention-note';
import { api } from '@/lib/api/endpoints';
import { useVx } from '@/lib/store';
import { driveCompareHref } from '@/lib/urls';
import { errorText, useCheckpoints, useCommit, useTimelineEntries } from '@/lib/versioning/hooks';

/** 100 cells: checkpoints (text-2), pinned links (text-4), free (hairline). */
function BudgetBar({ budget }: { budget: TagBudget }) {
  const max = Math.max(1, budget.max);
  return (
    <div className="flex h-[3px] w-full max-w-[400px] gap-px" role="img" aria-label={`${budget.used} of ${budget.max} slots used`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={cx(
            'h-full flex-1',
            i < budget.checkpoints ? 'bg-vx-text-2' : i < budget.checkpoints + budget.pinnedLinks ? 'bg-vx-text-4' : 'bg-vx-hair',
          )}
        />
      ))}
    </div>
  );
}

function VersionDate({ cp, known }: { cp: Checkpoint; known: string | undefined }) {
  const commit = useCommit(known ? null : cp.commitId);
  const at = known ?? commit.data?.createdAt;
  return at ? <When at={at} absolute className="vx-meta text-vx-text-3" /> : <span className="vx-meta text-vx-text-4">…</span>;
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
    { id: 'view', label: 'View', icon: <Eye size={14} />, onSelect: () => void view(cp) },
    {
      id: 'cmp',
      label: 'Compare with now',
      icon: <ArrowLeftRight size={14} />,
      disabled: cp.commitId === headCommitId,
      reason: 'This checkpoint is the current version.',
      onSelect: () => router.push(driveCompareHref(cp.commitId, headCommitId ?? 'head')),
    },
    {
      id: 'restore',
      label: 'Restore drive…',
      icon: <RotateCcw size={14} />,
      disabled: cp.commitId === headCommitId,
      reason: 'The drive is already at this version.',
      onSelect: () => openRestore({ scope: 'drive', at: cp.commitId }),
    },
    { id: 'dup', label: 'Duplicate as workspace…', icon: <Copy size={14} />, onSelect: () => openDuplicate(cp.commitId) },
    { id: 'sep', type: 'separator' },
    { id: 'rename', label: 'Rename', icon: <Pencil size={14} />, onSelect: () => setEditing({ cp, focus: 'name' }) },
    { id: 'note', label: 'Edit note', icon: <StickyNote size={14} />, onSelect: () => setEditing({ cp, focus: 'note' }) },
    { id: 'sep2', type: 'separator' },
    { id: 'del', label: 'Delete', icon: <Trash size={14} />, danger: true, onSelect: () => setRemoving(cp) },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-vx-hair px-6 pb-5 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="vx-h1">Checkpoints</h1>
            {budget ? (
              <div className="mt-3 flex flex-col gap-2">
                <span className="vx-meta text-vx-text-3">
                  <span className="text-vx-text-1">{budget.checkpoints}</span> {budget.checkpoints === 1 ? 'checkpoint' : 'checkpoints'}
                  {budget.pinnedLinks ? <> · {budget.pinnedLinks} pinned {budget.pinnedLinks === 1 ? 'link' : 'links'}</> : null} ·{' '}
                  <span className="text-vx-text-1">{budget.used}</span> of {budget.max} slots used
                </span>
                <BudgetBar budget={budget} />
              </div>
            ) : (
              <span className="skeleton skel-line mt-3 w-64" />
            )}
          </div>
          <Button
            variant="primary"
            kbd="P"
            disabled={!!budget && budget.used >= budget.max}
            title={budget && budget.used >= budget.max ? 'All 100 checkpoint slots are used. Remove one first.' : undefined}
            onClick={() => openCheckpoint(null)}
          >
            New checkpoint
          </Button>
        </div>
        <p className="vx-body mt-4 max-w-[640px] text-vx-text-3">
          A checkpoint names a version and keeps it until you remove it. Checkpoints and pinned share links use the same 100 slots.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="px-6 py-3" aria-busy>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex h-10 items-center gap-4 border-b border-vx-hair-soft">
                <span className="skeleton skel-line w-40" />
                <span className="skeleton skel-line w-64" />
              </div>
            ))}
          </div>
        ) : error ? (
          <EmptyState title="Couldn't load checkpoints." body={errorText(error)} actions={<Button onClick={() => void mutate()}>Retry</Button>} />
        ) : !list.length ? (
          <EmptyState
            title="Name a moment to keep it forever."
            body="Press P on any version."
            actions={
              <Button variant="primary" onClick={() => openCheckpoint(null)}>
                New checkpoint
              </Button>
            }
          />
        ) : (
          <table className="w-full min-w-[720px] border-collapse">
            <thead className="sticky top-0 z-[1] bg-vx-surface-2">
              <tr className="h-8 border-b border-vx-hair">
                <th className="w-10" aria-label="Checkpoint" />
                <th className="vx-label px-2 text-left font-medium">Name</th>
                <th className="vx-label px-2 text-left font-medium">Note</th>
                <th className="vx-label w-[140px] px-2 text-left font-medium">Version</th>
                <th className="vx-label w-[96px] px-2 text-right font-medium">Size</th>
                <th className="vx-label w-[80px] px-2 text-right font-medium">Files</th>
                <th className="w-[220px]" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {list.map((cp) => (
                <tr
                  key={cp.id}
                  className="group h-10 border-b border-vx-hair-soft transition-colors duration-[120ms] hover:bg-vx-surface-2"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ at: { x: e.clientX, y: e.clientY }, items: items(cp) });
                  }}
                  onDoubleClick={() => void view(cp)}
                >
                  <td className="text-center text-[11px] text-vx-accent">◆</td>
                  <td className="max-w-[280px] px-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="vx-name truncate text-vx-text-1" title={cp.name}>
                        {cp.name}
                      </span>
                      {cp.auto ? <Badge tone="dim">Auto</Badge> : null}
                      {cp.commitId === headCommitId ? <Badge>Now</Badge> : null}
                    </span>
                  </td>
                  <td className="max-w-[360px] px-2">
                    <span className="vx-name block truncate text-vx-text-3" title={cp.note || undefined}>
                      {cp.note || <span className="text-vx-text-4">—</span>}
                    </span>
                  </td>
                  <td className="px-2">
                    <VersionDate cp={cp} known={commitTimes.get(cp.commitId)} />
                  </td>
                  <td className="px-2 text-right">
                    <Bytes n={cp.logicalBytes} className="vx-meta text-vx-text-3" />
                  </td>
                  <td className="vx-meta px-2 text-right tabular-nums text-vx-text-3">{cp.fileCount.toLocaleString('en-US')}</td>
                  <td className="px-2">
                    <span className="flex items-center justify-end gap-1 opacity-0 transition-opacity duration-[120ms] focus-within:opacity-100 group-hover:opacity-100">
                      <Button size="sm" variant="ghost" onClick={() => void view(cp)}>
                        View
                      </Button>
                      <Button size="sm" variant="restore" disabled={cp.commitId === headCommitId} onClick={() => openRestore({ scope: 'drive', at: cp.commitId })}>
                        Restore…
                      </Button>
                      <button
                        type="button"
                        aria-label={`More actions for ${cp.name}`}
                        onClick={(e) => {
                          const r = e.currentTarget.getBoundingClientRect();
                          setMenu({ at: { x: r.right - 220, y: r.bottom + 4 }, items: items(cp) });
                        }}
                        className="inline-flex h-7 w-7 items-center justify-center font-mono text-[12px] text-vx-text-3 hover:bg-vx-surface-3 hover:text-vx-text-1"
                      >
                        ⋯
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {list.length ? <RetentionNote className="px-6 py-4" /> : null}
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
              Remove <span className="text-vx-text-1">“{removing.name}”</span>? The version itself stays in history only while normal retention keeps it.
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
    </div>
  );
}

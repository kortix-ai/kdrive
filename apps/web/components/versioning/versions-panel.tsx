'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, Download, Eye, RotateCcw } from 'lucide-react';
import { basename, type FileVersion } from '@volumes/shared';
import { AgentBadge } from '@/components/agents/agent-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { FileIcon } from '@/components/ui/file-icon';
import { IconButton } from '@/components/ui/icon-button';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { formatMoment } from '@/lib/format';
import { useVx } from '@/lib/store';
import { compareHref, contentUrl } from '@/lib/urls';
import { errorText, useFileVersions } from '@/lib/versioning/hooks';
import { friendlyWhen, orderPair } from '@/lib/versioning/timeline';
import { CheckpointBadge } from './checkpoint-badge';
import { Bytes, CommitId } from './readout';
import { RetentionNote } from './retention-note';
import './versioning.css';

/** Shared by the column heads and the rows: [A][B][when][size]; hover actions overlay the size. */
const ROW_GRID = 'grid grid-cols-[20px_20px_minmax(0,1fr)_72px] items-center gap-x-2.5 px-4';

const OP_LABEL: Record<FileVersion['op'], string> = {
  added: 'Added',
  changed: 'Edited',
  deleted: 'Deleted',
  moved: 'Moved',
  copied: 'Copied',
  restored: 'Restored',
  unknown: 'Changed',
};

function changeLabel(v: FileVersion): string {
  if ((v.op === 'moved' || v.op === 'copied') && v.summary) return v.summary;
  if (v.op === 'added' && v.summary?.startsWith('Uploaded')) return 'Uploaded';
  return OP_LABEL[v.op];
}

/** Versions tab (panel.kind === 'versions'): every kept version of a file; pick A and B to compare; restore inline. */
export default function VersionsPanel() {
  const panel = useVx((s) => s.panel);
  if (!panel || panel.kind !== 'versions') return null;
  return <Versions key={panel.path} path={panel.path} />;
}

function Versions({ path }: { path: string }) {
  const router = useRouter();
  const ws = useVx((s) => s.workspaceId);
  const openPreview = useVx((s) => s.openPreview);
  const registerUndo = useVx((s) => s.registerUndo);
  const refresh = useVx((s) => s.refresh);
  const { data, error, isLoading, mutate } = useFileVersions(path);
  const versions = useMemo(() => data?.versions ?? [], [data]);
  const name = basename(path) || path;

  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  // Default: A = previous, B = current (Compare is one click).
  useEffect(() => {
    if (!versions.length) return;
    const cur = versions.find((v) => v.isCurrent) ?? versions[0];
    const prev = versions.find((v) => v.commitId !== cur.commitId && v.op !== 'moved' && v.op !== 'copied') ?? versions.find((v) => v.commitId !== cur.commitId);
    setB((x) => (x && versions.some((v) => v.commitId === x) ? x : cur.commitId));
    setA((x) => (x && versions.some((v) => v.commitId === x) ? x : (prev?.commitId ?? null)));
  }, [versions]);

  const restore = async (v: FileVersion) => {
    if (!ws) return;
    setBusy(true);
    setRowError(null);
    try {
      const r = await api.versioning.restore(ws, { scope: 'file', path, at: v.commitId });
      setConfirming(null);
      registerUndo({ label: `Restored ${name} to ${formatMoment(v.createdAt)}`, actionId: r.action.id, workspaceId: ws });
      refresh();
      void mutate();
    } catch (e) {
      setRowError(errorText(e, 'Could not restore this version.'));
    } finally {
      setBusy(false);
    }
  };

  const compare = () => {
    const va = versions.find((v) => v.commitId === a);
    const vb = versions.find((v) => v.commitId === b);
    if (!va || !vb || va.commitId === vb.commitId) return;
    const [older, newer] = orderPair(va, vb);
    router.push(compareHref(path, older.commitId, newer.commitId));
  };

  const notAFile = error instanceof ApiError && (error.code === 'not_a_file' || error.code === 'not_a_directory');
  const missing = error instanceof ApiError && (error.code === 'path_not_found' || error.status === 404);
  const va = versions.find((v) => v.commitId === a);
  const vb = versions.find((v) => v.commitId === b);
  const pairLabel = va && vb && a !== b ? `Compare ${whenLabel(orderPair(va, vb)[0])} ↔ ${whenLabel(orderPair(va, vb)[1])}` : 'Compare A ↔ B';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 px-4">
        <FileIcon name={name} type="file" size={24} />
        <span className="vx-title min-w-0 truncate" title={path}>
          {name}
        </span>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-2 pt-1">
        <span className="vx-eyebrow truncate" title={path}>
          Every version still kept
        </span>
        <span className="vx-meta shrink-0 text-vx-text-3">A ↔ B</span>
      </div>

      {isLoading ? (
        <div aria-busy className="px-4 pt-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex h-[52px] items-center gap-2.5">
              <span className="skeleton h-4 w-4 !rounded-full" />
              <span className="skeleton h-4 w-4 !rounded-full" />
              <span className="flex flex-1 flex-col">
                <span className="skeleton skel-line w-1/2" />
                <span className="skeleton skel-line w-1/3" />
              </span>
            </div>
          ))}
        </div>
      ) : notAFile ? (
        <EmptyState art="folder" className="py-10" title="Versions are kept per file." body="Pick a file to see every version of it. For a folder, open the drive at an earlier version from History." />
      ) : missing ? (
        <EmptyState tone="past" className="py-10" title="This item is not in the drive now." body="Open the drive at an earlier version to find it, or look in Recently deleted." />
      ) : error ? (
        <div className="flex flex-col items-start gap-2 px-4 py-6">
          <p className="vx-body text-vx-text-2">Couldn&apos;t load versions</p>
          <p className="vx-micro text-vx-text-3">{errorText(error)}</p>
          <Button size="sm" variant="text" className="-ml-3" onClick={() => void mutate()}>
            Retry
          </Button>
        </div>
      ) : !versions.length ? (
        <EmptyState art="history" className="py-10" title="No versions kept yet." body="Every upload of this file adds a version here." />
      ) : (
        <>
          <div className={cx(ROW_GRID, 'vx-colhead h-9 shrink-0 border-y border-vx-hair')}>
            <span className="text-center">A</span>
            <span className="text-center">B</span>
            <span>When</span>
            <span className="text-right">Size</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-2" role="list" aria-label={`Versions of ${name}`}>
            {versions.map((v) => {
              const ghost = (v.op === 'moved' || v.op === 'copied') && !v.isCurrent;
              const isConfirming = confirming === v.commitId;
              return (
                <div key={v.commitId} role="listitem" className="border-b border-vx-hair-soft">
                  <div
                    className={cx(
                      ROW_GRID,
                      'group relative min-h-[52px] py-2 transition-colors duration-[120ms] hover:bg-vx-raise focus-within:bg-vx-raise',
                      isConfirming && '!bg-vx-past-wash',
                    )}
                  >
                    {ghost ? (
                      <>
                        <span />
                        <span />
                      </>
                    ) : (
                      <>
                        <Radio side="A" checked={a === v.commitId} label={`Use as A: ${formatMoment(v.createdAt)}`} onChange={() => setA(v.commitId)} />
                        <Radio side="B" checked={b === v.commitId} label={`Use as B: ${formatMoment(v.createdAt)}`} onChange={() => setB(v.commitId)} />
                      </>
                    )}
                    <div className="flex min-w-0 flex-col">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span
                          className={cx('whitespace-nowrap text-[14px] leading-5 tabular-nums', ghost ? 'font-normal text-vx-text-3' : 'font-medium text-vx-text-1')}
                          title={new Date(v.createdAt).toString()}
                        >
                          {whenLabel(v)}
                        </span>
                        {v.isCurrent ? <Badge tone="current">Current</Badge> : null}
                        {v.checkpointNames.map((c) => (
                          <CheckpointBadge key={c} name={c} className="max-w-[160px]" />
                        ))}
                      </div>
                      <div className="vx-meta mt-0.5 flex min-w-0 items-center gap-1.5 text-vx-text-3">
                        <span className="min-w-0 truncate" title={v.summary ?? undefined}>
                          {changeLabel(v)}
                        </span>
                        <span aria-hidden>·</span>
                        <CommitId id={v.commitId} className="shrink-0" />
                        {v.agent ? <AgentBadge agent={v.agent} className="ml-0.5 min-w-0" /> : null}
                      </div>
                    </div>
                    <Bytes n={ghost && v.size === 0 ? null : v.size} className="vx-meta-row text-right text-vx-text-3" />
                    {/* hover actions overlay the size column */}
                    <div className="vxv-reveal absolute inset-y-0 right-0 flex items-center gap-0.5 bg-vx-raise pl-2 pr-3">
                      <IconButton size="sm" label="Open this version" className="hover:!bg-vx-pressed" onClick={() => openPreview(v.path ?? path, { at: v.commitId })}>
                        <Eye size={16} strokeWidth={1.75} aria-hidden />
                      </IconButton>
                      {ws ? (
                        <a
                          href={contentUrl(ws, v.path ?? path, { at: v.commitId, download: true })}
                          download
                          aria-label="Download this version"
                          title="Download this version"
                          className="vx-inset-focus inline-flex h-7 w-7 items-center justify-center rounded-vx-sm text-vx-text-2 transition-colors duration-[120ms] hover:bg-vx-pressed hover:text-vx-text-1"
                        >
                          <Download size={16} strokeWidth={1.75} aria-hidden />
                        </a>
                      ) : null}
                      {!v.isCurrent ? (
                        <IconButton
                          size="sm"
                          label="Restore this version"
                          className="!text-vx-past hover:!bg-vx-past-wash"
                          onClick={() => {
                            setRowError(null);
                            setConfirming(v.commitId);
                          }}
                        >
                          <RotateCcw size={16} strokeWidth={1.75} aria-hidden />
                        </IconButton>
                      ) : null}
                    </div>
                  </div>
                  {isConfirming ? (
                    <div
                      className="vxv-fade mx-3 mb-3 mt-0.5 rounded-vx-md bg-vx-past-wash px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--vx-past-edge)]"
                      role="group"
                      aria-label="Confirm restore"
                    >
                      <p className="text-[14px] font-semibold leading-5 text-vx-text-1">
                        Restore {name} to {formatMoment(v.createdAt)}?
                      </p>
                      <p className="vx-micro mt-0.5 text-vx-text-3">This makes a new version. You can undo it.</p>
                      {rowError ? (
                        <p role="alert" className="mt-2 rounded-vx-sm bg-vx-danger-wash px-2.5 py-1.5 text-[12px] leading-4 text-vx-danger">
                          {rowError}
                        </p>
                      ) : null}
                      <div className="mt-2.5 flex justify-end gap-1.5">
                        <Button size="sm" variant="text" disabled={busy} onClick={() => setConfirming(null)}>
                          Cancel
                        </Button>
                        <Button size="sm" variant="past-primary" loading={busy} autoFocus onClick={() => void restore(v)}>
                          Restore
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="sticky bottom-0 shrink-0 border-t border-vx-hair bg-vx-surface px-4 py-3">
            {/* Outline: the sidebar's + New is the view's one primary. */}
            <Button
              variant="outline"
              block
              icon={<ArrowLeftRight size={16} strokeWidth={1.75} aria-hidden />}
              disabled={!a || !b || a === b}
              title={!a || !b || a === b ? 'Pick two different versions (A and B)' : undefined}
              onClick={compare}
            >
              <span className="truncate">{pairLabel}</span>
            </Button>
            {data?.source === 'chain' ? <p className="vx-micro mt-2 text-vx-text-3">Older versions rebuilt from history.</p> : null}
            <RetentionNote className="mt-2" />
          </div>
        </>
      )}
    </div>
  );
}

/** "Now" for the current version, else a friendly time ("2 hours ago", "Yesterday, 18:40"). */
function whenLabel(v: FileVersion): string {
  return v.isCurrent ? 'Now' : friendlyWhen(v.createdAt);
}

/** A/B radio (UNIFY-SPEC §10): 16 px circle, 1.5 px ring; A on = past ring + dot, B on = accent ring + dot. */
function Radio({ side, checked, label, onChange }: { side: 'A' | 'B'; checked: boolean; label: string; onChange: () => void }) {
  const on = side === 'A' ? 'border-vx-past' : 'border-vx-accent';
  const dot = side === 'A' ? 'bg-vx-past' : 'bg-vx-accent';
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={onChange}
      className={cx(
        'mx-auto inline-flex h-4 w-4 items-center justify-center rounded-full border-[1.5px] bg-vx-field transition-colors duration-[120ms]',
        checked ? on : 'border-vx-outline hover:border-vx-text-2',
      )}
    >
      {checked ? <span aria-hidden className={cx('h-1.5 w-1.5 rounded-full', dot)} /> : null}
    </button>
  );
}

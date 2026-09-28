'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Eye, RotateCcw } from 'lucide-react';
import { basename, type FileVersion } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { formatAgo, formatTimeTravelLabel } from '@/lib/format';
import { useVx } from '@/lib/store';
import { compareHref, contentUrl } from '@/lib/urls';
import { errorText, useFileVersions } from '@/lib/versioning/hooks';
import { orderPair } from '@/lib/versioning/timeline';
import { Badge, CheckpointBadge } from './checkpoint-badge';
import { Bytes, CommitId, When } from './readout';
import { RetentionNote } from './retention-note';
import './versioning.css';

/** Shared by the header and the rows: the actions column (3 x 28 px) never overlaps the size. */
const ROW_GRID = 'grid grid-cols-[20px_20px_minmax(0,1fr)_64px_88px] items-center gap-x-2 px-4';

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
    const prev = versions.find((v) => v.commitId !== cur.commitId);
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
      registerUndo({ label: `Restored ${name} to ${formatTimeTravelLabel(v.createdAt)}`, actionId: r.action.id });
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
    if (!va || !vb) return;
    const [older, newer] = orderPair(va, vb);
    router.push(compareHref(path, older.commitId, newer.commitId));
  };

  const notAFile = error instanceof ApiError && (error.code === 'not_a_file' || error.code === 'not_a_directory');
  const missing = error instanceof ApiError && (error.code === 'path_not_found' || error.status === 404);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pb-3 pt-4">
        <div className="vx-title truncate" title={path}>
          {name}
        </div>
        <div className="vx-meta mt-0.5 text-vx-text-3">Every version still kept</div>
      </div>

      {isLoading ? (
        <div aria-busy className="px-4">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex h-10 items-center gap-3 border-b border-vx-hair-soft">
              <span className="skeleton h-3.5 w-3.5" />
              <span className="skeleton h-3.5 w-3.5" />
              <span className="skeleton skel-line flex-1" />
            </div>
          ))}
        </div>
      ) : notAFile ? (
        <EmptyState className="py-10" title="Versions are kept per file." body="Pick a file to see every version of it. For a folder, open the drive at an earlier version from the timeline." />
      ) : missing ? (
        <EmptyState className="py-10" title="This item is not in the drive now." body="Open the drive at an earlier version to find it, or look in Recently deleted." />
      ) : error ? (
        <div className="flex flex-col items-start gap-3 px-4 py-6">
          <p className="vx-meta text-vx-text-3">Couldn&apos;t load versions · {errorText(error)}</p>
          <Button size="sm" onClick={() => void mutate()}>
            Retry
          </Button>
        </div>
      ) : !versions.length ? (
        <EmptyState className="py-10" title="No versions kept yet." body="Every upload of this file adds a version here." />
      ) : (
        <>
          {/* [A][B][when + change, badges on line 2][size][actions: their own column, never over the size] */}
          <div className={cx(ROW_GRID, 'shrink-0 border-y border-vx-hair bg-vx-surface-2 py-1.5')}>
            <span className="vx-label text-center">A</span>
            <span className="vx-label text-center">B</span>
            <span className="vx-label">When · change</span>
            <span className="vx-label text-right">Size</span>
            <span aria-hidden />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" role="list" aria-label={`Versions of ${name}`}>
            {versions.map((v) => {
              const ghost = v.op === 'moved' || v.op === 'copied';
              const isConfirming = confirming === v.commitId;
              return (
                <div key={v.commitId} role="listitem" className="border-b border-vx-hair-soft">
                  <div
                    className={cx(
                      ROW_GRID,
                      'group relative min-h-10 py-1 transition-colors duration-[120ms] hover:bg-vx-surface-2',
                      ghost && 'shadow-[inset_1px_0_0_var(--vx-hair-dash)]',
                      isConfirming && 'bg-vx-past-wash',
                    )}
                  >
                    <Radio checked={a === v.commitId} label={`Use as A: ${formatTimeTravelLabel(v.createdAt)}`} onChange={() => setA(v.commitId)} />
                    <Radio checked={b === v.commitId} label={`Use as B: ${formatTimeTravelLabel(v.createdAt)}`} onChange={() => setB(v.commitId)} />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        {v.isCurrent ? (
                          <span className="vx-meta shrink-0 text-vx-text-1">now</span>
                        ) : (
                          <When at={v.createdAt} className={cx('vx-meta shrink-0', ghost ? 'text-vx-text-3' : 'text-vx-text-2')} />
                        )}
                        <CommitId id={v.commitId} className="vx-meta shrink-0 text-vx-text-4" />
                        <span className={cx('vx-meta min-w-0 truncate', v.isCurrent ? 'text-vx-text-1' : 'text-vx-text-3')} title={v.summary ?? undefined}>
                          · {changeLabel(v)}
                        </span>
                      </div>
                      {v.isCurrent || v.checkpointNames.length ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          {v.isCurrent ? <Badge>Current</Badge> : null}
                          {v.checkpointNames.map((c) => (
                            <CheckpointBadge key={c} name={c} className="max-w-full" />
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <Bytes n={ghost && v.size === 0 ? null : v.size} className={cx('vx-meta text-right', v.isCurrent ? 'text-vx-text-1' : 'text-vx-text-3')} />
                    {/* hover actions: a column of their own */}
                    <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity duration-[120ms] focus-within:opacity-100 group-hover:opacity-100">
                      <RowAction label="Open this version" onClick={() => openPreview(v.path ?? path, { at: v.commitId })}>
                        <Eye size={14} strokeWidth={1.5} />
                      </RowAction>
                      {ws ? (
                        <a
                          href={contentUrl(ws, v.path ?? path, { at: v.commitId, download: true })}
                          download
                          aria-label="Download this version"
                          title="Download this version"
                          className="inline-flex h-7 w-7 items-center justify-center text-vx-text-3 hover:bg-vx-surface-3 hover:text-vx-text-1"
                        >
                          <Download size={14} strokeWidth={1.5} />
                        </a>
                      ) : null}
                      {!v.isCurrent ? (
                        <button
                          type="button"
                          aria-label="Restore this version"
                          title="Restore this version"
                          onClick={() => {
                            setRowError(null);
                            setConfirming(v.commitId);
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center text-vx-past hover:bg-vx-past-wash"
                        >
                          <RotateCcw size={14} strokeWidth={1.5} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {isConfirming ? (
                    <div className="vxv-fade flex flex-wrap items-center gap-2 bg-vx-past-wash px-4 pb-2.5 pt-1" role="group" aria-label="Confirm restore">
                      <span className="vx-name min-w-0 flex-1 text-vx-text-2">
                        Restore {name} to {v.isCurrent ? 'now' : formatAgo(v.createdAt)}? Creates a new version.
                      </span>
                      <Button size="sm" variant="restore" loading={busy} autoFocus onClick={() => void restore(v)}>
                        Restore
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
                        Cancel
                      </Button>
                      {rowError ? <p className="w-full border-l-2 border-vx-danger pl-2 text-[12px] text-vx-danger">{rowError}</p> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="shrink-0 border-t border-vx-hair px-4 py-3">
            <Button
              variant="secondary"
              disabled={!a || !b || a === b}
              title={!a || !b || a === b ? 'Pick two different versions (A and B)' : undefined}
              onClick={compare}
              className="w-full"
            >
              ⇄ Compare A ↔ B
            </Button>
            {data?.source === 'chain' ? <p className="vx-micro mt-2 text-vx-text-4">Older versions reconstructed from history.</p> : null}
            <RetentionNote className="mt-2" />
          </div>
        </>
      )}
    </div>
  );
}

function Radio({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={onChange}
      className={cx(
        'mx-auto inline-flex h-3.5 w-3.5 items-center justify-center border transition-colors duration-[120ms]',
        checked ? 'border-pt-100 bg-pt-100' : 'border-vx-hair-strong hover:border-vx-text-3',
      )}
    />
  );
}

function RowAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center text-vx-text-3 hover:bg-vx-surface-3 hover:text-vx-text-1"
    >
      {children}
    </button>
  );
}

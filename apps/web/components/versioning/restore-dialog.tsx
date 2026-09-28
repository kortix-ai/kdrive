'use client';

import { useState } from 'react';
import { basename, type QuotaDetails } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { cx } from '@/components/ui/cx';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { formatBytes, formatTimeTravelLabel } from '@/lib/format';
import { useVx, type RestoreTarget } from '@/lib/store';
import { errorText, useCommit, useDriveCompare, useTimelineEntries } from '@/lib/versioning/hooks';
import { restoreEffects } from '@/lib/versioning/restore-effects';
import { CommitId } from './readout';
import './versioning.css';

/** "Restore … to 14 Sep, 16:40?": shows what will change, explains it is undoable, then restores. */
export default function RestoreDialog() {
  const target = useVx((s) => s.restore);
  if (!target) return null;
  return <Restore key={`${target.scope}:${target.path ?? ''}:${target.at}`} target={target} />;
}

function Restore({ target }: { target: NonNullable<RestoreTarget> }) {
  const ws = useVx((s) => s.workspaceId);
  const close = useVx((s) => s.closeRestore);
  const tt = useVx((s) => s.timeTravel);
  const exitTimeTravel = useVx((s) => s.exitTimeTravel);
  const refresh = useVx((s) => s.refresh);
  const registerUndo = useVx((s) => s.registerUndo);
  const toast = useVx((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { headCommitId, entries } = useTimelineEntries();
  const known = tt?.commitId === target.at ? tt.createdAt : entries.find((e) => e.commitId === target.at)?.createdAt;
  const commit = useCommit(known ? null : target.at);
  const createdAt = known ?? commit.data?.createdAt ?? null;
  const when = createdAt ? formatTimeTravelLabel(createdAt) : '…';

  const scoped = target.scope !== 'file';
  const isHead = !!headCommitId && headCommitId === target.at;
  const cmp = useDriveCompare(scoped && !isHead ? target.at : null, scoped && !isHead ? (headCommitId ?? 'head') : null);
  const effects = cmp.data ? restoreEffects(cmp.data.changes, target.scope === 'folder' ? target.path : '/') : null;

  const name = target.path ? basename(target.path) || target.path : '';
  const what = target.scope === 'drive' ? 'the whole drive' : target.scope === 'folder' ? target.path : name;

  const run = async () => {
    if (!ws || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.versioning.restore(ws, { scope: target.scope, path: target.path, at: target.at });
      close();
      if (target.scope === 'drive') exitTimeTravel();
      refresh();
      const whenShort = createdAt ? formatTimeTravelLabel(createdAt).replace(',', '') : 'that version';
      let label = target.scope === 'drive' ? `Restored the drive to ${whenShort}` : `Restored ${target.scope === 'file' ? name : target.path} to ${whenShort}`;
      if (target.scope === 'drive') {
        if (r.checkpoint) label += ` · Saved checkpoint ${r.checkpoint.name}`;
        else if (r.checkpointSkipped) label += ' · No checkpoint saved (all slots used)';
      }
      if (r.action.status === 'noop') toast({ kind: 'info', message: `${label} · nothing needed to change` });
      else registerUndo({ label, actionId: r.action.id });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'quota_exceeded') {
        const d = e.details as Partial<QuotaDetails>;
        setError(
          d.overBytes
            ? `This restore needs ${formatBytes(d.overBytes)} more than your storage allows. Free up space first.`
            : 'This restore needs more space than your storage allows. Free up space first.',
        );
      } else setError(errorText(e, 'Could not restore.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={close}
      width={520}
      busy={busy}
      error={error}
      onSubmit={() => void run()}
      title={target.scope === 'drive' ? 'Restore drive' : target.scope === 'folder' ? 'Restore folder' : 'Restore file'}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="restore" onClick={() => void run()} loading={busy} disabled={!ws}>
            Restore
          </Button>
        </>
      }
    >
      <h2 className="vx-title">
        Restore {target.scope === 'drive' ? 'the whole drive' : <span className="break-all">{what}</span>} to{' '}
        <span className="tabular-nums text-vx-past">{when}</span>?
      </h2>
      <p className="vx-meta mt-1 text-vx-text-4">
        Version <CommitId id={target.at} />
      </p>

      <div className="mt-4">
        {target.scope === 'file' ? (
          <p className="vx-meta text-vx-text-2">
            <span className="mr-2 inline-block w-3 text-center text-vx-text-3">~</span>
            {name} goes back to its version from {when}.
          </p>
        ) : isHead ? (
          <p className="vx-meta text-vx-text-3">This is already the current version. Nothing changes.</p>
        ) : cmp.isLoading ? (
          <div aria-busy aria-label="Working out what changes">
            <span className="skeleton skel-line w-3/4" />
            <span className="skeleton skel-line w-1/2" />
            <span className="skeleton skel-line w-2/3" />
          </div>
        ) : cmp.error ? (
          <p className="vx-meta text-vx-text-3">Couldn&apos;t work out the changes ahead of time ({errorText(cmp.error)}). You can still restore.</p>
        ) : effects && effects.length ? (
          <ul className="flex flex-col gap-1">
            {effects.map((l) => (
              <li key={l.mark} className="vx-meta flex text-vx-text-2">
                <span
                  className={cx(
                    'mr-2 inline-block w-3 shrink-0 text-center',
                    l.mark === '+' ? 'text-vx-ok' : l.mark === '−' ? 'text-vx-danger' : 'text-vx-text-3',
                  )}
                  aria-hidden
                >
                  {l.mark}
                </span>
                {l.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="vx-meta text-vx-text-3">
            Nothing {target.scope === 'folder' ? 'in this folder ' : ''}differs from now. Restoring creates a version identical to the current one.
          </p>
        )}
        {cmp.data?.source === 'tree' ? <p className="vx-micro mt-2 text-vx-text-4">Worked out by listing both versions.</p> : null}
      </div>

      <p className="vx-body mt-5 text-vx-text-2">This restore becomes a new version. You can undo it.</p>
      {target.scope === 'drive' ? <p className="vx-body mt-1 text-vx-text-3">The current drive is saved first as a checkpoint.</p> : null}
    </Dialog>
  );
}

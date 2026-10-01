'use client';

import { useState } from 'react';
import { CornerUpLeft, Minus, Plus, RotateCcw } from 'lucide-react';
import { basename, type QuotaDetails } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { cx } from '@/components/ui/cx';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { formatBytes, formatMoment } from '@/lib/format';
import { useVx, type RestoreTarget } from '@/lib/store';
import { errorText, useCommit, useDriveCompare, useTimelineEntries } from '@/lib/versioning/hooks';
import { restoreEffects, type EffectLine } from '@/lib/versioning/restore-effects';
import { CommitId } from './readout';
import './versioning.css';

/** "Restore … to 14 Sep, 16:40?" (DESIGN-v2 §6.8): shows what will change, explains it is undoable, then restores. */
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
  const when = createdAt ? formatMoment(createdAt) : '…';

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
      const whenShort = createdAt ? formatMoment(createdAt) : 'that version';
      let label = target.scope === 'drive' ? `Restored the drive to ${whenShort}` : `Restored ${target.scope === 'file' ? name : target.path} to ${whenShort}`;
      if (target.scope === 'drive') {
        if (r.checkpoint) label += ` · Saved checkpoint ${r.checkpoint.name}`;
        else if (r.checkpointSkipped) label += ' · No checkpoint saved (all slots used)';
      }
      if (r.action.status === 'noop') toast({ kind: 'info', message: `${label} · nothing needed to change` });
      else registerUndo({ label, actionId: r.action.id, workspaceId: ws });
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

  const effectRows =
    target.scope === 'file'
      ? [{ mark: '~' as const, text: `${name} goes back to its version from ${when}` }]
      : (effects ?? []).map((l) => ({ mark: l.mark, text: l.text }));

  return (
    <Dialog
      open
      onClose={close}
      width={520}
      busy={busy}
      error={error}
      onSubmit={() => void run()}
      title={
        <>
          Restore {target.scope === 'drive' ? 'the whole drive' : <span className="break-all">{what}</span>} to <span className="whitespace-nowrap tabular-nums">{when}</span>?
        </>
      }
      description={
        <>
          Version <CommitId id={target.at} />
        </>
      }
      footer={
        <>
          <Button variant="text" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="past-primary" onClick={() => void run()} loading={busy} disabled={!ws} icon={<RotateCcw size={16} strokeWidth={1.75} aria-hidden />}>
            Restore
          </Button>
        </>
      }
    >
      <div className="rounded-vx-md bg-vx-surface-2 px-3 py-1.5">
        {target.scope !== 'file' && isHead ? (
          <p className="vx-body flex h-8 items-center text-vx-text-3">This is already the current version. Nothing changes.</p>
        ) : target.scope !== 'file' && cmp.isLoading ? (
          <div aria-busy aria-label="Working out what changes">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex h-8 items-center gap-3">
                <span className="skeleton h-5 w-5 shrink-0" />
                <span className="skeleton skel-line" style={{ width: `${70 - i * 12}%` }} />
              </div>
            ))}
          </div>
        ) : target.scope !== 'file' && cmp.error ? (
          <p className="vx-body py-2 text-vx-text-3">Couldn&apos;t work out the changes ahead of time ({errorText(cmp.error)}). You can still restore.</p>
        ) : effectRows.length ? (
          <ul className="flex flex-col">
            {effectRows.map((l) => (
              <li key={l.mark} className="flex min-h-8 items-center gap-3 py-1 text-[14px] leading-5 text-vx-text-1">
                <EffectTile mark={l.mark} />
                <span className="min-w-0 break-words">
                  <EffectText text={l.text} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="vx-body py-2 text-vx-text-3">
            Nothing {target.scope === 'folder' ? 'in this folder ' : ''}differs from now. Restoring creates a version identical to the current one.
          </p>
        )}
      </div>
      {cmp.data?.source === 'tree' ? <p className="vx-micro mt-2 text-vx-text-3">Worked out by listing both versions.</p> : null}

      <p className="vx-body mt-4 text-vx-text-2">This restore becomes a new version. You can undo it.</p>
      {target.scope === 'drive' ? <p className="vx-micro mt-1 text-vx-text-3">A checkpoint of the current state is saved first.</p> : null}
    </Dialog>
  );
}

/** 20 px r2 glyph tile for an effect line (UNIFY-SPEC §14.3): ~ goes back (past), + comes back (add), − removed (del), → moves back. */
function EffectTile({ mark }: { mark: EffectLine['mark'] }) {
  const tone = mark === '+' ? 'bg-vx-add-bg text-vx-add-fg' : mark === '−' ? 'bg-vx-del-bg text-vx-del-fg' : 'bg-vx-past-wash text-vx-past';
  const Icon = mark === '+' ? Plus : mark === '−' ? Minus : mark === '→' ? CornerUpLeft : RotateCcw;
  return (
    <span aria-hidden className={cx('inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-vx-xs', tone)}>
      <Icon size={12} strokeWidth={2} />
    </span>
  );
}

/** The counts in an effect line ("3 files and 1 folder …") in Mono; the rest stays prose. */
function EffectText({ text }: { text: string }) {
  const parts = text.split(/(\d[\d,]*(?= (?:files?|folders?)\b))/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <span key={i} className="font-mono text-[13px] tabular-nums">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}

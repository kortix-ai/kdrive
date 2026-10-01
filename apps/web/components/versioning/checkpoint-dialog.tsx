'use client';

import { useId, useState } from 'react';
import { Diamond } from 'lucide-react';
import type { Checkpoint, TagBudget } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { formatMoment } from '@/lib/format';
import { useVx } from '@/lib/store';
import { errorText, useCheckpoints, useCommit, useTimelineEntries } from '@/lib/versioning/hooks';
import { CommitId } from './readout';

const NAME_MAX = 80;
const NOTE_MAX = 500;
const FULL = 'All 100 checkpoint slots are used. Remove one first.';

function nameError(name: string): string | null {
  const t = name.trim();
  if (!t) return 'Give the checkpoint a name.';
  if (t.length > NAME_MAX) return `Keep it under ${NAME_MAX} characters (${t.length}).`;
  return null;
}

/** "12 of 100 used, shared with pinned links" */
export function BudgetLine({ budget, className }: { budget: TagBudget | undefined; className?: string }) {
  if (!budget) return <span className={cx('vx-meta text-vx-text-3', className)}>…</span>;
  return (
    <span className={cx('vx-meta tabular-nums', budget.used >= budget.max ? 'text-vx-danger' : 'text-vx-text-3', className)}>
      {budget.used} of {budget.max} used, shared with pinned links
    </span>
  );
}

/** Name + note fields with live validation. */
function Fields({
  name,
  note,
  setName,
  setNote,
  focus,
  touched,
}: {
  name: string;
  note: string;
  setName: (v: string) => void;
  setNote: (v: string) => void;
  focus: 'name' | 'note';
  touched: boolean;
}) {
  const err = touched ? nameError(name) : null;
  const noteId = useId();
  return (
    <div className="flex flex-col gap-4">
      <Input
        label="Name"
        autoFocus={focus === 'name'}
        value={name}
        maxLength={NAME_MAX + 20}
        placeholder="Sent to client"
        onChange={(e) => setName(e.target.value)}
        invalid={err}
        suffix={<span className="tabular-nums">{`${name.trim().length}/${NAME_MAX}`}</span>}
      />
      <div>
        <label htmlFor={noteId} className="mb-1 block text-[13px] font-medium leading-5 text-vx-text-2">
          Note <span className="font-normal text-vx-text-3">(optional)</span>
        </label>
        <textarea
          id={noteId}
          autoFocus={focus === 'note'}
          value={note}
          rows={3}
          maxLength={NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What is special about this version?"
          className="block w-full resize-none rounded-vx-sm border border-vx-hair-strong bg-vx-field px-3 py-2 text-[14px] leading-[22px] text-vx-text-1 outline-none transition-[border-color,box-shadow] duration-[120ms] ease-vx placeholder:text-vx-text-3 hover:border-vx-outline focus:border-transparent focus:shadow-[inset_0_0_0_2px_var(--vx-focus)]"
        />
        <span className="mt-1 block text-right font-mono text-[11px] leading-4 tabular-nums text-vx-text-3">
          {note.length}/{NOTE_MAX}
        </span>
      </div>
    </div>
  );
}

/** New checkpoint at the viewed version (or now). Mounted by the shell; opened with `p` or openCheckpoint(at). */
export default function CheckpointDialog() {
  const cp = useVx((s) => s.checkpoint);
  if (!cp) return null;
  return <CreateCheckpoint key={cp.at ?? 'head'} at={cp.at} />;
}

function CreateCheckpoint({ at }: { at: string | null }) {
  const ws = useVx((s) => s.workspaceId);
  const close = useVx((s) => s.closeCheckpoint);
  const tt = useVx((s) => s.timeTravel);
  const refresh = useVx((s) => s.refresh);
  const toast = useVx((s) => s.toast);
  const list = useCheckpoints();
  const { entries, headCommitId } = useTimelineEntries();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNow = !at || at === headCommitId;
  const known = at ? (tt?.commitId === at ? tt.createdAt : entries.find((e) => e.commitId === at)?.createdAt) : null;
  const commit = useCommit(at && !known && !isNow ? at : null);
  const createdAt = known ?? commit.data?.createdAt ?? null;
  const budget = list.data?.budget;
  const full = !!budget && budget.used >= budget.max;

  const submit = async () => {
    setTouched(true);
    if (nameError(name) || !ws || busy) return;
    if (full) {
      setError(FULL);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.checkpoints.create(ws, { name: name.trim(), note: note.trim() || undefined, at: at ?? undefined });
      close();
      refresh();
      toast({ kind: 'success', message: `Checkpoint "${r.checkpoint.name}" saved. Kept until you remove it.` });
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'tag_budget_exceeded' ? FULL : errorText(e, 'Could not save the checkpoint.'));
      if (e instanceof ApiError && e.code === 'tag_budget_exceeded') void list.mutate();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={close}
      width={480}
      busy={busy}
      error={error ?? (full ? FULL : null)}
      onSubmit={() => void submit()}
      title="New checkpoint"
      footer={
        <>
          <Button variant="text" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={full || (touched && !!nameError(name))} kbd="↵">
            Save checkpoint
          </Button>
        </>
      }
    >
      <p className={cx('vx-meta mb-4 flex min-w-0 flex-wrap items-center gap-1.5', isNow ? 'text-vx-text-3' : 'text-vx-past')}>
        <Diamond size={14} strokeWidth={1.75} aria-hidden className={cx('shrink-0', isNow ? 'text-vx-text-1' : 'text-vx-past')} />
        {isNow ? (
          <span>
            Checkpoints now{headCommitId ? <> · <CommitId id={headCommitId} /></> : null}
          </span>
        ) : (
          <span>
            Checkpoints {createdAt ? formatMoment(createdAt) : '…'} · <CommitId id={at} />
          </span>
        )}
      </p>
      <Fields name={name} note={note} setName={setName} setNote={setNote} focus="name" touched={touched || name.length > 0} />
      <p className="vx-body mt-4 text-vx-text-3">Kept until you remove it.</p>
      <BudgetLine budget={budget} className="mt-1 block" />
    </Dialog>
  );
}

/** Rename / edit note of an existing checkpoint (checkpoints page). */
export function CheckpointEditDialog({ checkpoint, focus, onClose }: { checkpoint: Checkpoint; focus: 'name' | 'note'; onClose: () => void }) {
  const ws = useVx((s) => s.workspaceId);
  const refresh = useVx((s) => s.refresh);
  const [name, setName] = useState(checkpoint.name);
  const [note, setNote] = useState(checkpoint.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (nameError(name) || !ws || busy) return;
    const patch: { name?: string; note?: string } = {};
    if (name.trim() !== checkpoint.name) patch.name = name.trim();
    if (note.trim() !== checkpoint.note) patch.note = note.trim();
    if (!Object.keys(patch).length) return onClose();
    setBusy(true);
    setError(null);
    try {
      await api.checkpoints.update(ws, checkpoint.id, patch);
      refresh();
      onClose();
    } catch (e) {
      setError(errorText(e, 'Could not update the checkpoint.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      width={480}
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
      title={focus === 'name' ? 'Rename checkpoint' : 'Edit note'}
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!!nameError(name)} kbd="↵">
            Save
          </Button>
        </>
      }
    >
      <Fields name={name} note={note} setName={setName} setNote={setNote} focus={focus} touched />
    </Dialog>
  );
}

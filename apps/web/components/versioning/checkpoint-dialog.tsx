'use client';

import { useState } from 'react';
import type { Checkpoint, TagBudget } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { formatDate } from '@/lib/format';
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
  if (!budget) return <span className={cx('vx-meta text-vx-text-4', className)}>…</span>;
  return (
    <span className={cx('vx-meta', budget.used >= budget.max ? 'text-vx-danger' : 'text-vx-text-3', className)}>
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
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="vx-label">Name</span>
        <Input
          autoFocus={focus === 'name'}
          value={name}
          maxLength={NAME_MAX + 20}
          placeholder="Sent to client"
          onChange={(e) => setName(e.target.value)}
          invalid={err}
          suffix={`${name.trim().length}/${NAME_MAX}`}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="vx-label">
          Note <span className="normal-case tracking-normal text-vx-text-4">(optional)</span>
        </span>
        <textarea
          autoFocus={focus === 'note'}
          value={note}
          rows={3}
          maxLength={NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What is special about this version?"
          className="w-full resize-none border border-vx-hair bg-vx-surface-2 px-2.5 py-2 text-[13px] leading-[18px] text-vx-text-1 outline-none transition-colors duration-[120ms] placeholder:text-vx-text-4 focus:border-vx-hair-strong"
        />
        <span className="vx-micro self-end text-vx-text-4">
          {note.length}/{NOTE_MAX}
        </span>
      </label>
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
          <BudgetLine budget={budget} className="mr-auto" />
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={full || (touched && !!nameError(name))} kbd="↵">
            Save checkpoint
          </Button>
        </>
      }
    >
      <p className="vx-meta mb-4 flex items-center gap-2 text-vx-text-3">
        <span className="text-vx-accent">◆</span>
        {isNow ? (
          <span>
            At now{headCommitId ? <> · <CommitId id={headCommitId} /></> : null}
          </span>
        ) : (
          <span className="text-vx-past">
            At {createdAt ? formatDate(createdAt) : '…'} · <CommitId id={at} />
          </span>
        )}
      </p>
      <Fields name={name} note={note} setName={setName} setNote={setNote} focus="name" touched={touched || name.length > 0} />
      <p className="vx-body mt-4 text-vx-text-3">Kept until you remove it.</p>
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
          <Button variant="secondary" onClick={onClose} disabled={busy}>
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

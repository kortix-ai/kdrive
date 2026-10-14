'use client';

import { useId, useState } from 'react';
import { formatBytes, isPaidPlan, STORAGE_REQUEST_NOTE_MAX, type Plan, type StorageRequest } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { api } from '@/lib/api/endpoints';

/**
 * Asks an admin for a paid plan's storage (billing is not on yet). Sends one request per person;
 * asking again replaces the open one. `onSent` gets the stored request.
 */
export function RequestDialog({ plan, onClose, onSent }: { plan: Plan; onClose: () => void; onSent: (r: StorageRequest) => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();

  const send = async () => {
    if (busy || !isPaidPlan(plan.id)) return;
    setBusy(true);
    setError(null);
    try {
      const { request } = await api.me.requestStorage({ plan: plan.id, note: note.trim() || undefined });
      if (request) onSent(request);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the request.');
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Request ${plan.name}`}
      description={`${formatBytes(plan.storageBytes)} of storage`}
      onSubmit={() => void send()}
      busy={busy}
      error={error}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void send()} loading={busy}>
            Send request
          </Button>
        </>
      }
      note="An admin reviews each request. Nothing is charged."
    >
      <p className="text-[14px] leading-[22px] text-vx-text-2">
        Paid plans are coming soon. Request {plan.name} now and we&apos;ll raise your storage to {formatBytes(plan.storageBytes)}. We&apos;ll email you when it&apos;s done.
      </p>
      <div className="mt-4">
        <label htmlFor={noteId} className="mb-1 block text-[13px] font-medium leading-5 text-vx-text-2">
          Note <span className="font-normal text-vx-text-3">(optional)</span>
        </label>
        <textarea
          id={noteId}
          value={note}
          rows={3}
          maxLength={STORAGE_REQUEST_NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What do you need the space for?"
          className="block w-full resize-none rounded-vx-sm border border-vx-hair-strong bg-vx-field px-3 py-2 text-[14px] leading-[22px] text-vx-text-1 outline-none transition-[border-color,box-shadow] duration-[120ms] ease-vx placeholder:text-vx-text-3 hover:border-vx-outline focus:border-transparent focus:shadow-[inset_0_0_0_2px_var(--vx-focus)]"
        />
        <span className="mt-1 block text-right font-mono text-[11px] leading-4 tabular-nums text-vx-text-3">
          {note.length}/{STORAGE_REQUEST_NOTE_MAX}
        </span>
      </div>
    </Dialog>
  );
}

export default RequestDialog;

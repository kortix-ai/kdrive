'use client';

import { useState } from 'react';
import { mutate } from 'swr';
import type { MeResponse, WorkspaceSummary } from '@volumes/shared';
import { Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/endpoints';
import { vx, useVx } from '@/lib/store';
import { workspaceNameError } from './new-workspace-dialog';

/** Rename drive (480) for the current drive, opened from the drive switcher or the drive's ▾ menu. */
export function RenameWorkspaceDialog() {
  const toast = useVx((s) => s.toast);
  const open = useVx((s) => s.renamingDrive);
  const onClose = useVx((s) => s.closeRenameDrive);
  const ws: WorkspaceSummary | null = useVx((s) => (open ? (s.me?.workspaces.find((w) => w.id === s.workspaceId) ?? null) : null));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = workspaceNameError(name);

  // Starts from the drive's current name each time the dialog opens (set during render, so the first paint is filled in).
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (ws && ws.id !== openFor) {
    setOpenFor(ws.id);
    setName(ws.name);
    setError(null);
  }

  const done = () => {
    setOpenFor(null);
    onClose();
  };

  const close = () => {
    if (busy) return;
    done();
  };

  const submit = async () => {
    if (!ws || invalid || busy) return;
    const next = name.trim();
    if (next === ws.name) return close();
    setBusy(true);
    setError(null);
    try {
      await api.workspaces.update(ws.id, { name: next });
      const me = await mutate<MeResponse>('me');
      if (me) vx().setMe(me);
      void mutate('workspaces');
      toast({ kind: 'success', message: `Renamed to ${next}` });
      setBusy(false);
      done();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Could not rename the drive.');
    }
  };

  return (
    <Dialog
      open={!!ws}
      onClose={close}
      title="Rename drive"
      icon={
        <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-vx-sm border border-vx-hair bg-vx-surface-2 text-vx-text-2">
          <Layers size={16} strokeWidth={1.75} />
        </span>
      }
      width={480}
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button variant="text" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!!invalid}>
            Rename
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <Input
          id="ws-rename-name"
          label="Name"
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          invalid={invalid}
        />
        <p className="vx-body text-vx-text-2">Only the name changes. History, checkpoints and share links stay as they are.</p>
      </div>
    </Dialog>
  );
}

export default RenameWorkspaceDialog;

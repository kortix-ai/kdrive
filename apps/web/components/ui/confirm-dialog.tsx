'use client';

import { useState } from 'react';
import { Button } from './button';
import { Dialog } from './dialog';
import { Input } from './input';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  danger?: boolean;
  /** Typed confirmation: the confirm button stays disabled until the input equals this (case-insensitive). */
  typeToConfirm?: string;
}

export function ConfirmDialog({ open, title, body, confirmLabel, onConfirm, onClose, danger, typeToConfirm }: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gated = !!typeToConfirm && typed.trim().toLowerCase() !== typeToConfirm.toLowerCase();
  const run = async () => {
    if (gated) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setTyped('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width={420}
      busy={busy}
      error={error}
      onSubmit={run}
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={run} loading={busy} disabled={gated}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="vx-body text-vx-text-2">{body}</div>
      {typeToConfirm ? (
        <div className="mt-4">
          <Input
            label={
              <>
                Type <span className="font-semibold text-vx-text-1">{typeToConfirm}</span> to confirm
              </>
            }
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            size="sm"
            mono
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      ) : null}
    </Dialog>
  );
}

export default ConfirmDialog;

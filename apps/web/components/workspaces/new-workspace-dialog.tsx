'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { isApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { useVx } from '@/lib/store';
import { switchToWorkspace } from './switch';

/** Validates a workspace name (1–60 chars after trimming). Returns an error or null. */
export function workspaceNameError(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Give the workspace a name.';
  if (n.length > 60) return 'Use at most 60 characters.';
  return null;
}

/** New workspace (480): name only. On success it switches to the empty workspace. */
export function NewWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useVx((s) => s.toast);
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = workspaceNameError(name);

  const close = () => {
    if (busy) return;
    setName('');
    setTouched(false);
    setError(null);
    onClose();
  };

  const submit = async () => {
    setTouched(true);
    if (invalid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { workspace } = await api.workspaces.create({ name: name.trim() });
      await switchToWorkspace(workspace.id);
      router.push('/drive');
      toast({ kind: 'success', message: `Created ${workspace.name}` });
      setBusy(false);
      close();
    } catch (e) {
      setBusy(false);
      setError(
        isApiError(e, 'storage_limit')
          ? 'No more workspaces can be created on this server.'
          : e instanceof Error
            ? e.message
            : 'Could not create the workspace.',
      );
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="New workspace"
      icon={
        <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-vx-surface-3 text-vx-text-2">
          <Layers size={18} strokeWidth={1.75} />
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
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={touched && !!invalid}>
            Create workspace
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <Input
          id="ws-new-name"
          label="Name"
          autoFocus
          value={name}
          maxLength={80}
          placeholder="Projects"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          invalid={touched ? invalid : null}
        />
        <p className="vx-body text-vx-text-2">A separate drive with its own history and checkpoints. It counts toward the same storage quota.</p>
      </div>
    </Dialog>
  );
}

export default NewWorkspaceDialog;

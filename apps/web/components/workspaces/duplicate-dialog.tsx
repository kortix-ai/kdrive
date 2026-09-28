'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { formatBytes, shortId } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { formatTimeTravelLabel, isoTitle } from '@/lib/format';
import { useVx } from '@/lib/store';
import { workspaceNameError } from './new-workspace-dialog';
import { switchToWorkspace } from './switch';

/** Default name for a copy: "Personal copy", trimmed to fit 60 chars. */
export function copyName(name: string): string {
  const suffix = ' copy';
  return (name.slice(0, 60 - suffix.length) + suffix).trim();
}

function errorCopy(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'quota_exceeded') {
      const over = Number((e.details as { overBytes?: number }).overBytes);
      return Number.isFinite(over) && over > 0
        ? `This copy needs ${formatBytes(over)} more than your quota has left.`
        : 'This copy does not fit in your storage quota.';
    }
    if (e.code === 'storage_limit') return 'No more workspaces can be created on this server.';
    if (e.code === 'version_gone') return 'This version is no longer kept, so it cannot be copied.';
    return e.message;
  }
  return e instanceof Error ? e.message : 'Could not duplicate the workspace.';
}

function DuplicateBody({ ws, wsName, at, onClose }: { ws: string; wsName: string; at: string | null; onClose: () => void }) {
  const router = useRouter();
  const toast = useVx((s) => s.toast);
  const tt = useVx((s) => s.timeTravel);
  const [name, setName] = useState(copyName(wsName));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = workspaceNameError(name);

  const known = at && tt?.commitId === at ? tt.createdAt : null;
  const commit = useSWR(at && !known ? ['commit', ws, at] : null, () => api.versioning.commit(ws, at!), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const when = known ?? commit.data?.createdAt ?? null;

  const submit = async () => {
    if (invalid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { workspace } = await api.workspaces.duplicate(ws, { name: name.trim(), ...(at ? { at } : {}) });
      await switchToWorkspace(workspace.id);
      router.push('/drive');
      toast({ kind: 'success', message: `Created ${workspace.name}${when ? ` from ${formatTimeTravelLabel(when)}` : ''}` });
      onClose();
    } catch (e) {
      setError(errorCopy(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Duplicate as new workspace"
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!!invalid}>
            Duplicate
          </Button>
        </>
      }
    >
      <label className="vx-label mb-2 block" htmlFor="ws-dup-name">
        Name
      </label>
      <Input id="ws-dup-name" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} invalid={invalid} />
      <div className="mt-4 flex items-baseline gap-3">
        <span className="vx-label w-[64px] shrink-0">Version</span>
        {at ? (
          <span className="vx-meta text-vx-past" title={when ? isoTitle(when) : at}>
            {when ? formatTimeTravelLabel(when) : commit.error ? 'an earlier version' : '…'} · {shortId(at)}
          </span>
        ) : (
          <span className="vx-meta text-vx-text-1">Now · the latest version of {wsName}</span>
        )}
      </div>
      <p className="vx-body mt-4 text-vx-text-3">Creates a separate workspace from this version. Your current workspace does not change.</p>
      <p className="vx-micro mt-2 text-vx-text-4">The copy counts toward your storage quota. Its history starts at this version.</p>
    </Dialog>
  );
}

/** Duplicate dialog (480): name + version (head, or the `at` passed to `openDuplicate`); switches to the new workspace. */
export default function DuplicateDialog() {
  const duplicate = useVx((s) => s.duplicate);
  const ws = useVx((s) => s.workspaceId);
  const me = useVx((s) => s.me);
  const close = useVx((s) => s.closeDuplicate);
  if (!duplicate || !ws) return null;
  const wsName = me?.workspaces.find((w) => w.id === ws)?.name ?? 'My Drive';
  return <DuplicateBody key={`${ws}:${duplicate.at ?? 'head'}`} ws={ws} wsName={wsName} at={duplicate.at} onClose={close} />;
}

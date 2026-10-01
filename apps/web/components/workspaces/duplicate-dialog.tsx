'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Clock, Copy } from 'lucide-react';
import { formatBytes, shortId } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { formatMoment, isoTitle } from '@/lib/format';
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
    if (e.code === 'storage_limit') return 'No more drives can be created on this server.';
    if (e.code === 'version_gone') return 'This version is no longer kept, so it cannot be copied.';
    return e.message;
  }
  return e instanceof Error ? e.message : 'Could not duplicate the drive.';
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
      toast({ kind: 'success', message: `Created ${workspace.name}${when ? ` from ${formatMoment(when)}` : ''}` });
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
      title="Duplicate as new drive"
      description={`From ${wsName}`}
      icon={
        <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-vx-sm border border-vx-hair bg-vx-surface-2 text-vx-text-2">
          <Copy size={16} strokeWidth={1.75} />
        </span>
      }
      width={480}
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!!invalid}>
            Duplicate
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <Input id="ws-dup-name" label="Name" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} invalid={invalid} />
        <div>
          <div className="mb-1 text-[13px] font-medium leading-5 text-vx-text-2">Version</div>
          {at ? (
            <div
              className="inline-flex max-w-full items-center gap-2 rounded-vx-sm bg-vx-past-wash px-3 py-2 text-[13px] leading-5 text-vx-past shadow-[inset_0_0_0_1px_var(--vx-past-edge)]"
              title={when ? isoTitle(when) : at}
            >
              <Clock size={16} strokeWidth={1.75} className="shrink-0" aria-hidden />
              <span className="min-w-0 truncate">
                <span className="font-semibold text-vx-past-strong">{when ? formatMoment(when) : commit.error ? 'An earlier version' : '…'}</span>
                {' · '}
                <span className="font-mono text-[12px] text-vx-past">{shortId(at)}</span>
              </span>
            </div>
          ) : (
            <div className="inline-flex max-w-full items-center gap-2 rounded-vx-sm border border-vx-hair bg-vx-surface-2 px-3 py-2 text-[13px] leading-5 text-vx-text-2">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-vx-accent" />
              <span className="min-w-0 truncate">
                <span className="font-semibold text-vx-text-1">Now</span> · the latest version of {wsName}
              </span>
            </div>
          )}
        </div>
        <div>
          <p className="vx-body text-vx-text-2">Creates a separate drive from this version. Your current drive does not change.</p>
          <p className="vx-micro mt-1 text-vx-text-3">The copy counts toward your storage quota. Its history starts at this version.</p>
        </div>
      </div>
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

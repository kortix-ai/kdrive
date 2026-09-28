'use client';

import { useState } from 'react';
import { mutate } from 'swr';
import { formatBytes, type WorkspaceSummary } from '@volumes/shared';
import { Badge } from '@/components/share/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { NewWorkspaceDialog, workspaceNameError } from '@/components/workspaces/new-workspace-dialog';
import { provenance } from '@/components/workspaces/workspace-switcher';
import { api } from '@/lib/api/endpoints';
import { useWorkspaces } from '@/lib/api/hooks';
import { formatDate, isoTitle } from '@/lib/format';
import { useVx } from '@/lib/store';
import { Section } from './section';

async function refreshWorkspaces() {
  await Promise.all([mutate('workspaces'), mutate('me'), mutate('usage')]);
}

function WorkspaceRow({ ws, current, onDelete }: { ws: WorkspaceSummary; current: boolean; onDelete: (ws: WorkspaceSummary) => void }) {
  const toast = useVx((s) => s.toast);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(ws.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = workspaceNameError(name);
  const origin = provenance(ws);

  const save = async () => {
    if (invalid || busy) return;
    if (name.trim() === ws.name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.workspaces.update(ws.id, { name: name.trim() });
      await refreshWorkspaces();
      setEditing(false);
      toast({ kind: 'success', message: `Renamed to ${name.trim()}` });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rename the workspace.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="border-b border-vx-hair-soft py-3 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
              className="flex items-center gap-2"
            >
              <Input
                autoFocus
                aria-label="Workspace name"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setName(ws.name);
                    setEditing(false);
                  }
                }}
                invalid={invalid}
                className="max-w-[280px]"
              />
              <Button size="sm" variant="primary" type="submit" loading={busy} disabled={!!invalid}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setName(ws.name);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <span className="vx-name truncate text-vx-text-1">{ws.name}</span>
              {ws.isDefault ? <Badge tone="dim">Default</Badge> : null}
              {current ? <Badge>Current</Badge> : null}
            </div>
          )}
          <div className="vx-meta mt-1 text-vx-text-3">
            {formatBytes(ws.usageBytes)} <span className="vx-unit">·</span> created <span title={isoTitle(ws.createdAt)}>{formatDate(ws.createdAt)}</span>
            {origin ? <span className="text-vx-text-4"> · {origin}</span> : null}
          </div>
          {error ? <p className="mt-1 border-l-2 border-vx-danger pl-2 text-[12px] text-vx-danger">{error}</p> : null}
        </div>
        {!editing ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Rename
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="hover:text-vx-danger"
              disabled={ws.isDefault}
              title={ws.isDefault ? 'Your default workspace cannot be deleted.' : undefined}
              onClick={() => onDelete(ws)}
            >
              Delete
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** WORKSPACES: rows (name, size, created, provenance), inline Rename, Delete (typed confirmation, not the default). */
export function WorkspacesSection() {
  const me = useVx((s) => s.me);
  const current = useVx((s) => s.workspaceId);
  const setWorkspace = useVx((s) => s.setWorkspace);
  const toast = useVx((s) => s.toast);
  const { data, error, mutate: reload } = useWorkspaces();
  const [deleting, setDeleting] = useState<WorkspaceSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const list = data?.workspaces ?? me?.workspaces ?? null;

  const remove = async () => {
    if (!deleting) return;
    await api.workspaces.remove(deleting.id);
    if (deleting.id === current && me) setWorkspace(me.defaultWorkspaceId);
    await refreshWorkspaces();
    toast({ kind: 'success', message: `Deleted ${deleting.name}` });
  };

  return (
    <Section
      id="workspaces"
      label="Workspaces"
      aside={
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          + New workspace
        </Button>
      }
    >
      {error && !list ? (
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-vx-danger">Couldn&apos;t load workspaces.</span>
          <Button size="sm" variant="ghost" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : !list ? (
        <span className="skeleton block h-14 w-full" />
      ) : (
        <ul>
          {list.map((w) => (
            <WorkspaceRow key={w.id} ws={w} current={w.id === current} onDelete={setDeleting} />
          ))}
        </ul>
      )}
      <p className="vx-micro mt-3 text-vx-text-4">Deleting a workspace removes its files, history, checkpoints and share links. It cannot be undone.</p>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete workspace"
        danger
        typeToConfirm={deleting?.name}
        confirmLabel="Delete workspace"
        onConfirm={remove}
        body={
          deleting ? (
            <>
              <strong className="font-medium text-vx-text-1">{deleting.name}</strong> and everything in it goes: {formatBytes(deleting.usageBytes)} of files, every
              version, its checkpoints and its share links. This cannot be undone.
            </>
          ) : null
        }
      />
      <NewWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
    </Section>
  );
}

export default WorkspacesSection;

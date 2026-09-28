'use client';

import { useState } from 'react';
import { mutate } from 'swr';
import { formatBytes, type WorkspaceSummary } from '@volumes/shared';
import { Layers, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { NewWorkspaceDialog, workspaceNameError } from '@/components/workspaces/new-workspace-dialog';
import { provenance } from '@/components/workspaces/workspace-switcher';
import { api } from '@/lib/api/endpoints';
import { useWorkspaces } from '@/lib/api/hooks';
import { formatDate, isoTitle } from '@/lib/format';
import { useVx } from '@/lib/store';
import { Section, SectionError } from './section';

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
    <li className="-mx-2 rounded-vx-sm px-2 py-2.5 transition-colors duration-[120ms] hover:bg-vx-hover">
      <div className="flex items-center gap-3 max-[520px]:flex-wrap">
        <span aria-hidden className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-vx-surface-3 text-vx-text-2">
          <Layers size={18} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-[1_1_200px]">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
              className="flex flex-wrap items-start gap-2"
            >
              <Input
                autoFocus
                size="sm"
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
                className="min-w-0 max-w-[280px] flex-1"
              />
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="text"
                  disabled={busy}
                  onClick={() => {
                    setName(ws.name);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
                <Button size="sm" variant="primary" type="submit" loading={busy} disabled={!!invalid}>
                  Save
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[14px] font-medium leading-5 text-vx-text-1">{ws.name}</span>
              {current ? <Badge tone="current">Current</Badge> : null}
              {ws.isDefault ? <Badge>Default</Badge> : null}
            </div>
          )}
          <div className="vx-meta mt-0.5 truncate text-vx-text-3" title={origin ?? undefined}>
            {formatBytes(ws.usageBytes)} · created <span title={isoTitle(ws.createdAt)}>{formatDate(ws.createdAt)}</span>
            {origin ? <> · {origin}</> : null}
          </div>
          {error ? (
            <div className="mt-2">
              <SectionError>{error}</SectionError>
            </div>
          ) : null}
        </div>
        {!editing ? (
          <div className="-mr-1 flex shrink-0 items-center max-[520px]:-ml-3 max-[520px]:w-full max-[520px]:pl-12">
            <Button size="sm" variant="text" onClick={() => setEditing(true)}>
              Rename
            </Button>
            <Button
              size="sm"
              variant="danger-text"
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

/** Workspaces: rows (name, size, created, provenance), inline Rename, Delete (typed confirmation, not the default). */
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
      description="Separate drives, each with its own history and checkpoints."
      aside={
        <Button size="sm" variant="outline" icon={<Plus size={16} strokeWidth={1.75} aria-hidden />} onClick={() => setCreating(true)}>
          New workspace
        </Button>
      }
    >
      {error && !list ? (
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-vx-del-fg">Couldn&apos;t load workspaces.</span>
          <Button size="sm" variant="text" onClick={() => void reload()}>
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
      <p className="vx-meta mt-3 text-vx-text-3">Deleting a workspace removes its files, history, checkpoints and share links. It cannot be undone.</p>
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
              <strong className="font-semibold text-vx-text-1">{deleting.name}</strong> and everything in it goes: {formatBytes(deleting.usageBytes)} of files, every
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

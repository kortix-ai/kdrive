'use client';

// Settings → AI agents, block 2: apps connected through sign-in (OAuth grants).
import { useEffect, useState } from 'react';
import { format, isSameYear } from 'date-fns';
import { mutate } from 'swr';
import { Bot, Ellipsis } from 'lucide-react';
import type { ConnectedApp } from '@volumes/shared';
import { Section, SectionError } from '@/components/settings/section';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';
import { Menu } from '@/components/ui/menu';
import { api } from '@/lib/api/endpoints';
import { useConnectedApps } from '@/lib/api/hooks';
import { isoTitle } from '@/lib/format';
import { useVx } from '@/lib/store';
import { AccessBadges, AccessOptions, WorkspacePicker, normalizeAccess, type AccessValue } from './access-options';
import { DangerConfirm, usedLabel } from './token-list';

const shortDay = (iso: string) => {
  const d = new Date(iso);
  return isSameYear(d, new Date()) ? format(d, 'd MMM') : format(d, 'd MMM yyyy');
};

/** "Change access…": the access options limited to the app's current level (downgrade only) + workspace. */
export function ChangeAccessDialog({ app, onClose }: { app: ConnectedApp | null; onClose: () => void }) {
  const me = useVx((s) => s.me);
  const [value, setValue] = useState<AccessValue>({ scope: 'drive:read', mode: 'review' });
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!app) return;
    setValue(normalizeAccess({ scope: app.scope, mode: app.mode }));
    setWorkspaceId(app.workspaceId);
    setError(null);
    setBusy(false);
  }, [app]);

  const save = async () => {
    if (!app || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.agents.updateApp(app.id, { scope: value.scope, mode: value.mode, workspaceId });
      await mutate('agent-apps');
      onClose();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not change its access.');
      setBusy(false);
    }
  };

  const workspaces = me?.workspaces ?? [];
  const known = !workspaceId || workspaces.some((w) => w.id === workspaceId);
  return (
    <Dialog
      open={!!app}
      onClose={onClose}
      title={app ? `Change access for ${app.name}` : 'Change access'}
      description="Lower its access, or choose whether its changes wait for your review. To give it more access, connect it again from the app."
      onSubmit={() => void save()}
      busy={busy}
      error={error}
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      {app ? (
        <div className="flex flex-col gap-5">
          <AccessOptions value={value} onChange={setValue} maxScope={app.scope} disabledReason="Connect the app again to give it more access" />
          <WorkspacePicker
            workspaces={known ? workspaces : [...workspaces, { id: workspaceId!, name: app.workspaceName ?? 'Removed drive' }]}
            value={workspaceId}
            onChange={setWorkspaceId}
          />
        </div>
      ) : null}
    </Dialog>
  );
}

function AppRow({ app, onChange }: { app: ConnectedApp; onChange: (a: ConnectedApp) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.agents.revokeApp(app.id);
      setConfirming(false);
      await mutate('agent-apps');
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not disconnect the app.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="-mx-3 border-t border-vx-hair-soft px-3 py-3 transition-colors duration-[120ms] first:border-t-0 hover:bg-vx-raise" data-app-id={app.id}>
      <div className="flex min-h-8 items-center gap-3">
        <span aria-hidden className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-vx-sm border border-vx-hair bg-vx-surface-2 text-vx-text-2">
          <Bot size={16} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[14px] font-medium leading-5 text-vx-text-1">{app.name}</span>
            <AccessBadges scope={app.scope} mode={app.mode} workspaceId={app.workspaceId} workspaceName={app.workspaceName} />
          </div>
          <div className="vx-meta mt-0.5 truncate text-vx-text-3">
            {app.redirectHost ? (
              <>
                <span>{app.redirectHost}</span> ·{' '}
              </>
            ) : null}
            connected <span title={isoTitle(app.createdAt)}>{shortDay(app.createdAt)}</span> ·{' '}
            <span title={app.lastUsedAt ? isoTitle(app.lastUsedAt) : undefined}>{usedLabel(app.lastUsedAt)}</span>
          </div>
        </div>
        <Menu
          align="end"
          items={[
            { id: 'change', label: 'Change access…', onSelect: () => onChange(app) },
            { type: 'separator', id: 'sep' },
            { id: 'disconnect', label: 'Disconnect', danger: true, onSelect: () => setConfirming(true) },
          ]}
          trigger={(p) => (
            <IconButton {...p} size="sm" label={`Actions for ${app.name}`} className="max-[720px]:h-11 max-[720px]:w-11">
              <Ellipsis size={16} strokeWidth={1.75} aria-hidden />
            </IconButton>
          )}
        />
      </div>
      {confirming ? (
        <DangerConfirm
          question={`Disconnect ${app.name}?`}
          detail="It stops working now and must ask again to reconnect."
          action="Disconnect"
          busy={busy}
          onConfirm={() => void disconnect()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
      {error ? (
        <div className="mt-2">
          <SectionError>{error}</SectionError>
        </div>
      ) : null}
    </li>
  );
}

/** Connected apps: one row per live grant with its access, mode and workspace; Change access… and Disconnect. */
export function AppsList() {
  const { data, error } = useConnectedApps();
  const [changing, setChanging] = useState<ConnectedApp | null>(null);
  const apps = data?.apps;
  return (
    <Section id="agents-apps" label="Connected apps">
      {error && !apps ? (
        <SectionError>Can&apos;t load your connected apps right now.</SectionError>
      ) : !apps ? (
        <span className="skeleton block h-10 w-full" />
      ) : apps.length === 0 ? (
        <p className="vx-body text-vx-text-3">No apps connected yet. Apps you connect with Sign in appear here.</p>
      ) : (
        <ul className="flex flex-col" aria-label="Connected apps">
          {apps.map((a) => (
            <AppRow key={a.id} app={a} onChange={setChanging} />
          ))}
        </ul>
      )}
      <ChangeAccessDialog app={changing} onClose={() => setChanging(null)} />
    </Section>
  );
}

export default AppsList;

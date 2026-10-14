'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutate } from 'swr';
import { ChevronDown, Users } from 'lucide-react';
import type { DriveInvite, DriveMember, MeResponse, MemberRole } from '@volumes/shared';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { isApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { useDrivePeople } from '@/lib/api/hooks';
import { formatDate } from '@/lib/format';
import { currentRole, useVx, vx } from '@/lib/store';

const ROLE_LABEL: Record<DriveMember['role'], string> = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };
const ROLE_HINT: Record<MemberRole, string> = {
  editor: 'Adds, changes, restores and shares files',
  viewer: 'Browses, downloads and compares versions',
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A role picker: the current role and a chevron, opening Editor / Viewer (with what each may do). */
function RolePicker({ value, onChange, disabled, label }: { value: MemberRole; onChange: (r: MemberRole) => void; disabled?: boolean; label: string }) {
  const items: MenuItem[] = (['editor', 'viewer'] as const).map((r) => ({
    id: r,
    label: ROLE_LABEL[r],
    hint: ROLE_HINT[r],
    checked: r === value,
    onSelect: () => r !== value && onChange(r),
  }));
  return (
    <Menu
      items={items}
      align="end"
      minWidth={260}
      trigger={(p) => (
        <Button {...p} size="sm" variant="outline" disabled={disabled} aria-label={`${label}: ${ROLE_LABEL[value]}`}>
          {ROLE_LABEL[value]}
          <ChevronDown size={14} strokeWidth={1.75} aria-hidden className="-mr-1 ml-1 text-vx-text-3" />
        </Button>
      )}
    />
  );
}

function PersonRow({ name, email, children, meta }: { name: string | null; email: string; children?: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 border-t border-vx-hair-soft py-2.5 first:border-t-0">
      <Avatar name={name || email} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium leading-5 text-vx-text-1">{name || email}</div>
        <div className="vx-meta truncate text-vx-text-3">
          {name ? email : null}
          {name && meta ? ' · ' : null}
          {meta}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </li>
  );
}

async function refreshMe() {
  const me = await mutate<MeResponse>('me');
  if (me) vx().setMe(me);
}

/**
 * People (560) for the current drive. The owner invites by address (as editor or viewer),
 * changes roles, removes people and withdraws invitations; a member sees who has access and
 * can leave. Opened from the drive switcher and the drive's ▾ menu.
 */
export function PeopleDialog() {
  const router = useRouter();
  const open = useVx((s) => s.peopleOpen);
  const close = useVx((s) => s.closePeople);
  const toast = useVx((s) => s.toast);
  const me = useVx((s) => s.me);
  const wsId = useVx((s) => s.workspaceId);
  const role = useVx(currentRole);
  const ws = me?.workspaces.find((w) => w.id === wsId) ?? null;
  const owner = role === 'owner';
  const { data, error: loadError, mutate: reload } = useDrivePeople(open ? wsId : null);

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('editor');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<DriveMember | null>(null);
  const [leaving, setLeaving] = useState(false);

  const emailError = !email.trim() ? 'Enter an email address.' : EMAIL.test(email.trim()) ? null : 'Enter a valid email address.';

  const done = () => {
    if (busy) return;
    setEmail('');
    setTouched(false);
    setError(null);
    close();
  };

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await reload();
      if (ok) toast({ kind: 'success', message: ok });
      return true;
    } catch (e) {
      setError(
        isApiError(e, 'already_member') || isApiError(e, 'too_many_people') || isApiError(e, 'rate_limited')
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Something went wrong.',
      );
      return false;
    } finally {
      setBusy(null);
    }
  };

  const invite = async () => {
    setTouched(true);
    if (!wsId || emailError || busy) return;
    const to = email.trim().toLowerCase();
    if (await run('invite', () => api.workspaces.invite(wsId, { email: to, role: inviteRole }), `Invited ${to}`)) {
      setEmail('');
      setTouched(false);
    }
  };

  const members = data?.members ?? [];
  const invites: DriveInvite[] = data?.invites ?? [];

  return (
    <>
      <Dialog
        open={open && !removing && !leaving}
        onClose={done}
        title={ws ? `People · ${ws.name}` : 'People'}
        description={
          owner
            ? 'Invite people by email. They join once they accept, signed in with that address. What they add counts toward your storage.'
            : ws?.owner
              ? `${ws.owner.name || ws.owner.email} owns this drive. You are ${role === 'editor' ? 'an editor' : 'a viewer'}.`
              : undefined
        }
        icon={
          <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-vx-sm border border-vx-hair bg-vx-surface-2 text-vx-text-2">
            <Users size={16} strokeWidth={1.75} />
          </span>
        }
        width={560}
        busy={!!busy}
        error={error ?? (loadError ? 'Could not load the people of this drive.' : null)}
        onSubmit={owner ? () => void invite() : undefined}
        footer={
          <>
            {!owner && wsId && me ? (
              <Button variant="danger-text" className="mr-auto" onClick={() => setLeaving(true)} disabled={!!busy}>
                Leave drive
              </Button>
            ) : null}
            <Button variant="text" onClick={done} disabled={!!busy}>
              Done
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 pb-2">
          {owner ? (
            <form
              className="flex items-start gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void invite();
              }}
            >
              <Input
                id="people-invite-email"
                aria-label="Email address"
                autoFocus
                type="email"
                placeholder="name@company.com"
                value={email}
                maxLength={320}
                onChange={(e) => setEmail(e.target.value)}
                invalid={touched ? emailError : null}
                className="min-w-0 flex-1"
              />
              <RolePicker value={inviteRole} onChange={setInviteRole} label="Invite as" />
              <Button type="submit" variant="primary" loading={busy === 'invite'} disabled={!!busy && busy !== 'invite'}>
                Invite
              </Button>
            </form>
          ) : null}

          <section aria-label="People with access">
            <div className="vx-eyebrow mb-1">People with access</div>
            {!data && !loadError ? <div className="vx-meta py-3 text-vx-text-3">Loading…</div> : null}
            <ul>
              {members.map((m) => (
                <PersonRow key={m.id} name={m.name} email={m.email} meta={m.role === 'owner' ? null : `joined ${formatDate(m.since)}`}>
                  {m.id === me?.user.id ? <Badge tone="current">You</Badge> : null}
                  {m.role === 'owner' || !owner ? (
                    <span className="vx-meta px-2 text-vx-text-2">{ROLE_LABEL[m.role]}</span>
                  ) : (
                    <>
                      <RolePicker
                        value={m.role}
                        label={`Role of ${m.email}`}
                        disabled={!!busy}
                        onChange={(r) => wsId && void run(`role-${m.id}`, () => api.workspaces.setRole(wsId, m.id, r), `${m.name || m.email} is now ${r === 'editor' ? 'an editor' : 'a viewer'}`)}
                      />
                      <Button size="sm" variant="danger-text" disabled={!!busy} onClick={() => setRemoving(m)} aria-label={`Remove ${m.email}`}>
                        Remove
                      </Button>
                    </>
                  )}
                </PersonRow>
              ))}
            </ul>
          </section>

          {owner && invites.length ? (
            <section aria-label="Invitations">
              <div className="vx-eyebrow mb-1">Invited</div>
              <ul>
                {invites.map((i) => (
                  <PersonRow key={i.id} name={null} email={i.email} meta={`${ROLE_LABEL[i.role]} · invited ${formatDate(i.createdAt)} · waiting to accept`}>
                    <Button
                      size="sm"
                      variant="text"
                      disabled={!!busy}
                      onClick={() => wsId && void run(`revoke-${i.id}`, () => api.workspaces.revokeInvite(wsId, i.id), `Invitation to ${i.email} withdrawn`)}
                    >
                      Withdraw
                    </Button>
                  </PersonRow>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing?.name || removing?.email}?`}
        body={`They lose access to ${ws?.name ?? 'this drive'} right away. Files they added stay, and so does the history.`}
        confirmLabel="Remove"
        danger
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!wsId || !removing) return;
          await api.workspaces.removeMember(wsId, removing.id);
          await reload();
          toast({ kind: 'success', message: `${removing.name || removing.email} removed` });
          setRemoving(null);
        }}
      />

      <ConfirmDialog
        open={leaving}
        title={`Leave ${ws?.name ?? 'this drive'}?`}
        body="You lose access right away. To come back, the owner has to invite you again."
        confirmLabel="Leave drive"
        danger
        onClose={() => setLeaving(false)}
        onConfirm={async () => {
          if (!wsId || !me) return;
          await api.workspaces.removeMember(wsId, me.user.id);
          setLeaving(false);
          close();
          vx().setWorkspace(me.defaultWorkspaceId ?? me.workspaces[0]?.id ?? '');
          await refreshMe();
          router.push('/drive');
          toast({ kind: 'success', message: `You left ${ws?.name ?? 'the drive'}` });
        }}
      />
    </>
  );
}

export default PeopleDialog;

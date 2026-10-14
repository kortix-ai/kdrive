'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutate } from 'swr';
import { Users } from 'lucide-react';
import type { Invitation, MeResponse } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/endpoints';
import { useInvitations } from '@/lib/api/hooks';
import { useVx, vx } from '@/lib/store';

/** "Ada invited you to Q3 plans as an editor" with Accept / Decline. Accepting switches to the drive. */
function InvitationCard({ inv, onDone }: { inv: Invitation; onDone: () => Promise<unknown> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const who = inv.invitedBy?.name || inv.invitedBy?.email || 'Someone';

  const act = async (kind: 'accept' | 'decline') => {
    setBusy(kind);
    try {
      if (kind === 'accept') {
        const { workspace } = await api.invitations.accept(inv.id);
        const me = await mutate<MeResponse>('me');
        if (me) vx().setMe(me);
        vx().setWorkspace(workspace.id);
        router.push('/drive');
        vx().toast({ kind: 'success', message: `You joined ${workspace.name}` });
      } else {
        await api.invitations.decline(inv.id);
      }
      await onDone();
    } catch (e) {
      vx().toast({ kind: 'error', message: e instanceof Error ? e.message : 'Could not answer the invitation.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="rounded-vx-sm border border-vx-hair bg-vx-surface-2 p-2.5">
      <div className="flex gap-2">
        <Users size={14} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-vx-text-3" />
        <p className="min-w-0 text-[13px] leading-[18px] text-vx-text-2">
          <span className="font-medium text-vx-text-1">{who}</span> invited you to <span className="font-medium text-vx-text-1">{inv.workspaceName}</span> as{' '}
          {inv.role === 'editor' ? 'an editor' : 'a viewer'}
        </p>
      </div>
      <div className="mt-2 flex justify-end gap-1">
        <Button size="xs" variant="text" disabled={!!busy} loading={busy === 'decline'} onClick={() => void act('decline')}>
          Decline
        </Button>
        <Button size="xs" variant="primary" disabled={!!busy} loading={busy === 'accept'} onClick={() => void act('accept')}>
          Accept
        </Button>
      </div>
    </li>
  );
}

/** Open invitations to other people's drives, under the drive switcher (hidden in the collapsed sidebar). */
export function Invitations() {
  const signedIn = useVx((s) => !!s.me?.defaultWorkspaceId);
  const { data, mutate: reload } = useInvitations(signedIn);
  const list = data?.invitations ?? [];
  if (!list.length) return null;
  return (
    <section aria-label="Invitations" className="vx-side-full mt-2">
      <div className="vx-eyebrow mb-1.5 px-2.5">Invitations</div>
      <ul className="flex flex-col gap-1.5">
        {list.map((inv) => (
          <InvitationCard key={inv.id} inv={inv} onDone={reload} />
        ))}
      </ul>
    </section>
  );
}

export default Invitations;

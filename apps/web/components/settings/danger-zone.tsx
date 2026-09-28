'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR, { mutate } from 'swr';
import { formatBytes, type MeResponse } from '@volumes/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { api } from '@/lib/api/endpoints';
import { useVx } from '@/lib/store';

/** Counts the active share links across the user's workspaces (for the "what goes" list). */
function useLinkCount(me: MeResponse, enabled: boolean) {
  return useSWR(
    enabled ? ['link-count', ...me.workspaces.map((w) => w.id)] : null,
    async () => {
      const lists = await Promise.all(me.workspaces.map((w) => api.links.list(w.id).catch(() => ({ links: [] }))));
      return lists.reduce((n, l) => n + l.links.filter((x) => !x.revokedAt).length, 0);
    },
    { revalidateOnFocus: false },
  );
}

function WhatGoes({ me, open }: { me: MeResponse; open: boolean }) {
  const links = useLinkCount(me, open);
  const n = me.workspaces.length;
  return (
    <div>
      <p>This permanently deletes your account and everything in it:</p>
      <ul className="vx-meta mt-3 flex flex-col gap-1 border-l border-vx-danger-edge pl-3 text-vx-text-2">
        <li>
          {n} {n === 1 ? 'workspace' : 'workspaces'} · {formatBytes(me.usage.usedBytes)} of files
        </li>
        <li>every version, checkpoint and restore point</li>
        <li>
          {links.data === undefined ? '…' : links.data} share {links.data === 1 ? 'link' : 'links'} (they stop working)
        </li>
        <li>your sign-in and connected accounts</li>
      </ul>
      <p className="mt-3 text-vx-text-3">There is no undo. Download anything you want to keep first.</p>
    </div>
  );
}

/** DANGER ZONE: delete the account (dialog lists what goes; typing the email enables the button). */
export function DangerZone({ me }: { me: MeResponse }) {
  const router = useRouter();
  const setMe = useVx((s) => s.setMe);
  const [open, setOpen] = useState(false);

  const remove = async () => {
    await api.me.deleteAccount({ confirm: me.user.email });
    setMe(null);
    try {
      window.localStorage.removeItem('vx-ws');
    } catch {
      /* private mode */
    }
    await mutate(() => true, undefined, { revalidate: false });
    router.replace('/signin');
  };

  return (
    <section aria-labelledby="s-danger" className="mt-6 border border-vx-danger-edge p-5">
      <h2 id="s-danger" className="vx-label text-vx-danger">
        Danger zone
      </h2>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="vx-name text-vx-text-1">Delete account</div>
          <p className="vx-body mt-1 text-vx-text-3">Deletes your workspaces, their history and your share links. You are signed out.</p>
        </div>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete account…
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete account"
        danger
        typeToConfirm={me.user.email}
        confirmLabel="Delete account"
        onConfirm={remove}
        body={<WhatGoes me={me} open={open} />}
      />
    </section>
  );
}

export default DangerZone;

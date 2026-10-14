'use client';

// Admin → Requests: people asking for a paid plan's storage, oldest first (the queue). Each row
// shows who, which plan, their note, when, their usage against their quota and any Stripe
// subscription; Grant raises the quota to the plan's size, Dismiss closes it unchanged.
import { useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { formatBytes, meterLevel, planById, type AdminStorageRequest, type Subscription } from '@volumes/shared';
import { formatWhen } from '@/components/preview/names';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { Meter } from '@/components/ui/meter';
import { api } from '@/lib/api/endpoints';
import { isoTitle } from '@/lib/format';
import { useVx } from '@/lib/store';

export const STORAGE_REQUESTS_KEY = 'admin-storage-requests';

/** "Plus · active", "Pro · ends 2 Nov", "Plus · past due": a subscription in one badge, or null. */
export function subscriptionLabel(s: Subscription | null): string | null {
  if (!s) return null;
  const plan = s.plan ? planById(s.plan).name : 'Plan';
  if (s.entitled && s.cancelAtPeriodEnd && s.currentPeriodEnd) {
    return `${plan} · ends ${new Date(s.currentPeriodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  }
  return `${plan} · ${s.status.replace(/_/g, ' ')}`;
}

export function SubscriptionBadge({ s }: { s: Subscription | null }) {
  const label = subscriptionLabel(s);
  if (!label || !s) return null;
  return (
    <Badge tone={s.entitled ? (s.status === 'past_due' ? 'danger' : 'live') : 'dashed'} title="Stripe subscription">
      {label}
    </Badge>
  );
}

/** The open requests (the list, and the count on the tab label: one SWR key). Off until `enabled`. */
export function useOpenStorageRequests(enabled = true) {
  return useSWR(enabled ? STORAGE_REQUESTS_KEY : null, () => api.admin.storageRequests({ status: 'open' }), { revalidateOnFocus: false, shouldRetryOnError: false });
}

export function StorageRequests() {
  const { data, error, mutate } = useOpenStorageRequests();
  const [busy, setBusy] = useState<string | null>(null);

  const answer = async (r: AdminStorageRequest, how: 'grant' | 'dismiss') => {
    setBusy(`${r.id}:${how}`);
    try {
      const { request } = how === 'grant' ? await api.admin.grantStorageRequest(r.id) : await api.admin.dismissStorageRequest(r.id);
      void mutate((cur) => (cur ? { requests: cur.requests.filter((x) => x.id !== r.id) } : cur), { revalidate: false });
      // Quotas changed: the Users and Overview tabs reload when they open next.
      void globalMutate((k) => Array.isArray(k) && (k[0] === 'admin-users' || k[0] === 'admin-overview' || k[0] === 'admin-user'));
      useVx.getState().toast({
        kind: 'success',
        message:
          how === 'grant'
            ? `Granted ${planById(r.plan).name} to ${r.user.email}. Their quota is ${formatBytes(request.quotaBytes)}.`
            : `Dismissed ${r.user.email}'s request.`,
      });
    } catch (e) {
      useVx.getState().toast({ kind: 'error', message: e instanceof Error ? e.message : 'Could not answer the request.' });
      void mutate();
    } finally {
      setBusy(null);
    }
  };

  if (error && !data) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-vx-sm bg-vx-danger-wash px-4 py-3">
        <span className="text-[13px] text-vx-danger">Couldn&apos;t load storage requests.</span>
        <Button size="sm" variant="text" onClick={() => void mutate()}>
          Retry
        </Button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="px-1 py-2">
        {[90, 80, 85].map((w, i) => (
          <span key={i} className="skeleton skel-line" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }
  if (!data.requests.length) {
    return <EmptyState art={false} title="No open requests." body="When someone asks for more storage from Pricing, it shows up here." className="py-10" />;
  }

  return (
    <ul className="divide-y divide-vx-hair-soft" aria-label="Open storage requests">
      {data.requests.map((r) => {
        const plan = planById(r.plan);
        const level = meterLevel(r.usedBytes, r.quotaBytes);
        return (
          <li key={r.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4">
            <div className="flex min-w-[240px] flex-1 items-start gap-3">
              <Avatar name={r.user.name || r.user.email} size={24} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[14px] font-medium leading-5 text-vx-text-1" title={r.user.email}>
                    {r.user.email}
                  </span>
                  <SubscriptionBadge s={r.subscription} />
                </div>
                <div className="vx-meta mt-0.5 text-vx-text-3">
                  {r.user.name ? `${r.user.name} · ` : ''}
                  <span title={isoTitle(r.createdAt)}>asked {formatWhen(r.createdAt)}</span>
                </div>
                {r.note ? <p className="mt-1.5 max-w-[56ch] text-[13px] leading-5 text-vx-text-2">“{r.note}”</p> : null}
              </div>
            </div>
            <div className="w-[120px]">
              <div className="text-[14px] font-medium leading-5 text-vx-text-1">{plan.name}</div>
              <div className="vx-meta text-vx-text-3">{formatBytes(plan.storageBytes)}</div>
            </div>
            <div className="w-[180px]">
              <div className={cx('vx-meta-row', level === 'red' ? 'text-vx-danger' : level === 'amber' ? 'text-vx-warn' : 'text-vx-text-2')}>
                {formatBytes(r.usedBytes)} <span className="text-vx-text-3">of {formatBytes(r.quotaBytes)}</span>
              </div>
              <Meter className="mt-1.5" value={r.quotaBytes > 0 ? r.usedBytes / r.quotaBytes : 1} level={level} height={4} />
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => void answer(r, 'dismiss')} loading={busy === `${r.id}:dismiss`} disabled={!!busy}>
                Dismiss
              </Button>
              <Button size="sm" variant="primary" onClick={() => void answer(r, 'grant')} loading={busy === `${r.id}:grant`} disabled={!!busy}>
                Grant {formatBytes(plan.storageBytes)}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default StorageRequests;

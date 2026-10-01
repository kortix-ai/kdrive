'use client';

import { useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import { AUDIT_KINDS, type AuditListResponse } from '@volumes/shared';
import { ChevronDown } from 'lucide-react';
import { AuditRows, auditTh, nextBefore } from '@/components/settings/activity-section';
import { auditLabel } from '@/components/settings/audit-labels';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { api } from '@/lib/api/endpoints';
import { sessionBound } from '@/lib/api/swr';

const PAGE = 100;

/** Server-wide audit log: time, actor, event, target, detail; filter by kind; paged by id. */
export function AuditTable() {
  const [kind, setKind] = useState<string>('');
  const { data, error, size, setSize, isValidating, mutate } = useSWRInfinite<AuditListResponse>(
    (i, prev: AuditListResponse | null) => {
      if (i === 0) return ['admin-audit', kind, null];
      const before = nextBefore(prev);
      return before ? ['admin-audit', kind, before] : null;
    },
    sessionBound((key: [string, string, number | null]) => api.admin.audit({ kind: key[1] || undefined, before: key[2], limit: PAGE })),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const events = data?.flatMap((p) => p.events) ?? [];
  const more = !!data && !!nextBefore(data[data.length - 1] ?? null);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 pt-3">
        <label htmlFor="audit-kind" className="text-[13px] font-medium leading-5 text-vx-text-2">
          Event
        </label>
        <div className="relative">
          <select
            id="audit-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="vx-inset-focus h-8 appearance-none rounded-vx-sm border border-vx-hair-strong bg-vx-field pl-3 pr-9 text-[14px] text-vx-text-1 outline-none transition-colors duration-[120ms] hover:border-vx-outline"
          >
            <option value="">All events</option>
            {AUDIT_KINDS.map((k) => (
              <option key={k} value={k}>
                {auditLabel(k)}
              </option>
            ))}
          </select>
          <ChevronDown size={14} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-vx-text-3" />
        </div>
        <span className="flex-1" />
        {data ? <span className="vx-meta text-vx-text-3">{events.length} shown</span> : null}
      </div>
      {error && !data ? (
        <div className="flex items-center gap-2 rounded-vx-sm bg-vx-danger-wash px-4 py-3">
          <span className="text-[13px] text-vx-danger">Couldn&apos;t load the audit log.</span>
          <Button size="sm" variant="text" onClick={() => void mutate()}>
            Retry
          </Button>
        </div>
      ) : !data ? (
        <div className="px-1 py-2">
          <span className="skeleton skel-line w-full" />
          <span className="skeleton skel-line w-5/6" />
          <span className="skeleton skel-line w-4/6" />
        </div>
      ) : events.length === 0 ? (
        <EmptyState art={false} className="py-10" title={`No events${kind ? ` of type “${auditLabel(kind)}”` : ''} yet.`} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="[&>th]:border-y [&>th]:border-vx-hair [&>th]:bg-vx-bg-2 [&>th:first-child]:pl-3">
                <th className={auditTh}>Time</th>
                <th className={auditTh}>Actor</th>
                <th className={auditTh}>Event</th>
                <th className={auditTh}>Target</th>
                <th className={auditTh}>Detail</th>
              </tr>
            </thead>
            <tbody className="[&_td:first-child]:pl-3 [&_td]:border-b [&_td]:border-vx-hair-soft">
              <AuditRows events={events} showActor />
            </tbody>
          </table>
        </div>
      )}
      {more ? (
        <Button size="sm" variant="outline" className="mt-4" loading={isValidating && size > (data?.length ?? 0)} onClick={() => void setSize(size + 1)}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}

export default AuditTable;

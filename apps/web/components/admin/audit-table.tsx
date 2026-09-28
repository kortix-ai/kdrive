'use client';

import { useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import { AUDIT_KINDS, type AuditListResponse } from '@volumes/shared';
import { AuditRows, nextBefore } from '@/components/settings/activity-section';
import { auditLabel } from '@/components/settings/audit-labels';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/endpoints';

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
    (key: [string, string, number | null]) => api.admin.audit({ kind: key[1] || undefined, before: key[2], limit: PAGE }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const events = data?.flatMap((p) => p.events) ?? [];
  const more = !!data && !!nextBefore(data[data.length - 1] ?? null);

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <label htmlFor="audit-kind" className="vx-label">
          Event
        </label>
        <select
          id="audit-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="h-8 border border-vx-hair bg-vx-surface-2 px-2 font-mono text-[12px] text-vx-text-1 outline-none focus:border-vx-hair-strong"
        >
          <option value="">All events</option>
          {AUDIT_KINDS.map((k) => (
            <option key={k} value={k}>
              {auditLabel(k)}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        {data ? <span className="vx-meta text-vx-text-4">{events.length} shown</span> : null}
      </div>
      {error && !data ? (
        <div className="flex items-center gap-2 border border-vx-hair p-4">
          <span className="text-[12px] text-vx-danger">Couldn&apos;t load the audit log.</span>
          <Button size="sm" variant="ghost" onClick={() => void mutate()}>
            Retry
          </Button>
        </div>
      ) : !data ? (
        <div className="border border-vx-hair p-4">
          <span className="skeleton skel-line w-full" />
          <span className="skeleton skel-line w-5/6" />
          <span className="skeleton skel-line w-4/6" />
        </div>
      ) : events.length === 0 ? (
        <p className="vx-body border border-vx-hair p-6 text-center text-vx-text-3">No events{kind ? ` of type “${auditLabel(kind)}”` : ''} yet.</p>
      ) : (
        <div className="overflow-x-auto border border-vx-hair">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className="bg-vx-surface-2">
              <tr className="border-b border-vx-hair">
                <th className="vx-label h-8 pl-3 pr-3 font-medium">Time</th>
                <th className="vx-label h-8 pr-3 font-medium">Actor</th>
                <th className="vx-label h-8 pr-3 font-medium">Event</th>
                <th className="vx-label h-8 pr-3 font-medium">Target</th>
                <th className="vx-label h-8 pr-3 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="[&_td:first-child]:pl-3">
              <AuditRows events={events} showActor />
            </tbody>
          </table>
        </div>
      )}
      {more ? (
        <Button size="sm" variant="ghost" className="mt-3" loading={isValidating && size > (data?.length ?? 0)} onClick={() => void setSize(size + 1)}>
          Show older
        </Button>
      ) : null}
    </div>
  );
}

export default AuditTable;

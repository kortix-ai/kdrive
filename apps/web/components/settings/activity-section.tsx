'use client';

import useSWRInfinite from 'swr/infinite';
import type { AuditEvent, AuditListResponse } from '@volumes/shared';
import { Badge } from '@/components/share/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/endpoints';
import { formatRelative, isoTitle } from '@/lib/format';
import { auditDetail, auditLabel, auditTone } from './audit-labels';
import { Section } from './section';

const PAGE = 25;

/** Cursor for the next audit page (the API pages by numeric event id). */
export function nextBefore(prev: AuditListResponse | null): number | null {
  if (!prev?.nextCursor) return null;
  const n = Number(prev.nextCursor);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function AuditRows({ events, showActor }: { events: AuditEvent[]; showActor?: boolean }) {
  return (
    <>
      {events.map((e) => (
        <tr key={e.id} className="h-9 border-b border-vx-hair-soft last:border-b-0 hover:bg-vx-surface-2">
          <td className="vx-meta whitespace-nowrap py-1.5 pr-3 text-vx-text-3" title={isoTitle(e.createdAt)}>
            {formatRelative(e.createdAt)}
          </td>
          {showActor ? <td className="vx-meta max-w-[200px] truncate py-1.5 pr-3 text-vx-text-2">{e.actorEmail ?? '—'}</td> : null}
          <td className="py-1.5 pr-3">
            <Badge tone={auditTone(e.kind)} title={e.kind}>
              {auditLabel(e.kind)}
            </Badge>
          </td>
          <td className="vx-meta max-w-[220px] truncate py-1.5 pr-3 text-vx-text-2" title={e.target ?? undefined}>
            {e.target ?? '—'}
          </td>
          <td className="vx-meta max-w-[260px] truncate py-1.5 text-vx-text-4" title={auditDetail(e.meta)}>
            {auditDetail(e.meta)}
          </td>
        </tr>
      ))}
    </>
  );
}

/** ACTIVITY: the signed-in user's audit events (`/api/me/audit`), paged. */
export function ActivitySection() {
  const { data, error, size, setSize, isValidating, mutate } = useSWRInfinite<AuditListResponse>(
    (i, prev: AuditListResponse | null) => {
      if (i === 0) return ['me-audit', null];
      const before = nextBefore(prev);
      return before ? ['me-audit', before] : null;
    },
    (key: [string, number | null]) => api.me.audit({ before: key[1], limit: PAGE }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const events = data?.flatMap((p) => p.events) ?? [];
  const more = !!data && !!nextBefore(data[data.length - 1] ?? null);
  const loadingMore = isValidating && size > (data?.length ?? 0);

  return (
    <Section id="activity" label="Activity">
      {error && !data ? (
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-vx-danger">Couldn&apos;t load activity.</span>
          <Button size="sm" variant="ghost" onClick={() => void mutate()}>
            Retry
          </Button>
        </div>
      ) : !data ? (
        <div>
          <span className="skeleton skel-line w-full" />
          <span className="skeleton skel-line w-5/6" />
          <span className="skeleton skel-line w-4/6" />
        </div>
      ) : events.length === 0 ? (
        <p className="vx-body text-vx-text-3">No activity yet. Sign-ins, restores, checkpoints and links show up here.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-vx-hair">
                  <th className="vx-label py-1.5 pr-3 font-medium">Time</th>
                  <th className="vx-label py-1.5 pr-3 font-medium">Event</th>
                  <th className="vx-label py-1.5 pr-3 font-medium">Target</th>
                  <th className="vx-label py-1.5 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                <AuditRows events={events} />
              </tbody>
            </table>
          </div>
          {more ? (
            <Button size="sm" variant="ghost" className="mt-3" loading={loadingMore} onClick={() => void setSize(size + 1)}>
              Show older
            </Button>
          ) : null}
        </>
      )}
    </Section>
  );
}

export default ActivitySection;

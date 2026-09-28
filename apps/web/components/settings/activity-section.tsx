'use client';

import useSWRInfinite from 'swr/infinite';
import type { AuditEvent, AuditListResponse } from '@volumes/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/endpoints';
import { formatWhen } from '@/components/preview/names';
import { isoTitle } from '@/lib/format';
import { auditDetail, auditLabel, auditTone } from './audit-labels';
import { Section, SectionError } from './section';

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
        <tr key={e.id} className="h-11 border-b border-vx-hair-soft transition-colors duration-[120ms] last:border-b-0 hover:bg-vx-hover">
          <td className="vx-meta-row whitespace-nowrap py-2 pl-3 pr-3 text-vx-text-3" title={isoTitle(e.createdAt)}>
            {formatWhen(e.createdAt)}
          </td>
          {showActor ? <td className="vx-meta-row max-w-[200px] truncate py-2 pr-3 text-vx-text-2">{e.actorEmail ?? '—'}</td> : null}
          <td className="py-2 pr-3">
            <Badge tone={auditTone(e.kind)} title={e.kind}>
              {auditLabel(e.kind)}
            </Badge>
          </td>
          <td className="vx-meta-row max-w-[220px] truncate py-2 pr-3 text-vx-text-1" title={e.target ?? undefined}>
            {e.target ?? '—'}
          </td>
          <td className="vx-meta-row max-w-[260px] truncate py-2 pr-3 text-vx-text-3" title={auditDetail(e.meta)}>
            {auditDetail(e.meta)}
          </td>
        </tr>
      ))}
    </>
  );
}

/** Column header cell for the audit tables (13/500 text-3). */
export const auditTh = 'h-10 pr-3 text-left text-[13px] font-medium leading-5 text-vx-text-3 first:pl-3';

/** Activity: the signed-in user's audit events (`/api/me/audit`), paged. */
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
    <Section id="activity" label="Activity" description="Sign-ins, restores, checkpoints and links on your account.">
      {error && !data ? (
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-vx-del-fg">Couldn&apos;t load activity.</span>
          <Button size="sm" variant="text" onClick={() => void mutate()}>
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
          <div className="-mx-3 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left">
              <thead>
                <tr className="border-b border-vx-hair">
                  <th className={auditTh}>Time</th>
                  <th className={auditTh}>Event</th>
                  <th className={auditTh}>Target</th>
                  <th className={auditTh}>Detail</th>
                </tr>
              </thead>
              <tbody>
                <AuditRows events={events} />
              </tbody>
            </table>
          </div>
          {more ? (
            <Button size="sm" variant="outline" className="mt-4" loading={loadingMore} onClick={() => void setSize(size + 1)}>
              Load more
            </Button>
          ) : null}
        </>
      )}
    </Section>
  );
}

export default ActivitySection;

'use client';

// Admin → Audit: every user's events, newest first, paged by id. Filters: a person or target search,
// event kinds (a menu of families and kinds; the picks show as chips), a time window, one person and
// one drive (set from a row or from a user's detail). Export downloads the current filter as CSV.
// A row expands to its full meta JSON and ids.
import { Fragment, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { ChevronDown, ChevronRight, Download, ListFilter, Search, X } from 'lucide-react';
import type { AdminAuditEvent, AdminAuditListResponse } from '@volumes/shared';
import { formatWhen } from '@/components/preview/names';
import { auditDetail, auditLabel, AUDIT_GROUPS, auditTone } from '@/components/settings/audit-labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonClass } from '@/components/ui/button-class';
import { Chip } from '@/components/ui/chip';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { Segmented } from '@/components/ui/segmented';
import { api, type AdminAuditParams } from '@/lib/api/endpoints';
import { sessionBound } from '@/lib/api/swr';
import { isoTitle } from '@/lib/format';
import { AUDIT_RANGES, rangeFrom, type AdminRoute, type AuditRange } from './admin-route';
import { LoadError, Loading } from './parts';

const PAGE = 100;

type AuditFilter = AdminRoute['audit'];

/** The cursor for the next page (events are paged by numeric id). */
function nextBefore(prev: AdminAuditListResponse | null): number | null {
  if (!prev?.nextCursor) return null;
  const n = Number(prev.nextCursor);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Toggles one kind, or a whole family (all on → all off, else all on). */
export function toggleKinds(current: string[], kinds: string[]): string[] {
  const set = new Set(current);
  const allOn = kinds.every((k) => set.has(k));
  for (const k of kinds) {
    if (allOn) set.delete(k);
    else set.add(k);
  }
  return [...set];
}

/** The chips for the picked kinds: a family picked whole is one chip, the rest one chip per kind. */
export function kindChips(kinds: string[]): { label: string; kinds: string[] }[] {
  const left = new Set(kinds);
  const out: { label: string; kinds: string[] }[] = [];
  for (const g of AUDIT_GROUPS) {
    if (g.kinds.length > 1 && g.kinds.every((k) => left.has(k))) {
      out.push({ label: g.label, kinds: g.kinds });
      for (const k of g.kinds) left.delete(k);
    }
  }
  for (const k of kinds) if (left.has(k)) out.push({ label: auditLabel(k), kinds: [k] });
  return out;
}

/** The API filters for a panel filter (`from` fixed when the filter was set, so pages line up). */
export function auditParams(f: AuditFilter, from: string | undefined): AdminAuditParams {
  return {
    q: f.q || undefined,
    userId: f.userId ?? undefined,
    kind: f.kinds.length ? f.kinds : undefined,
    workspaceId: f.workspaceId ?? undefined,
    from,
  };
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const RANGE_LABEL: Record<AuditRange, string> = { '24h': '24 h', '7d': '7 days', '30d': '30 days', all: 'All time' };

export function AuditTable({ filter, onFilter }: { filter: AuditFilter; onFilter: (f: AuditFilter) => void }) {
  const [q, setQ] = useState(filter.q);
  const debounced = useDebounced(q.trim(), 300);
  useEffect(() => {
    if (debounced !== filter.q) onFilter({ ...filter, q: debounced });
    // Only the typed text drives this; the other filters are already in `filter`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => setQ(filter.q), [filter.q]);

  // `from` is fixed when the window is picked, so "Load more" continues the same list.
  const from = useMemo(() => rangeFrom(filter.range), [filter.range]);
  const params = auditParams(filter, from);
  const keyBase = JSON.stringify(params);
  const { data, error, size, setSize, isValidating, mutate } = useSWRInfinite<AdminAuditListResponse>(
    (i, prev: AdminAuditListResponse | null) => {
      if (i === 0) return ['admin-audit', keyBase, null];
      const before = nextBefore(prev);
      return before ? ['admin-audit', keyBase, before] : null;
    },
    sessionBound((key: [string, string, number | null]) => api.admin.audit({ ...(JSON.parse(key[1]) as AdminAuditParams), before: key[2], limit: PAGE })),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const events = data?.flatMap((p) => p.events) ?? [];
  const more = !!data && !!nextBefore(data[data.length - 1] ?? null);
  const [open, setOpen] = useState<Set<number>>(new Set());

  // Labels for the person and drive chips.
  const { data: person } = useSWR(filter.userId ? ['admin-user', filter.userId] : null, () => api.admin.user(filter.userId!), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const driveName = filter.workspaceId ? (events.find((e) => e.workspaceId === filter.workspaceId)?.workspaceName ?? null) : null;

  const kindItems: MenuItem[] = [
    { id: 'all', label: 'All events', checked: filter.kinds.length === 0, onSelect: () => onFilter({ ...filter, kinds: [] }) },
    ...AUDIT_GROUPS.flatMap<MenuItem>((g) => [
      { type: 'separator', id: `sep-${g.id}` },
      {
        id: `group-${g.id}`,
        label: <span className="font-medium">{g.label}</span>,
        hint: `${g.kinds.length} kinds`,
        checked: g.kinds.every((k) => filter.kinds.includes(k)),
        onSelect: () => onFilter({ ...filter, kinds: toggleKinds(filter.kinds, g.kinds) }),
      },
      ...g.kinds.map<MenuItem>((k) => ({
        id: k,
        label: <span className="pl-3">{auditLabel(k)}</span>,
        checked: filter.kinds.includes(k),
        onSelect: () => onFilter({ ...filter, kinds: toggleKinds(filter.kinds, [k]) }),
      })),
    ]),
  ];

  const toggleRow = (id: number) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const hasChips = filter.kinds.length > 0 || !!filter.userId || !!filter.workspaceId;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 pt-4">
        <div className="w-full max-w-[300px] max-[720px]:max-w-none">
          <Input
            size="sm"
            leading={<Search size={16} strokeWidth={1.75} />}
            placeholder="Search email or target"
            aria-label="Search the audit log"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Menu
          minWidth={280}
          items={kindItems}
          trigger={(p) => (
            <Button
              {...p}
              size="sm"
              variant="outline"
              icon={<ListFilter size={14} strokeWidth={1.75} aria-hidden />}
              trailing={<ChevronDown size={14} strokeWidth={1.75} aria-hidden />}
            >
              {filter.kinds.length ? `${filter.kinds.length} ${filter.kinds.length === 1 ? 'event' : 'events'}` : 'All events'}
            </Button>
          )}
        />
        <Segmented<AuditRange>
          size="sm"
          label="Time window"
          value={filter.range}
          onChange={(range) => onFilter({ ...filter, range })}
          options={AUDIT_RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }))}
        />
        <span className="flex-1" />
        {data ? <span className="vx-meta text-vx-text-3">{events.length}{more ? '+' : ''} shown</span> : null}
        <a href={api.admin.auditCsvUrl(params)} download className={buttonClass('outline', 'sm', { withIcon: true })}>
          <Download size={14} strokeWidth={1.75} aria-hidden />
          Export CSV
        </a>
      </div>

      {hasChips ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {filter.userId ? (
            <Chip size="sm" on onClick={() => onFilter({ ...filter, userId: null })} title="Remove this filter">
              Person: {person?.user.email ?? '…'}
              <X size={12} strokeWidth={2} aria-hidden />
            </Chip>
          ) : null}
          {filter.workspaceId ? (
            <Chip size="sm" on onClick={() => onFilter({ ...filter, workspaceId: null })} title="Remove this filter">
              Drive: {driveName ?? filter.workspaceId.slice(-6)}
              <X size={12} strokeWidth={2} aria-hidden />
            </Chip>
          ) : null}
          {kindChips(filter.kinds).map((c) => (
            <Chip key={c.kinds.join()} size="sm" on onClick={() => onFilter({ ...filter, kinds: filter.kinds.filter((x) => !c.kinds.includes(x)) })} title="Remove this filter">
              {c.label}
              <X size={12} strokeWidth={2} aria-hidden />
            </Chip>
          ))}
          <Button size="xs" variant="text" onClick={() => onFilter({ ...filter, kinds: [], userId: null, workspaceId: null })}>
            Clear
          </Button>
        </div>
      ) : null}

      <div className="mt-3">
        {error && !data ? (
          <LoadError what="the audit log" onRetry={() => void mutate()} />
        ) : !data ? (
          <Loading lines={[100, 85, 70]} />
        ) : events.length === 0 ? (
          <EmptyState art={false} className="py-10" title="No events match these filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-separate border-spacing-0 text-left">
              <thead>
                <tr className="[&>th]:border-y [&>th]:border-vx-hair [&>th]:bg-vx-bg-2">
                  <th className="w-8 pl-2" aria-label="Details" />
                  <th className={auditTh}>Time</th>
                  <th className={auditTh}>Actor</th>
                  <th className={auditTh}>Event</th>
                  <th className={auditTh}>Target</th>
                  <th className={auditTh}>Drive</th>
                  <th className={auditTh}>IP</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <AuditRow
                    key={e.id}
                    e={e}
                    open={open.has(e.id)}
                    onToggle={() => toggleRow(e.id)}
                    onUser={(userId) => onFilter({ ...filter, userId })}
                    onDrive={(workspaceId) => onFilter({ ...filter, workspaceId })}
                  />
                ))}
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
    </div>
  );
}

const auditTh = 'vx-colhead h-9 pr-3 text-left font-medium';
const cell = 'border-b border-vx-hair-soft py-2 pr-3';

function AuditRow({
  e,
  open,
  onToggle,
  onUser,
  onDrive,
}: {
  e: AdminAuditEvent;
  open: boolean;
  onToggle: () => void;
  onUser: (id: string) => void;
  onDrive: (id: string) => void;
}) {
  // The detail line often repeats the target (a plan, a drive name): show it only when it adds something.
  const raw = auditDetail(e.meta);
  const detail = raw && !(e.target ?? '').toLowerCase().includes(raw.toLowerCase()) ? raw : '';
  return (
    <Fragment>
      <tr className={cx('cursor-pointer transition-colors duration-[120ms] hover:bg-vx-raise', open && 'bg-vx-raise')} onClick={onToggle}>
        <td className={cx(cell, 'pl-2 pr-1')}>
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? 'Hide details' : 'Show details'}
            onClick={(ev) => {
              ev.stopPropagation();
              onToggle();
            }}
            className="inline-flex h-6 w-6 items-center justify-center rounded-vx-xs text-vx-text-3 hover:text-vx-text-1"
          >
            <ChevronRight size={14} strokeWidth={1.75} className={cx('transition-transform duration-[120ms]', open && 'rotate-90')} />
          </button>
        </td>
        <td className={cx(cell, 'vx-meta-row whitespace-nowrap text-vx-text-3')} title={isoTitle(e.createdAt)}>
          {formatWhen(e.createdAt)}
        </td>
        <td className={cx(cell, 'vx-meta-row max-w-[220px] truncate')}>
          {e.userId ? (
            <button
              type="button"
              title="Only this person"
              onClick={(ev) => {
                ev.stopPropagation();
                onUser(e.userId!);
              }}
              className="max-w-full truncate rounded-vx-xs text-vx-text-2 hover:text-vx-text-1 hover:underline hover:underline-offset-[3px]"
            >
              {e.actorEmail ?? e.userId}
            </button>
          ) : (
            <span className="text-vx-text-3">{e.actorEmail ?? '—'}</span>
          )}
        </td>
        <td className={cell}>
          <Badge tone={auditTone(e.kind)} title={e.kind}>
            {auditLabel(e.kind)}
          </Badge>
        </td>
        <td className={cx(cell, 'vx-meta-row max-w-[240px] truncate text-vx-text-1')} title={[e.target, detail].filter(Boolean).join(' · ') || undefined}>
          {e.target ?? '—'}
          {detail ? <span className="text-vx-text-3"> · {detail}</span> : null}
        </td>
        <td className={cx(cell, 'vx-meta-row max-w-[160px] truncate')}>
          {e.workspaceId ? (
            <button
              type="button"
              title="Only this drive"
              onClick={(ev) => {
                ev.stopPropagation();
                onDrive(e.workspaceId!);
              }}
              className="max-w-full truncate rounded-vx-xs text-vx-text-2 hover:text-vx-text-1 hover:underline hover:underline-offset-[3px]"
            >
              {e.workspaceName ?? e.workspaceId.slice(-6)}
            </button>
          ) : (
            <span className="text-vx-text-4">—</span>
          )}
        </td>
        <td className={cx(cell, 'vx-meta-row whitespace-nowrap text-vx-text-3')}>{e.ip ?? '—'}</td>
      </tr>
      {open ? (
        <tr>
          <td className="border-b border-vx-hair-soft" />
          <td colSpan={6} className="border-b border-vx-hair-soft py-3 pr-3">
            <dl className="vx-meta mb-2 flex flex-wrap gap-x-5 gap-y-1 text-vx-text-3">
              <div>
                <dt className="inline">event </dt>
                <dd className="inline text-vx-text-2">{e.id}</dd>
              </div>
              <div>
                <dt className="inline">kind </dt>
                <dd className="inline text-vx-text-2">{e.kind}</dd>
              </div>
              <div>
                <dt className="inline">time </dt>
                <dd className="inline text-vx-text-2">{e.createdAt}</dd>
              </div>
              {e.userId ? (
                <div>
                  <dt className="inline">user </dt>
                  <dd className="inline text-vx-text-2">{e.userId}</dd>
                </div>
              ) : null}
              {e.workspaceId ? (
                <div>
                  <dt className="inline">drive </dt>
                  <dd className="inline text-vx-text-2">{e.workspaceId}</dd>
                </div>
              ) : null}
            </dl>
            <pre className="vx-code max-h-72 overflow-auto rounded-vx-sm border border-vx-hair bg-vx-surface-2 p-3 font-mono text-vx-text-2">
              {JSON.stringify(e.meta ?? {}, null, 2)}
            </pre>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

export default AuditTable;

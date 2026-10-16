'use client';

// Where the admin panel is: the tab, the user whose detail is open and the audit filters, all in the
// query string (`/admin?tab=audit&userId=…`), so links from mail, the browser's back button and a
// reload land on the same view. History entries are pushed on tab and user changes; filters replace.
import { useCallback, useEffect, useState } from 'react';

export const ADMIN_TABS = ['overview', 'users', 'domains', 'requests', 'billing', 'audit', 'admins'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

/** The audit log's time window: a preset back from now. */
export const AUDIT_RANGES = ['24h', '7d', '30d', 'all'] as const;
export type AuditRange = (typeof AUDIT_RANGES)[number];

export interface AdminRoute {
  tab: AdminTab;
  /** Users → one user's detail. */
  user: string | null;
  audit: {
    q: string;
    userId: string | null;
    kinds: string[];
    workspaceId: string | null;
    range: AuditRange;
  };
}

export const EMPTY_AUDIT: AdminRoute['audit'] = { q: '', userId: null, kinds: [], workspaceId: null, range: 'all' };

export function parseAdminRoute(search: string): AdminRoute {
  const p = new URLSearchParams(search);
  const tab = p.get('tab');
  const range = p.get('range');
  const hasAudit = ['q', 'userId', 'kind', 'workspaceId', 'range'].some((k) => p.has(k));
  return {
    // A link with audit filters but no tab (from a user's detail) opens the audit log.
    tab: (ADMIN_TABS as readonly string[]).includes(tab ?? '') ? (tab as AdminTab) : p.get('user') ? 'users' : hasAudit ? 'audit' : 'overview',
    user: p.get('user') || null,
    audit: {
      q: p.get('q') ?? '',
      userId: p.get('userId') || null,
      kinds: p.getAll('kind').filter(Boolean),
      workspaceId: p.get('workspaceId') || null,
      range: (AUDIT_RANGES as readonly string[]).includes(range ?? '') ? (range as AuditRange) : 'all',
    },
  };
}

/** The query string for a route (defaults left out): `?tab=audit&kind=a&kind=b`. */
export function adminRouteSearch(r: AdminRoute): string {
  const p = new URLSearchParams();
  if (r.tab !== 'overview') p.set('tab', r.tab);
  if (r.tab === 'users' && r.user) p.set('user', r.user);
  if (r.tab === 'audit') {
    if (r.audit.q) p.set('q', r.audit.q);
    if (r.audit.userId) p.set('userId', r.audit.userId);
    for (const k of r.audit.kinds) p.append('kind', k);
    if (r.audit.workspaceId) p.set('workspaceId', r.audit.workspaceId);
    if (r.audit.range !== 'all') p.set('range', r.audit.range);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

const HOUR = 3_600_000;
const RANGE_MS: Record<Exclude<AuditRange, 'all'>, number> = { '24h': 24 * HOUR, '7d': 7 * 24 * HOUR, '30d': 30 * 24 * HOUR };

/** The `from` instant of a range (ISO), or undefined for all time. */
export function rangeFrom(range: AuditRange, now: number = Date.now()): string | undefined {
  return range === 'all' ? undefined : new Date(now - RANGE_MS[range]).toISOString();
}

/** The admin route in the URL, and a way to move. `push` adds a history entry (tabs, users); filters replace it. */
export function useAdminRoute(): [AdminRoute, (next: AdminRoute, mode?: 'push' | 'replace') => void] {
  const [route, setRoute] = useState<AdminRoute>(() =>
    typeof window === 'undefined' ? parseAdminRoute('') : parseAdminRoute(window.location.search),
  );
  useEffect(() => {
    const onPop = () => setRoute(parseAdminRoute(window.location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback((next: AdminRoute, mode: 'push' | 'replace' = 'push') => {
    const url = `${window.location.pathname}${adminRouteSearch(next)}`;
    if (url !== `${window.location.pathname}${window.location.search}`) {
      if (mode === 'push') window.history.pushState(window.history.state, '', url);
      else window.history.replaceState(window.history.state, '', url);
    }
    setRoute(next);
  }, []);
  return [route, go];
}

// Where the admin console is. Each section has its own path (/admin/users, /admin/logs …); one
// user's detail is /admin/users/<id>; the audit log keeps its filters in the query string
// (`/admin/logs?userId=…&kind=a&kind=b`), so links from mail, the browser's back button and a
// reload land on the same view. Old `/admin?tab=…` links are redirected (legacyAdminPath).

export const ADMIN_SECTIONS = [
  { id: 'overview', href: '/admin', label: 'Overview' },
  { id: 'users', href: '/admin/users', label: 'Users' },
  { id: 'drives', href: '/admin/drives', label: 'Drives' },
  { id: 'requests', href: '/admin/requests', label: 'Storage requests' },
  { id: 'billing', href: '/admin/billing', label: 'Billing' },
  { id: 'logs', href: '/admin/logs', label: 'Logs' },
  { id: 'admins', href: '/admin/admins', label: 'Admins' },
  { id: 'settings', href: '/admin/settings', label: 'Settings' },
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number]['id'];

/** The section a path belongs to (`/admin/users/u1` → users). */
export function sectionOf(pathname: string): AdminSection {
  const seg = pathname.replace(/^\/admin\/?/, '').split('/')[0];
  return (ADMIN_SECTIONS.find((s) => s.id === seg)?.id ?? 'overview') as AdminSection;
}

/** The audit log's time window: a preset back from now. */
export const AUDIT_RANGES = ['24h', '7d', '30d', 'all'] as const;
export type AuditRange = (typeof AUDIT_RANGES)[number];

export interface AuditFilter {
  q: string;
  userId: string | null;
  kinds: string[];
  workspaceId: string | null;
  range: AuditRange;
}

export const EMPTY_AUDIT: AuditFilter = { q: '', userId: null, kinds: [], workspaceId: null, range: 'all' };

export function parseAuditFilter(search: string): AuditFilter {
  const p = new URLSearchParams(search);
  const range = p.get('range');
  return {
    q: p.get('q') ?? '',
    userId: p.get('userId') || null,
    kinds: p.getAll('kind').filter(Boolean),
    workspaceId: p.get('workspaceId') || null,
    range: (AUDIT_RANGES as readonly string[]).includes(range ?? '') ? (range as AuditRange) : 'all',
  };
}

/** The query string for audit filters (defaults left out): `?kind=a&kind=b&range=7d`. */
export function auditFilterSearch(f: AuditFilter): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.userId) p.set('userId', f.userId);
  for (const k of f.kinds) p.append('kind', k);
  if (f.workspaceId) p.set('workspaceId', f.workspaceId);
  if (f.range !== 'all') p.set('range', f.range);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** The audit log with these filters. */
export function auditHref(f: Partial<AuditFilter>): string {
  return `/admin/logs${auditFilterSearch({ ...EMPTY_AUDIT, ...f })}`;
}

/**
 * Where an old `/admin?tab=…` link goes now, or null when it is not one. `?tab=domains` is the
 * Users section's "By domain" view; audit filters without a tab open the audit log.
 */
export function legacyAdminPath(search: string | URLSearchParams): string | null {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search;
  const tab = p.get('tab');
  const user = p.get('user');
  const hasAudit = ['q', 'userId', 'kind', 'workspaceId', 'range'].some((k) => p.has(k));
  if (!tab && !user && !hasAudit) return null;
  if (tab === 'audit' || (!tab && !user && hasAudit)) return auditHref(parseAuditFilter(p.toString()));
  if (tab === 'users' || (!tab && user)) return user ? `/admin/users/${encodeURIComponent(user)}` : '/admin/users';
  if (tab === 'domains') return '/admin/users?view=domains';
  if (tab === 'requests' || tab === 'billing' || tab === 'admins') return `/admin/${tab}`;
  return '/admin';
}

/** Days back each preset covers. */
const HOUR = 3_600_000;
const RANGE_MS: Record<Exclude<AuditRange, 'all'>, number> = { '24h': 24 * HOUR, '7d': 7 * 24 * HOUR, '30d': 30 * 24 * HOUR };

/** The `from` instant of a range (ISO), or undefined for all time. */
export function rangeFrom(range: AuditRange, now: number = Date.now()): string | undefined {
  return range === 'all' ? undefined : new Date(now - RANGE_MS[range]).toISOString();
}

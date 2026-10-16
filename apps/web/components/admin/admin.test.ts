import { describe, expect, test } from 'bun:test';
import { AUDIT_KINDS, GiB } from '@volumes/shared';
import { auditLabel, AUDIT_GROUPS } from '@/components/settings/audit-labels';
import { adminRouteSearch, EMPTY_AUDIT, parseAdminRoute, rangeFrom } from './admin-route';
import { looksLikeEmail } from './admins';
import { parsePrice, priceInput } from './billing';
import { auditParams, kindChips, toggleKinds } from './audit-table';
import { MAX_QUOTA_GIB, parseGiB, toGiBInput } from './quota-editor';
import { subscriptionLabel } from './storage-requests';
import { nextSort, usagePercent } from './users-table';

describe('quota editor', () => {
  test('parseGiB accepts 0 < x ≤ 1024 (1 TB, the Pro plan)', () => {
    expect(MAX_QUOTA_GIB).toBe(1024);
    expect(parseGiB('10')).toEqual({ bytes: 10 * GiB, error: null });
    expect(parseGiB(' 12.5 ')).toEqual({ bytes: Math.round(12.5 * GiB), error: null });
    expect(parseGiB('50').bytes).toBe(50 * GiB);
    expect(parseGiB('1024').bytes).toBe(1024 * GiB);
    expect(parseGiB('1024.01').error).toBe('Max 1 TB');
    expect(parseGiB('0').error).toBeTruthy();
    expect(parseGiB('-3').error).toBeTruthy();
    expect(parseGiB('abc').error).toBeTruthy();
    expect(parseGiB('').error).toBeTruthy();
  });

  test('toGiBInput', () => {
    expect(toGiBInput(10 * GiB)).toBe('10');
    expect(toGiBInput(12.5 * GiB)).toBe('12.5');
    expect(toGiBInput(Math.round(1.333 * GiB))).toBe('1.33');
  });
});

describe('users table', () => {
  test('a new column starts descending (email ascending); the same column flips', () => {
    expect(nextSort({ key: 'used', dir: 'desc' }, 'used')).toEqual({ key: 'used', dir: 'asc' });
    expect(nextSort({ key: 'used', dir: 'asc' }, 'quota')).toEqual({ key: 'quota', dir: 'desc' });
    expect(nextSort({ key: 'used', dir: 'desc' }, 'email')).toEqual({ key: 'email', dir: 'asc' });
  });

  test('usagePercent', () => {
    expect(usagePercent(0, 10 * GiB)).toBe('0%');
    expect(usagePercent(1, 10 * GiB)).toBe('<1%');
    expect(usagePercent(5 * GiB, 10 * GiB)).toBe('50%');
    expect(usagePercent(12 * GiB, 10 * GiB)).toBe('120%');
    expect(usagePercent(1, 0)).toBe('100%');
  });
});

describe('admin route', () => {
  test('tab, user and audit filters round-trip through the query string', () => {
    const r = parseAdminRoute('?tab=audit&q=ada&kind=link.create&kind=link.revoke&workspaceId=w1&range=7d');
    expect(r).toEqual({
      tab: 'audit',
      user: null,
      audit: { q: 'ada', userId: null, kinds: ['link.create', 'link.revoke'], workspaceId: 'w1', range: '7d' },
    });
    expect(parseAdminRoute(adminRouteSearch(r))).toEqual(r);
    expect(adminRouteSearch({ ...r, tab: 'overview' })).toBe('');
    expect(adminRouteSearch({ tab: 'users', user: 'u1', audit: EMPTY_AUDIT })).toBe('?tab=users&user=u1');
  });

  test('old and partial links land somewhere sensible', () => {
    expect(parseAdminRoute('').tab).toBe('overview');
    expect(parseAdminRoute('?tab=requests').tab).toBe('requests');
    expect(parseAdminRoute('?tab=nope').tab).toBe('overview');
    expect(parseAdminRoute('?user=u1').tab).toBe('users');
    expect(parseAdminRoute('?userId=u1')).toMatchObject({ tab: 'audit', audit: { userId: 'u1' } });
    expect(parseAdminRoute('?tab=audit&range=1y').audit.range).toBe('all');
  });

  test('rangeFrom', () => {
    const now = Date.parse('2026-10-13T12:00:00Z');
    expect(rangeFrom('all', now)).toBeUndefined();
    expect(rangeFrom('24h', now)).toBe('2026-10-12T12:00:00.000Z');
    expect(rangeFrom('7d', now)).toBe('2026-10-06T12:00:00.000Z');
    expect(rangeFrom('30d', now)).toBe('2026-09-13T12:00:00.000Z');
  });
});

describe('audit filters', () => {
  test('toggleKinds: one kind, or a whole family on and off', () => {
    expect(toggleKinds([], ['a'])).toEqual(['a']);
    expect(toggleKinds(['a'], ['a'])).toEqual([]);
    expect(toggleKinds(['a'], ['a', 'b']).sort()).toEqual(['a', 'b']);
    expect(toggleKinds(['a', 'b', 'c'], ['a', 'b'])).toEqual(['c']);
  });

  test('kindChips: a whole family is one chip', () => {
    const drives = AUDIT_GROUPS.find((g) => g.id === 'drives')!.kinds;
    expect(kindChips([...drives, 'undo'])).toEqual([
      { label: 'Drives and sharing', kinds: drives },
      { label: 'Undone', kinds: ['undo'] },
    ]);
    expect(kindChips(['workspace.create'])).toEqual([{ label: 'Drive created', kinds: ['workspace.create'] }]);
  });

  test('every audit kind is in exactly one family, and every kind has a label', () => {
    const all = AUDIT_GROUPS.flatMap((g) => g.kinds);
    expect(all.sort()).toEqual([...AUDIT_KINDS].sort());
    for (const k of AUDIT_KINDS) expect(auditLabel(k)).not.toBe(k);
  });

  test('params leave empty filters out and keep the fixed `from`', () => {
    expect(auditParams(EMPTY_AUDIT, undefined)).toEqual({ q: undefined, userId: undefined, kind: undefined, workspaceId: undefined, from: undefined });
    expect(auditParams({ ...EMPTY_AUDIT, q: 'x', kinds: ['undo'], userId: 'u' }, '2026-01-01T00:00:00.000Z')).toMatchObject({
      q: 'x',
      kind: ['undo'],
      userId: 'u',
      from: '2026-01-01T00:00:00.000Z',
    });
  });

  test('looksLikeEmail', () => {
    expect(looksLikeEmail('ada@kortix.ai')).toBe(true);
    expect(looksLikeEmail(' ada@kortix.ai ')).toBe(true);
    expect(looksLikeEmail('ada@kortix')).toBe(false);
    expect(looksLikeEmail('ada')).toBe(false);
  });
});

describe('subscription badge', () => {
  const sub = { plan: 'plus' as const, status: 'active', entitled: true, currentPeriodEnd: '2026-11-02T00:00:00.000Z', cancelAtPeriodEnd: false };
  test('plan and status, or the end date once cancelled', () => {
    expect(subscriptionLabel(null)).toBeNull();
    expect(subscriptionLabel(sub)).toBe('Plus · active');
    expect(subscriptionLabel({ ...sub, status: 'past_due' })).toBe('Plus · past due');
    expect(subscriptionLabel({ ...sub, cancelAtPeriodEnd: true })).toBe('Plus · ends 2 Nov');
    expect(subscriptionLabel({ ...sub, plan: 'pro', status: 'canceled', entitled: false })).toBe('Pro · canceled');
  });
});

describe('billing', () => {
  test('the Billing tab has its own URL', () => {
    expect(parseAdminRoute('?tab=billing').tab).toBe('billing');
    expect(adminRouteSearch({ ...parseAdminRoute(''), tab: 'billing' })).toBe('?tab=billing');
  });

  test('parsePrice: a monthly amount, at least 0.50, decimals by currency', () => {
    expect(parsePrice('9', 'USD')).toEqual({ amount: 9, error: null });
    expect(parsePrice(' 9.50 ', 'EUR')).toEqual({ amount: 9.5, error: null });
    expect(parsePrice('1,200', 'JPY')).toEqual({ amount: 1200, error: null });
    expect(parsePrice('9.5', 'JPY').error).toBe('JPY has no decimals.');
    expect(parsePrice('9.999', 'USD').error).toBe('At most 2 decimals.');
    expect(parsePrice('0.2', 'USD').error).toBe('At least 0.50.');
    expect(parsePrice('-3', 'USD').error).toBeTruthy();
    expect(parsePrice('abc', 'USD').error).toBeTruthy();
    expect(parsePrice('', 'USD').error).toBe('Enter a monthly price.');
    expect(parsePrice('200000', 'USD').error).toBe('At most 100,000.');
  });

  test('priceInput', () => {
    expect(priceInput(9, 'USD')).toBe('9');
    expect(priceInput(9.5, 'USD')).toBe('9.50');
    expect(priceInput(1200, 'JPY')).toBe('1200');
  });
});

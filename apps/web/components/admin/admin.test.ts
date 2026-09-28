import { describe, expect, test } from 'bun:test';
import { GiB, type AdminUser } from '@volumes/shared';
import { MAX_QUOTA_GIB, parseGiB, toGiBInput } from './quota-editor';
import { sortUsers } from './users-table';

describe('quota editor', () => {
  test('parseGiB accepts 0 < x ≤ 50', () => {
    expect(MAX_QUOTA_GIB).toBe(50);
    expect(parseGiB('10')).toEqual({ bytes: 10 * GiB, error: null });
    expect(parseGiB(' 12.5 ')).toEqual({ bytes: Math.round(12.5 * GiB), error: null });
    expect(parseGiB('50').bytes).toBe(50 * GiB);
    expect(parseGiB('50.01').error).toBe('Max 50 GB');
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
  const u = (id: string, used: number, created: string, last: string | null = null): AdminUser => ({
    id,
    email: `${id}@x.test`,
    name: null,
    createdAt: created,
    lastSignInAt: last,
    quotaBytes: 10 * GiB,
    usedBytes: used,
    workspaceCount: 1,
    isAdmin: false,
  });
  const users = [u('b', 5, '2026-01-02'), u('a', 9, '2026-01-01', '2026-09-01'), u('c', 1, '2026-01-03')];

  test('sorts by used desc, email asc, never-signed-in last when desc', () => {
    expect(sortUsers(users, 'used', -1).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(sortUsers(users, 'email', 1).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(sortUsers(users, 'created', -1).map((x) => x.id)).toEqual(['c', 'b', 'a']);
    expect(sortUsers(users, 'lastSignIn', -1)[0].id).toBe('a');
  });
});

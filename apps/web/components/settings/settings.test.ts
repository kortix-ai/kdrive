import { describe, expect, test } from 'bun:test';
import { GiB } from '@volumes/shared';
import { publicCrumbs } from '@/components/public/public-browser';
import { inactiveCopy } from '@/components/public/public-shell';
import { copyName } from '@/components/workspaces/duplicate-dialog';
import { workspaceNameError } from '@/components/workspaces/new-workspace-dialog';
import { provenance } from '@/components/workspaces/workspace-switcher';
import { ApiError } from '@/lib/api/client';
import { nextBefore } from './activity-section';
import { auditDetail, auditLabel, auditTone } from './audit-labels';
import { providerLabel } from './profile-section';
import { percent } from './storage-section';

describe('settings helpers', () => {
  test('audit labels and details', () => {
    expect(auditLabel('link.revoke')).toBe('Link revoked');
    expect(auditLabel('something.new')).toBe('something.new');
    expect(auditTone('account.delete')).toBe('danger');
    expect(auditTone('checkpoint.create')).toBe('accent');
    expect(auditDetail({ from: 10 * GiB, to: 20 * GiB })).toBe('10 GB → 20 GB');
    expect(auditDetail({ name: 'v1.0', at: 'vc_01J8ZQ3ABCDEF' })).toBe('v1.0 · @3abcdef');
    expect(auditDetail({ ip: '1.2.3.4' })).toBe('');
  });

  test('audit paging cursor', () => {
    expect(nextBefore(null)).toBeNull();
    expect(nextBefore({ events: [], nextCursor: null })).toBeNull();
    expect(nextBefore({ events: [], nextCursor: '42' })).toBe(42);
    expect(nextBefore({ events: [], nextCursor: 'x' })).toBeNull();
  });

  test('storage percent', () => {
    expect(percent(0, 10)).toBe(0);
    expect(percent(3.1, 10)).toBe(31);
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(5, 0)).toBe(100);
  });

  test('provider labels', () => {
    expect(providerLabel('corp')).toBe('Corp');
    expect(providerLabel('single-sign-on')).toBe('Single sign on');
    expect(providerLabel('credential')).toBe('Password');
    expect(providerLabel('dev-login')).toBe('Dev account');
  });
});

describe('workspace helpers', () => {
  test('names', () => {
    expect(workspaceNameError('')).toBeTruthy();
    expect(workspaceNameError('   ')).toBeTruthy();
    expect(workspaceNameError('x'.repeat(61))).toBeTruthy();
    expect(workspaceNameError(' Projects ')).toBeNull();
    expect(copyName('Personal')).toBe('Personal copy');
    expect(copyName('x'.repeat(60)).length).toBeLessThanOrEqual(60);
  });

  test('provenance', () => {
    expect(provenance({ forkedFrom: null })).toBeNull();
    expect(provenance({ forkedFrom: { workspaceId: 'w', workspaceName: 'Personal', commitId: 'vc_01J8ZQ3ABC' } })).toBe('Duplicated from Personal @8zq3abc');
    expect(provenance({ forkedFrom: { workspaceId: null, workspaceName: null, commitId: 'vc_01J8ZQ3ABC' } })).toContain('a deleted drive');
  });
});

describe('public page helpers', () => {
  test('crumbs are clamped to the link root', () => {
    expect(publicCrumbs('Photos', '/')).toEqual([{ label: 'Photos', rel: '/' }]);
    expect(publicCrumbs('Photos', '/2026/june')).toEqual([
      { label: 'Photos', rel: '/' },
      { label: '2026', rel: '/2026' },
      { label: 'june', rel: '/2026/june' },
    ]);
  });

  test('inactive link copy', () => {
    expect(inactiveCopy(new ApiError(410, 'link_expired', 'x')).title).toBe('This link has expired.');
    expect(inactiveCopy(new ApiError(410, 'link_revoked', 'x')).title).toBe('This link is no longer active.');
    expect(inactiveCopy(new ApiError(404, 'not_found', 'x')).title).toBe('This link is no longer active.');
    expect(inactiveCopy(new ApiError(429, 'rate_limited', 'x')).title).toBe('Too many opens. Try again in a minute.');
    expect(inactiveCopy(new Error('boom')).title).toBe("Couldn't open this link.");
  });
});

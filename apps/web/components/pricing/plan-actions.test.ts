import { describe, expect, test } from 'bun:test';
import { DEFAULT_QUOTA_BYTES, GiB, TiB, planById, type StorageRequest } from '@volumes/shared';
import { planAction, requestStatusText, SIGNUP_FOR_PLAN_HREF, type Viewer } from './plan-actions';

const free = planById('free');
const plus = planById('plus');
const pro = planById('pro');
const base: Viewer = { signedIn: true, billingEnabled: false, plan: 'free', quotaBytes: DEFAULT_QUOTA_BYTES, subscription: null, request: null };
const req = (over: Partial<StorageRequest>): StorageRequest => ({
  id: 'r1',
  plan: 'plus',
  note: null,
  status: 'open',
  createdAt: '2026-10-13T09:00:00.000Z',
  resolvedAt: null,
  ...over,
});

describe('plan card actions', () => {
  test('signed out: sign up, for the free plan straight to the drive', () => {
    const out = { ...base, signedIn: false };
    expect(planAction(free, out, '/signup?next=/drive')).toEqual({ kind: 'signup', label: 'Get started', href: '/signup?next=/drive' });
    expect(planAction(plus, out, '/x')).toEqual({ kind: 'signup', label: 'Sign up for Plus', href: SIGNUP_FOR_PLAN_HREF });
  });

  test('no billing: the current plan, then requests (marked once requested)', () => {
    expect(planAction(free, base, '')).toEqual({ kind: 'current', label: 'Current plan', manage: false });
    expect(planAction(plus, base, '')).toEqual({ kind: 'request', label: 'Request Plus', requested: false });
    const asked = { ...base, request: req({}) };
    expect(planAction(plus, asked, '')).toEqual({ kind: 'request', label: 'Requested Plus', requested: true });
    expect(planAction(pro, asked, '')).toEqual({ kind: 'request', label: 'Request Pro', requested: false });
  });

  test('a granted quota makes smaller plans included', () => {
    const big = { ...base, plan: 'pro' as const, quotaBytes: 1 * TiB };
    expect(planAction(free, big, '').kind).toBe('included');
    expect(planAction(plus, big, '').kind).toBe('included');
    expect(planAction(pro, big, '')).toMatchObject({ kind: 'current', manage: false });
    // 20 GB counts as Free, and Plus is still a step up.
    expect(planAction(plus, { ...base, quotaBytes: 20 * GiB }, '').kind).toBe('request');
  });

  test('billing on: checkout, then manage and change through the portal', () => {
    const on = { ...base, billingEnabled: true };
    expect(planAction(plus, on, '')).toEqual({ kind: 'checkout', label: 'Upgrade to Plus' });
    const sub = { plan: 'plus' as const, status: 'active', entitled: true, currentPeriodEnd: null, cancelAtPeriodEnd: false };
    const subscribed = { ...on, plan: 'plus' as const, quotaBytes: 100 * GiB, subscription: sub };
    expect(planAction(plus, subscribed, '')).toEqual({ kind: 'current', label: 'Current plan', manage: true });
    expect(planAction(pro, subscribed, '')).toEqual({ kind: 'portal', label: 'Change to Pro' });
    // An ended subscription goes back to Checkout.
    expect(planAction(pro, { ...on, subscription: { ...sub, status: 'canceled', entitled: false } }, '').kind).toBe('checkout');
  });

  test('request status lines', () => {
    expect(requestStatusText(null)).toBeNull();
    expect(requestStatusText(req({}))).toBe("Requested Plus on 13 Oct — we'll email you.");
    expect(requestStatusText(req({ status: 'granted', resolvedAt: '2026-10-14T09:00:00.000Z' }))).toBe('Your request for Plus was granted on 14 Oct.');
    expect(requestStatusText(req({ plan: 'pro', status: 'dismissed' }))).toBe('Your request for Pro on 13 Oct was not granted. You can ask again.');
  });
});

import { describe, expect, test } from 'bun:test';
import { DEFAULT_QUOTA_BYTES, GiB, MAX_QUOTA_BYTES, TiB } from './constants';
import {
  BILLING_CURRENCIES,
  currencyDecimals,
  formatPlanPrice,
  isPaidPlan,
  NO_PLAN_PRICES,
  PAID_PLAN_IDS,
  planById,
  planForQuota,
  PLANS,
  toMinorUnits,
  withPrices,
} from './plans';

describe('plans', () => {
  test('Free 10 GB, Plus 100 GB, Pro 1 TB, in that order, all within the quota cap', () => {
    expect(PLANS.map((p) => [p.id, p.storageBytes])).toEqual([
      ['free', DEFAULT_QUOTA_BYTES],
      ['plus', 100 * GiB],
      ['pro', 1 * TiB],
    ]);
    for (const p of PLANS) expect(p.storageBytes).toBeLessThanOrEqual(MAX_QUOTA_BYTES);
    expect(PAID_PLAN_IDS).toEqual(['plus', 'pro']);
    expect(isPaidPlan('plus')).toBe(true);
    expect(isPaidPlan('free')).toBe(false);
  });

  test('planForQuota: the largest plan the quota covers', () => {
    expect(planForQuota(DEFAULT_QUOTA_BYTES).id).toBe('free');
    expect(planForQuota(1).id).toBe('free');
    expect(planForQuota(20 * GiB).id).toBe('free');
    expect(planForQuota(100 * GiB).id).toBe('plus');
    expect(planForQuota(500 * GiB).id).toBe('plus');
    expect(planForQuota(1 * TiB).id).toBe('pro');
  });

  test('prices: undecided is null, zero is Free, otherwise a monthly amount', () => {
    expect(formatPlanPrice({ ...planById('plus'), price: null })).toBeNull();
    expect(formatPlanPrice(planById('free'))).toBe('Free');
    expect(formatPlanPrice({ ...planById('plus'), price: { amount: 9, currency: 'USD' } })).toBe('$9 / month');
    expect(formatPlanPrice({ ...planById('pro'), price: { amount: 19.5, currency: 'EUR' } })).toBe('€19.50 / month');
  });
});

describe('admin-set prices', () => {
  test('withPrices lays prices over the paid plans and leaves Free alone', () => {
    const plans = withPrices({ plus: { amount: 9, currency: 'USD' }, pro: null });
    expect(plans.map((p) => p.price)).toEqual([{ amount: 0, currency: 'USD' }, { amount: 9, currency: 'USD' }, null]);
    expect(withPrices(null).map((p) => p.price)).toEqual(PLANS.map((p) => p.price));
    expect(withPrices(NO_PLAN_PRICES)[1].price).toBeNull();
  });

  test('minor units follow the currency', () => {
    expect(toMinorUnits(9.5, 'USD')).toBe(950);
    expect(toMinorUnits(19.99, 'eur')).toBe(1999);
    expect(toMinorUnits(1200, 'JPY')).toBe(1200);
    expect(currencyDecimals('JPY')).toBe(0);
    expect(BILLING_CURRENCIES).toContain('USD');
  });
});

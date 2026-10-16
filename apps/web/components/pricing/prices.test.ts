import { describe, expect, test } from 'bun:test';
import { GiB, TiB, withPrices } from '@volumes/shared';
import { nextPlan } from '@/components/drive/quota-dialog';
import { priceText } from './pricing-plans';

const prices = { plus: { amount: 9, currency: 'USD' }, pro: { amount: 29.5, currency: 'EUR' } };

describe('admin-set prices on the pricing page and the quota dialog', () => {
  test('a card shows the admin price; without one, coming soon or at checkout; nothing while loading', () => {
    const [free, plus, pro] = withPrices({ plus: prices.plus, pro: null });
    expect(priceText(free, false)).toBe('Free');
    expect(priceText(plus, false)).toBe('$9 / month');
    expect(priceText(pro, false)).toBe('Price coming soon');
    expect(priceText(pro, true)).toBe('Price shown at checkout');
    expect(priceText(pro, false, false)).toBeNull();
  });

  test('nextPlan: the smallest paid plan that holds the upload, priced', () => {
    expect(nextPlan(10 * GiB, 12 * GiB, prices)).toMatchObject({ id: 'plus', price: prices.plus });
    expect(nextPlan(10 * GiB, 200 * GiB, prices)).toMatchObject({ id: 'pro', price: prices.pro });
    expect(nextPlan(100 * GiB, 101 * GiB, null)).toMatchObject({ id: 'pro', price: null });
    // Bigger than every plan: the largest one still bigger than the quota.
    expect(nextPlan(10 * GiB, 5 * TiB, prices)?.id).toBe('pro');
    expect(nextPlan(1 * TiB, 2 * TiB, prices)).toBeNull();
  });
});

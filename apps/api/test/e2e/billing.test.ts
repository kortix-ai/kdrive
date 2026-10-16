// End to end: paid plans through Stripe, configured entirely by the STRIPE_* variables
// (Admin → Billing is billing-admin.test.ts). A fake Stripe client stands in for the network
// (customers, Checkout, the portal, subscriptions); webhook payloads are signed for real with
// the SDK's test header, so signature checks run as in production.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { asc, eq } from 'drizzle-orm';
import { DEFAULT_QUOTA_BYTES, GiB, TiB } from '@volumes/shared';
import { db } from '../../src/db/client';
import { auditEvents, billingAccounts } from '../../src/db/schema';
import { env } from '../../src/env';
import { setStripeClientForTests } from '../../src/services/billing';
import { makeApp } from '../helpers';
import { FakeStripe, sdk } from './fake-stripe';
import { endWorld, freshWorld, ls, upload, user, type User } from './kit';

const SECRET = 'whsec_test_secret';
const PRICES = { plus: 'price_plus_monthly', pro: 'price_pro_monthly' };

let stripe: FakeStripe;
let n = 0;

beforeEach(async () => {
  await freshWorld();
  stripe = new FakeStripe();
  setStripeClientForTests(stripe);
  env.stripe = { secretKey: 'sk_test_not_a_real_key', webhookSecret: SECRET, prices: PRICES };
});
afterEach(() => {
  setStripeClientForTests(null);
  env.stripe = null;
  endWorld();
});
afterAll(endWorld);

/** Delivers a signed event the way Stripe does: no cookie, no Origin, the raw JSON body. */
async function deliver(type: string, object: Record<string, unknown>, opts: { id?: string; secret?: string; signature?: string | null } = {}) {
  const payload = JSON.stringify({ id: opts.id ?? `evt_${++n}`, object: 'event', type, data: { object } });
  const header = opts.signature === undefined ? await sdk.webhooks.generateTestHeaderStringAsync({ payload, secret: opts.secret ?? SECRET }) : opts.signature;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (header) headers['stripe-signature'] = header;
  const res = await makeApp().fetch(new Request('http://localhost:4101/api/billing/webhook', { method: 'POST', headers, body: payload }));
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const quota = async (u: User) => (await u.client.get('/api/me/usage')).body.quotaBytes as number;
const planChanges = () => db.select().from(auditEvents).where(eq(auditEvents.kind, 'billing.plan_change')).orderBy(asc(auditEvents.id));

/** Checkout for `plan`, then Stripe reports the session completed with an active subscription. */
async function subscribe(u: User, plan: 'plus' | 'pro', subId = 'sub_1') {
  expect((await u.client.post('/api/billing/checkout', { plan })).status).toBe(200);
  const [row] = await db.select().from(billingAccounts).where(eq(billingAccounts.userId, u.userId));
  stripe.setSub(subId, row.stripeCustomerId, plan, 'active');
  const r = await deliver('checkout.session.completed', { id: 'cs_1', object: 'checkout.session', mode: 'subscription', subscription: subId, customer: row.stripeCustomerId, client_reference_id: u.userId });
  expect(r.status).toBe(200);
  return row.stripeCustomerId;
}

describe('billing off', () => {
  test('config says so, and checkout, portal and the webhook answer 404', async () => {
    env.stripe = null;
    const ada = await user('off@test.local');
    expect((await ada.client.get('/api/config')).body.billing).toEqual({ enabled: false, prices: { plus: null, pro: null } });
    expect((await ada.client.get('/api/billing')).body).toMatchObject({ enabled: false, plan: 'free', subscription: null, hasBillingAccount: false });
    expect((await ada.client.post('/api/billing/checkout', { plan: 'plus' })).status).toBe(404);
    expect((await ada.client.post('/api/billing/portal')).status).toBe(404);
    expect((await deliver('customer.subscription.updated', { id: 'sub_x' })).status).toBe(404);
  });
});

describe('checkout and portal', () => {
  test('a Checkout Session for the plan price, one Stripe customer per user, success and cancel back to /pricing', async () => {
    const ada = await user('ada@test.local');
    expect((await ada.client.get('/api/config')).body.billing).toEqual({ enabled: true, prices: { plus: null, pro: null } });
    const r = await ada.client.post('/api/billing/checkout', { plan: 'plus' });
    expect(r.status).toBe(200);
    expect(r.body.url).toBe('https://checkout.stripe.com/c/pay/cs_1');
    expect(stripe.customersMade).toEqual([{ email: 'ada@test.local', name: 'ada', metadata: { userId: ada.userId } }]);
    expect(stripe.sessions[0]).toMatchObject({
      mode: 'subscription',
      customer: 'cus_1',
      client_reference_id: ada.userId,
      line_items: [{ price: PRICES.plus, quantity: 1 }],
      subscription_data: { metadata: { userId: ada.userId, plan: 'plus' } },
    });
    expect(stripe.sessions[0].success_url).toBe('http://localhost:4100/pricing?checkout=success');
    expect(stripe.sessions[0].cancel_url).toBe('http://localhost:4100/pricing?checkout=canceled');

    await ada.client.post('/api/billing/checkout', { plan: 'pro' });
    expect(stripe.customersMade).toHaveLength(1);
    expect(stripe.sessions[1]).toMatchObject({ customer: 'cus_1', line_items: [{ price: PRICES.pro, quantity: 1 }] });

    expect((await ada.client.post('/api/billing/checkout', { plan: 'free' })).status).toBe(400);
    expect((await ada.client.post('/api/billing/checkout', {})).status).toBe(400);

    const portal = await ada.client.post('/api/billing/portal');
    expect(portal.body.url).toBe('https://billing.stripe.com/p/session/1');
    expect(stripe.portals[0]).toEqual({ customer: 'cus_1', return_url: 'http://localhost:4100/pricing' });
  });

  test('portal needs a billing account; a subscriber cannot start a second checkout', async () => {
    const ben = await user('ben@test.local');
    expect((await ben.client.post('/api/billing/portal')).status).toBe(404);
    await subscribe(ben, 'plus');
    const again = await ben.client.post('/api/billing/checkout', { plan: 'pro' });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toContain('Manage billing');
  });

  test('Stripe failures are a retryable 502 without Stripe details', async () => {
    const cat = await user('cat@test.local');
    stripe.customers.create = async () => {
      throw new Error('Invalid API Key provided: sk_test_***');
    };
    const r = await cat.client.post('/api/billing/checkout', { plan: 'plus' });
    expect(r.status).toBe(502);
    expect(r.body.error.code).toBe('upstream_unavailable');
    expect(r.text).not.toContain('sk_test');
  });
});

describe('webhooks', () => {
  test('unsigned, wrongly signed and stale-secret events are refused and change nothing', async () => {
    const ada = await user('sig@test.local');
    await ada.client.post('/api/billing/checkout', { plan: 'plus' });
    stripe.setSub('sub_sig', 'cus_1', 'pro', 'active');
    const evt = { id: 'sub_sig', object: 'subscription' };
    expect((await deliver('customer.subscription.created', evt, { signature: null })).status).toBe(400);
    expect((await deliver('customer.subscription.created', evt, { signature: 't=1,v1=deadbeef' })).status).toBe(400);
    expect((await deliver('customer.subscription.created', evt, { secret: 'whsec_someone_else' })).status).toBe(400);
    expect(await quota(ada)).toBe(DEFAULT_QUOTA_BYTES);
    expect(await planChanges()).toEqual([]);
  });

  test('subscribe → quota up; upgrade → 1 TB; cancel at period end keeps it; ended → back to 10 GB with files kept', async () => {
    const ada = await user('ada2@test.local');
    await upload(ada, { '/keep.txt': 'still here' });
    await ada.client.post('/api/me/storage-requests', { plan: 'plus' });
    const customer = await subscribe(ada, 'plus');

    expect(await quota(ada)).toBe(100 * GiB);
    const billing = (await ada.client.get('/api/billing')).body;
    expect(billing).toMatchObject({
      enabled: true,
      plan: 'plus',
      hasBillingAccount: true,
      subscription: { plan: 'plus', status: 'active', entitled: true, cancelAtPeriodEnd: false },
    });
    expect(billing.subscription.currentPeriodEnd).toBe(new Date(1_900_000_000 * 1000).toISOString());
    // Paying answered the open request.
    expect((await ada.client.get('/api/me/storage-requests')).body.request.status).toBe('granted');

    stripe.setSub('sub_1', customer, 'pro', 'active');
    await deliver('customer.subscription.updated', { id: 'sub_1', object: 'subscription' });
    expect(await quota(ada)).toBe(1 * TiB);

    stripe.setSub('sub_1', customer, 'pro', 'active', { cancelAtPeriodEnd: true });
    await deliver('customer.subscription.updated', { id: 'sub_1', object: 'subscription' });
    expect(await quota(ada)).toBe(1 * TiB);
    expect((await ada.client.get('/api/billing')).body.subscription).toMatchObject({ cancelAtPeriodEnd: true, entitled: true });

    stripe.setSub('sub_1', customer, 'pro', 'canceled');
    await deliver('customer.subscription.deleted', { id: 'sub_1', object: 'subscription' });
    expect(await quota(ada)).toBe(DEFAULT_QUOTA_BYTES);
    expect((await ada.client.get('/api/billing')).body).toMatchObject({ plan: 'free', subscription: { status: 'canceled', entitled: false } });
    expect(await ls(ada)).toEqual(['keep.txt']);

    const changes = (await planChanges()).map((e) => e.meta);
    expect(changes).toEqual([
      expect.objectContaining({ from: DEFAULT_QUOTA_BYTES, to: 100 * GiB, plan: 'plus' }),
      expect.objectContaining({ from: 100 * GiB, to: 1 * TiB, plan: 'pro' }),
      expect.objectContaining({ from: 1 * TiB, to: DEFAULT_QUOTA_BYTES, plan: 'free', status: 'canceled' }),
    ]);
  });

  test('the same event delivered twice is handled once', async () => {
    const ben = await user('ben2@test.local');
    await ben.client.post('/api/billing/checkout', { plan: 'plus' });
    stripe.setSub('sub_2', 'cus_1', 'plus', 'active');
    const first = await deliver('customer.subscription.created', { id: 'sub_2', object: 'subscription' }, { id: 'evt_dup' });
    expect(first.body).toEqual({ received: true });
    // If the replay were handled, it would re-sync this row back to active and change the plan again.
    await db.update(billingAccounts).set({ status: 'canceled' }).where(eq(billingAccounts.userId, ben.userId));
    const second = await deliver('customer.subscription.created', { id: 'sub_2', object: 'subscription' }, { id: 'evt_dup' });
    expect(second.body).toEqual({ received: true, duplicate: true });
    expect(await planChanges()).toHaveLength(1);
    expect((await ben.client.get('/api/billing')).body.subscription.status).toBe('canceled');
  });

  test('a failed payment keeps the plan while Stripe retries; unpaid ends it', async () => {
    const cat = await user('cat2@test.local');
    const customer = await subscribe(cat, 'plus', 'sub_3');
    stripe.setSub('sub_3', customer, 'plus', 'past_due');
    const failed = await deliver('invoice.payment_failed', { id: 'in_1', object: 'invoice', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_3' } } });
    expect(failed.status).toBe(200);
    expect(await quota(cat)).toBe(100 * GiB);
    expect((await cat.client.get('/api/billing')).body.subscription).toMatchObject({ status: 'past_due', entitled: true });

    stripe.setSub('sub_3', customer, 'plus', 'unpaid');
    await deliver('customer.subscription.updated', { id: 'sub_3', object: 'subscription' });
    expect(await quota(cat)).toBe(DEFAULT_QUOTA_BYTES);
  });

  test('a handling failure is not remembered, so Stripe’s retry runs it', async () => {
    const dan = await user('dan@test.local');
    await dan.client.post('/api/billing/checkout', { plan: 'plus' });
    const evt = { id: 'sub_late', object: 'subscription' };
    // Not in the fake yet: retrieve throws.
    const first = await deliver('customer.subscription.created', evt, { id: 'evt_retry' });
    expect(first.status).toBe(502);
    stripe.setSub('sub_late', 'cus_1', 'plus', 'active');
    expect((await deliver('customer.subscription.created', evt, { id: 'evt_retry' })).body).toEqual({ received: true });
    expect(await quota(dan)).toBe(100 * GiB);
  });

  test('events for unknown customers and other event types are acknowledged and ignored', async () => {
    stripe.setSub('sub_orphan', 'cus_nobody', 'pro', 'active');
    expect((await deliver('customer.subscription.created', { id: 'sub_orphan', object: 'subscription' })).status).toBe(200);
    expect((await deliver('charge.refunded', { id: 'ch_1', object: 'charge' })).status).toBe(200);
    expect(await db.select().from(billingAccounts)).toEqual([]);
  });

  test('admins see the subscription next to the user, and deleting the account cancels it', async () => {
    const eve = await user('eve@test.local');
    await subscribe(eve, 'pro', 'sub_eve');
    const adm = await user('admin@test.local');
    const row = (await adm.client.get('/api/admin/users?q=eve')).body.users[0];
    expect(row.subscription).toMatchObject({ plan: 'pro', status: 'active', entitled: true });
    expect(row.quotaBytes).toBe(1 * TiB);

    expect((await eve.client.del('/api/me', { confirm: 'eve@test.local' })).status).toBe(204);
    expect(stripe.cancelled).toEqual(['sub_eve']);
    expect(await db.select().from(billingAccounts)).toEqual([]);
  });
});

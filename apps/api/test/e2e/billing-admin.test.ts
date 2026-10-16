// End to end: Admin → Billing. An admin pastes one Stripe key and types two prices; KDRIVE
// checks the key, creates the webhook endpoint and the plan Products and Prices (a fake Stripe
// stands in), keeps the secrets sealed in app_settings, and billing runs from there. The
// STRIPE_* variables stay a fallback. No response ever carries a secret.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { asc, eq } from 'drizzle-orm';
import { GiB } from '@volumes/shared';
import { db } from '../../src/db/client';
import { appSettings, auditEvents, billingAccounts } from '../../src/db/schema';
import { env } from '../../src/env';
import { seal } from '../../src/lib/secret-box';
import { clearBillingConfigCache } from '../../src/services/billing-config';
import { setStripeClientForTests } from '../../src/services/stripe-client';
import { makeApp } from '../helpers';
import { FakeStripe, sdk, stripeError } from './fake-stripe';
import { endWorld, freshWorld, user, type User } from './kit';

const KEY = 'sk_test_51AbCdEfGhIjKlMnOp1234';
const LIVE_KEY = 'sk_live_51ZyXwVuTsRqPoNm9876';
const PUBLIC_URL = 'https://kdrive.example.com';
const PRICES = { plus: { amount: 9, currency: 'USD' }, pro: { amount: 29, currency: 'USD' } };

let stripe: FakeStripe;
let admin: User;
const localUrl = env.BETTER_AUTH_URL;

beforeEach(async () => {
  await freshWorld();
  stripe = new FakeStripe();
  setStripeClientForTests(stripe);
  env.stripe = null;
  admin = await user('admin@test.local');
});
afterEach(() => {
  setStripeClientForTests(null);
  env.stripe = null;
  env.BETTER_AUTH_URL = localUrl;
  endWorld();
});
afterAll(endWorld);

/** Pretends the server is public, so Stripe can reach its webhook. */
function goPublic() {
  env.BETTER_AUTH_URL = PUBLIC_URL;
}

const view = async () => (await admin.client.get('/api/admin/billing')).body;
const config = async () => (await admin.client.get('/api/config')).body.billing;
const stored = async () => (await db.select().from(appSettings).where(eq(appSettings.key, 'billing')))[0];
const events = (kind: string) => db.select().from(auditEvents).where(eq(auditEvents.kind, kind)).orderBy(asc(auditEvents.id));

/** Nothing secret in a response, the stored row or an audit event. */
async function expectNoSecrets(...texts: string[]) {
  const row = await stored();
  const audit = await db.select().from(auditEvents);
  for (const t of [...texts, JSON.stringify(row?.value ?? {}), JSON.stringify(audit)]) {
    expect(t).not.toContain(KEY);
    expect(t).not.toContain(LIVE_KEY);
    expect(t).not.toMatch(/whsec_/);
  }
}

async function deliver(type: string, object: Record<string, unknown>, secret: string) {
  const payload = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, object: 'event', type, data: { object } });
  const header = await sdk.webhooks.generateTestHeaderStringAsync({ payload, secret });
  const res = await makeApp().fetch(
    new Request('http://localhost:4101/api/billing/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload }),
  );
  return res.status;
}

describe('access', () => {
  test('non-admins get 404 on every billing route; signed-out callers 401', async () => {
    const plain = await user('plain@test.local');
    const routes: [string, string, unknown?][] = [
      ['GET', '/api/admin/billing'],
      ['PUT', '/api/admin/billing/key', { secretKey: KEY }],
      ['PUT', '/api/admin/billing/prices', PRICES],
      ['PUT', '/api/admin/billing/webhook-secret', { webhookSecret: 'whsec_abcdefgh123' }],
      ['POST', '/api/admin/billing/webhook', {}],
      ['DELETE', '/api/admin/billing'],
    ];
    for (const [method, path, body] of routes) {
      const r = await plain.client.raw(method, path, body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {});
      expect(`${method} ${path} ${r.status}`).toBe(`${method} ${path} 404`);
    }
    expect(stripe.calls).toEqual([]);
    expect(await stored()).toBeUndefined();
    plain.client.cookies.clear();
    expect((await plain.client.get('/api/admin/billing')).status).toBe(401);
  });

  test('mutations need a trusted Origin (CSRF), like every other admin change', async () => {
    const r = await admin.client.raw('PUT', '/api/admin/billing/key', {
      body: JSON.stringify({ secretKey: KEY }),
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    });
    expect(r.status).toBe(403);
    expect(stripe.calls).toEqual([]);
  });
});

describe('setup', () => {
  test('nothing configured: off, no prices, the webhook URL to give Stripe', async () => {
    expect(await view()).toMatchObject({
      source: null,
      enabled: false,
      mode: null,
      keyHint: null,
      envConfigured: false,
      webhook: { url: 'http://localhost:4100/api/billing/webhook', status: 'missing' },
      prices: { plus: null, pro: null },
      updatedAt: null,
    });
    expect(await config()).toEqual({ enabled: false, prices: { plus: null, pro: null } });
  });

  test('prices without a key are kept and shown publicly, without calling Stripe', async () => {
    const r = await admin.client.put('/api/admin/billing/prices', PRICES);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ source: null, enabled: false, prices: PRICES, pricesReady: { plus: false, pro: false }, updatedBy: 'admin@test.local' });
    expect(stripe.calls).toEqual([]);
    expect(await config()).toEqual({ enabled: false, prices: PRICES });
    // Signed out too: /api/config is public.
    const anon = await makeApp().fetch(new Request('http://localhost:4101/api/config'));
    expect(((await anon.json()) as { billing: unknown }).billing).toEqual({ enabled: false, prices: PRICES });
  });

  test('price validation: both plans, one currency, sensible amounts', async () => {
    const bad = [
      {},
      { plus: PRICES.plus },
      { plus: { amount: 0, currency: 'USD' }, pro: PRICES.pro },
      { plus: { amount: 9.999, currency: 'USD' }, pro: PRICES.pro },
      { plus: { amount: 9.5, currency: 'JPY' }, pro: { amount: 3000, currency: 'JPY' } },
      { plus: PRICES.plus, pro: { amount: 29, currency: 'EUR' } },
      { plus: { amount: 9, currency: 'XYZ' }, pro: PRICES.pro },
    ];
    for (const body of bad) expect((await admin.client.put('/api/admin/billing/prices', body)).status).toBe(400);
    expect((await admin.client.put('/api/admin/billing/prices', { plus: { amount: 1200, currency: 'JPY' }, pro: { amount: 3000, currency: 'JPY' } })).status).toBe(200);
  });

  test('key format is checked before Stripe is called; a key Stripe refuses is not saved', async () => {
    for (const secretKey of ['', 'pk_test_51AbCdEfGh', 'sk_prod_51AbCdEfGh', 'whsec_abcdefgh', 'sk_test_short']) {
      expect((await admin.client.put('/api/admin/billing/key', { secretKey })).status).toBe(400);
    }
    expect(stripe.calls).toEqual([]);
    stripe.accountError = stripeError('StripeAuthenticationError', 401, `Invalid API Key provided: ${KEY.slice(0, 12)}****1234`);
    const r = await admin.client.put('/api/admin/billing/key', { secretKey: KEY });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain('Stripe did not accept this key');
    expect(await stored()).toBeUndefined();
    await expectNoSecrets(r.text);
  });

  test('a key on a private URL: saved, prices created, webhook left to a pasted secret (stripe listen)', async () => {
    await admin.client.put('/api/admin/billing/prices', PRICES);
    const r = await admin.client.put('/api/admin/billing/key', { secretKey: ` ${KEY} ` });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      source: 'admin',
      enabled: false,
      mode: 'test',
      account: 'KDRIVE Test',
      keyHint: 'sk_test_…1234',
      webhook: { status: 'missing' },
      pricesReady: { plus: true, pro: true },
    });
    expect(r.body.webhook.error).toContain('stripe listen --forward-to http://localhost:4100/api/billing/webhook');
    expect(stripe.calls.some((c) => c.startsWith('webhookEndpoints.create'))).toBe(false);

    // One Product per plan (fixed ids), one monthly Price each, marked with the plan.
    expect([...stripe.productStore.keys()].sort()).toEqual(['kdrive_plus', 'kdrive_pro']);
    expect(stripe.productStore.get('kdrive_plus')).toMatchObject({ name: 'KDRIVE Plus', metadata: { kdrive_plan: 'plus' } });
    expect(stripe.priceStore.map((p) => [p.product, p.unit_amount, p.currency, p.recurring?.interval, p.lookup_key, p.metadata.kdrive_plan])).toEqual([
      ['kdrive_plus', 900, 'usd', 'month', 'kdrive_plus_monthly', 'plus'],
      ['kdrive_pro', 2900, 'usd', 'month', 'kdrive_pro_monthly', 'pro'],
    ]);

    // Not on until a signing secret arrives.
    expect((await admin.client.put('/api/admin/billing/webhook-secret', { webhookSecret: 'nope' })).status).toBe(400);
    const w = await admin.client.put('/api/admin/billing/webhook-secret', { webhookSecret: 'whsec_fromstripelisten123' });
    expect(w.body).toMatchObject({ enabled: true, webhook: { status: 'manual' } });
    expect(await config()).toEqual({ enabled: true, prices: PRICES });

    const row = await stored();
    expect(JSON.stringify(row.value)).toContain('v1:');
    await expectNoSecrets(r.text, w.text, JSON.stringify(await view()));
    expect((await events('billing.config_key'))[0]).toMatchObject({ target: 'sk_test_…1234', meta: { mode: 'test', webhook: 'missing', replaced: false } });
    expect(await events('billing.config_prices')).toHaveLength(1);
    expect(await events('billing.config_webhook')).toHaveLength(1);
  });

  test('a public server: the webhook endpoint is created automatically, and replaced (not piled up) with the key', async () => {
    goPublic();
    // An endpoint for the same URL left by an earlier setup, and somebody else's.
    stripe.endpointStore.push(
      { id: 'we_old', url: `${PUBLIC_URL}/api/billing/webhook`, metadata: { kdrive: 'billing' } } as never,
      { id: 'we_other', url: 'https://elsewhere.example/hook', metadata: {} } as never,
    );
    await admin.client.put('/api/admin/billing/prices', PRICES);
    const r = await admin.client.put('/api/admin/billing/key', { secretKey: KEY });
    expect(r.body).toMatchObject({ enabled: true, webhook: { url: `${PUBLIC_URL}/api/billing/webhook`, status: 'auto' } });
    const created = r.body.webhook.endpointId as string;
    expect(stripe.endpointStore.map((e) => e.id).sort()).toEqual([created, 'we_other'].sort());
    const ep = stripe.endpointStore.find((e) => e.id === created)!;
    expect(ep.enabled_events).toEqual([
      'checkout.session.completed',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.payment_failed',
    ]);
    expect(ep.metadata).toEqual({ kdrive: 'billing' });

    // Replacing the key: a fresh endpoint, the old one gone.
    stripe.account = { id: 'acct_1', settings: { dashboard: { display_name: 'KDRIVE Live' } } } as never;
    const live = await admin.client.put('/api/admin/billing/key', { secretKey: LIVE_KEY });
    expect(live.body).toMatchObject({ mode: 'live', account: 'KDRIVE Live', keyHint: 'sk_live_…9876', webhook: { status: 'auto' }, enabled: true });
    expect(live.body.webhook.endpointId).not.toBe(created);
    expect(stripe.endpointStore.filter((e) => e.metadata?.kdrive)).toHaveLength(1);
    expect(stripe.deletedEndpoints).toContain(created);
    // The same amounts: the Prices are found again, not duplicated.
    expect(stripe.priceStore).toHaveLength(2);
    expect((await events('billing.config_key')).map((e) => e.meta)).toEqual([
      expect.objectContaining({ webhook: 'auto', replaced: false }),
      expect.objectContaining({ mode: 'live', webhook: 'auto', replaced: true }),
    ]);
    await expectNoSecrets(r.text, live.text);
  });

  test('Stripe refusing the endpoint falls back to a pasted secret; retry sets it up once possible', async () => {
    goPublic();
    stripe.endpointError = stripeError('StripeInvalidRequestError', 400, 'Invalid URL: URL must be publicly accessible.');
    await admin.client.put('/api/admin/billing/prices', PRICES);
    const r = await admin.client.put('/api/admin/billing/key', { secretKey: KEY });
    expect(r.body).toMatchObject({ enabled: false, webhook: { status: 'missing' } });
    expect(r.body.webhook.error).toContain('URL must be publicly accessible');

    stripe.endpointError = null;
    const retry = await admin.client.post('/api/admin/billing/webhook', {});
    expect(retry.body).toMatchObject({ enabled: true, webhook: { status: 'auto' } });
    // A pasted secret replaces the automatic endpoint (removed from Stripe).
    const id = retry.body.webhook.endpointId;
    const pasted = await admin.client.put('/api/admin/billing/webhook-secret', { webhookSecret: 'whsec_dashboard123' });
    expect(pasted.body.webhook).toEqual({ url: `${PUBLIC_URL}/api/billing/webhook`, status: 'manual' });
    expect(stripe.deletedEndpoints).toContain(id);
  });

  test('webhook secret and retry need a key first', async () => {
    expect((await admin.client.put('/api/admin/billing/webhook-secret', { webhookSecret: 'whsec_abcdefgh123' })).status).toBe(409);
    expect((await admin.client.post('/api/admin/billing/webhook', {})).status).toBe(409);
  });
});

describe('prices in Stripe', () => {
  test('a new amount is a new Price (the old one stays for its subscribers); an old amount is found again', async () => {
    goPublic();
    await admin.client.put('/api/admin/billing/key', { secretKey: KEY });
    expect(stripe.priceStore).toHaveLength(0);
    expect((await view()).enabled).toBe(false);

    await admin.client.put('/api/admin/billing/prices', PRICES);
    const first = stripe.priceStore.map((p) => p.id);
    expect(first).toHaveLength(2);
    expect((await view()).enabled).toBe(true);

    const raised = await admin.client.put('/api/admin/billing/prices', { plus: { amount: 12, currency: 'USD' }, pro: PRICES.pro });
    expect(raised.body.prices.plus).toEqual({ amount: 12, currency: 'USD' });
    expect(stripe.priceStore).toHaveLength(3);
    const plus12 = stripe.priceStore[2];
    expect(plus12).toMatchObject({ unit_amount: 1200, lookup_key: 'kdrive_plus_monthly' });
    expect(stripe.priceStore[0]).toMatchObject({ active: true, lookup_key: null });

    // Back to 9: the first Price again, with the lookup key moved back to it.
    stripe.calls = [];
    await admin.client.put('/api/admin/billing/prices', PRICES);
    expect(stripe.priceStore).toHaveLength(3);
    expect(stripe.priceStore[0].lookup_key).toBe('kdrive_plus_monthly');
    expect(stripe.calls.filter((c) => c.startsWith('prices.create'))).toEqual([]);
    // Unchanged Pro was not even looked up.
    expect(stripe.calls.filter((c) => c.includes('kdrive_pro'))).toEqual([]);
    expect(await config()).toEqual({ enabled: true, prices: PRICES });
  });

  test('Stripe refusing the prices is a 502 with its reason, and nothing changes', async () => {
    await admin.client.put('/api/admin/billing/prices', PRICES);
    await admin.client.put('/api/admin/billing/key', { secretKey: KEY });
    stripe.prices.create = async () => {
      throw stripeError('StripePermissionError', 403, `The provided key '${KEY.slice(0, 12)}***1234' does not have the required permissions`);
    };
    const r = await admin.client.put('/api/admin/billing/prices', { plus: { amount: 10, currency: 'USD' }, pro: PRICES.pro });
    expect(r.status).toBe(502);
    expect(r.body.error.message).toContain('does not have the required permissions');
    expect(r.text).toContain('[key]');
    expect((await view()).prices).toEqual(PRICES);
    await expectNoSecrets(r.text);
  });
});

describe('billing from Admin → Billing', () => {
  async function connect() {
    goPublic();
    const r = await admin.client.put('/api/admin/billing/key', { secretKey: KEY });
    expect((await admin.client.put('/api/admin/billing/prices', PRICES)).status).toBe(200);
    env.BETTER_AUTH_URL = localUrl;
    const plusPrice = stripe.priceStore.find((p) => p.product === 'kdrive_plus')!.id;
    // The secret Stripe returned for the endpoint KDRIVE created.
    const secret = `whsec_fake${r.body.webhook.endpointId.slice(3)}secret`;
    return { plusPrice, secret };
  }

  test('checkout uses the stored Price; webhooks are verified with the stored secret; plan from the Price metadata', async () => {
    const { plusPrice, secret } = await connect();
    const ada = await user('ada@test.local');
    expect((await ada.client.post('/api/billing/checkout', { plan: 'plus' })).status).toBe(200);
    expect(stripe.sessions[0].line_items).toEqual([{ price: plusPrice, quantity: 1 }]);
    const [row] = await db.select().from(billingAccounts).where(eq(billingAccounts.userId, ada.userId));

    // A Price KDRIVE does not know by id (an older amount), marked with the plan.
    stripe.setSub('sub_1', row.stripeCustomerId, 'plus', 'active', { priceId: 'price_old_amount', priceMetadata: { kdrive_plan: 'pro' } });
    expect(await deliver('customer.subscription.created', { id: 'sub_1', object: 'subscription' }, 'whsec_wrong')).toBe(400);
    expect(await deliver('customer.subscription.created', { id: 'sub_1', object: 'subscription' }, secret)).toBe(200);
    expect((await ada.client.get('/api/billing')).body).toMatchObject({ enabled: true, plan: 'pro', subscription: { plan: 'pro' } });

    // Known by id, no metadata.
    stripe.setSub('sub_1', row.stripeCustomerId, 'plus', 'active', { priceId: plusPrice });
    expect(await deliver('customer.subscription.updated', { id: 'sub_1', object: 'subscription' }, secret)).toBe(200);
    expect((await ada.client.get('/api/me/usage')).body.quotaBytes).toBe(100 * GiB);
  });

  test('saved and env webhook secrets both verify (an endpoint set up either way keeps working)', async () => {
    const { secret } = await connect();
    env.stripe = { secretKey: KEY, webhookSecret: 'whsec_envsecret' };
    const ben = await user('ben@test.local');
    await ben.client.post('/api/billing/checkout', { plan: 'plus' });
    const [row] = await db.select().from(billingAccounts).where(eq(billingAccounts.userId, ben.userId));
    stripe.setSub('sub_env', row.stripeCustomerId, 'plus', 'active', { priceMetadata: { kdrive_plan: 'plus' } });
    expect(await deliver('customer.subscription.created', { id: 'sub_env', object: 'subscription' }, 'whsec_envsecret')).toBe(200);
    expect(await deliver('customer.subscription.updated', { id: 'sub_env', object: 'subscription' }, secret)).toBe(200);
    expect(await deliver('customer.subscription.updated', { id: 'sub_env', object: 'subscription' }, 'whsec_nobody')).toBe(400);
    expect((await ben.client.get('/api/billing')).body.subscription.plan).toBe('plus');
  });

  test('disconnect: endpoint removed, billing off, prices kept for next time', async () => {
    await connect();
    const endpoint = (await view()).webhook.endpointId;
    const r = await admin.client.del('/api/admin/billing');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ source: null, enabled: false, keyHint: null, prices: PRICES, pricesReady: { plus: false, pro: false } });
    expect(stripe.deletedEndpoints).toContain(endpoint);
    expect(await config()).toEqual({ enabled: false, prices: PRICES });
    const ada = await user('ada2@test.local');
    expect((await ada.client.post('/api/billing/checkout', { plan: 'plus' })).status).toBe(404);
    expect((await events('billing.config_disconnect'))[0]).toMatchObject({ target: 'sk_test_…1234' });
    // Disconnecting again is a no-op.
    expect((await admin.client.del('/api/admin/billing')).status).toBe(200);
    expect(await events('billing.config_disconnect')).toHaveLength(1);

    // Connecting again finds the same Prices.
    goPublic();
    await admin.client.put('/api/admin/billing/key', { secretKey: KEY });
    expect(stripe.priceStore).toHaveLength(2);
    expect((await view()).enabled).toBe(true);
  });
});

describe('fallbacks', () => {
  test('a saved key that no longer opens (auth secret changed) is reported, never a crash', async () => {
    const other = 'another-auth-secret-000000000000000000000000';
    await db.insert(appSettings).values({
      key: 'billing',
      value: { secretKey: seal(KEY, other), keyHint: 'sk_test_…1234', mode: 'test', webhook: { status: 'auto', secret: seal('whsec_x1234567', other) }, prices: { plus: { ...PRICES.plus, priceId: 'price_a' }, pro: { ...PRICES.pro, priceId: 'price_b' } } },
    });
    clearBillingConfigCache();
    const v = await view();
    expect(v).toMatchObject({ source: null, enabled: false });
    expect(v.keyError).toContain('Paste the key again');
    expect(await config()).toEqual({ enabled: false, prices: PRICES });
    const ada = await user('ada3@test.local');
    expect((await ada.client.post('/api/billing/checkout', { plan: 'plus' })).status).toBe(404);
    // Pasting the key again heals it.
    const r = await admin.client.put('/api/admin/billing/key', { secretKey: KEY });
    expect(r.body.keyError).toBeUndefined();
    expect(r.body.source).toBe('admin');
  });

  test('STRIPE_SECRET_KEY alone: shown read-only; saving the prices creates them and the webhook with that key', async () => {
    env.stripe = { secretKey: LIVE_KEY };
    const v = await view();
    expect(v).toMatchObject({
      source: 'env',
      enabled: false,
      mode: 'live',
      account: 'KDRIVE Test',
      keyHint: 'sk_live_…9876',
      envConfigured: true,
      webhook: { status: 'missing' },
      pricesFromEnv: { plus: false, pro: false },
    });
    expect((await admin.client.put('/api/admin/billing/key', { secretKey: KEY })).status).toBe(409);
    expect((await admin.client.del('/api/admin/billing')).status).toBe(409);

    goPublic();
    const r = await admin.client.put('/api/admin/billing/prices', PRICES);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ source: 'env', enabled: true, webhook: { status: 'auto' }, prices: PRICES, pricesReady: { plus: true, pro: true } });
    expect(stripe.priceStore).toHaveLength(2);
    expect(await config()).toEqual({ enabled: true, prices: PRICES });
    // The webhook secret Stripe returned is sealed in app_settings; the key never is.
    const row = await stored();
    expect(row.value.secretKey).toBeUndefined();
    await expectNoSecrets(r.text, JSON.stringify(await view()));

    // Checkout runs on the env key with the Prices made here.
    const ada = await user('ada4@test.local');
    expect((await ada.client.post('/api/billing/checkout', { plan: 'pro' })).status).toBe(200);
    expect(stripe.sessions[0].line_items).toEqual([{ price: stripe.priceStore.find((p) => p.product === 'kdrive_pro')!.id, quantity: 1 }]);
  });

  test('precedence: the env key wins over a saved one; env webhook secret and Prices override what is saved', async () => {
    goPublic();
    await admin.client.put('/api/admin/billing/prices', PRICES);
    await admin.client.put('/api/admin/billing/key', { secretKey: KEY });
    expect(await view()).toMatchObject({ source: 'admin', keyHint: 'sk_test_…1234', enabled: true, webhook: { status: 'auto' } });

    env.stripe = { secretKey: LIVE_KEY };
    expect(await view()).toMatchObject({ source: 'env', keyHint: 'sk_live_…9876', mode: 'live', enabled: true, webhook: { status: 'auto' } });

    env.stripe = { secretKey: LIVE_KEY, webhookSecret: 'whsec_envsecret', prices: { plus: 'price_env_plus', pro: 'price_env_pro' } };
    const v = await view();
    expect(v).toMatchObject({ enabled: true, webhook: { status: 'manual', fromEnv: true }, pricesFromEnv: { plus: true, pro: true }, prices: { plus: null, pro: null } });
    expect(await config()).toEqual({ enabled: true, prices: { plus: null, pro: null } });
    expect((await admin.client.put('/api/admin/billing/prices', PRICES)).status).toBe(409);
    expect((await admin.client.put('/api/admin/billing/webhook-secret', { webhookSecret: 'whsec_abcdefgh123' })).status).toBe(409);
    expect((await admin.client.post('/api/admin/billing/webhook', {})).status).toBe(409);
    expect(JSON.stringify(v)).not.toContain('envsecret');

    const ada = await user('ada5@test.local');
    await ada.client.post('/api/billing/checkout', { plan: 'plus' });
    expect(stripe.sessions[0].line_items).toEqual([{ price: 'price_env_plus', quantity: 1 }]);

    // Without the env key, the saved setup is back.
    env.stripe = null;
    expect(await view()).toMatchObject({ source: 'admin', keyHint: 'sk_test_…1234', webhook: { status: 'auto' } });
  });
});

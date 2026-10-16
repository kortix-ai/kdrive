// The Stripe SDK behind one narrow interface, one client per secret key. Tests inject a fake.

import Stripe from 'stripe';

/** The slice of the Stripe SDK KDRIVE uses (billing and Admin → Billing). */
export interface StripeClient {
  customers: { create(p: Stripe.CustomerCreateParams): Promise<{ id: string }> };
  checkout: { sessions: { create(p: Stripe.Checkout.SessionCreateParams): Promise<{ id: string; url: string | null }> } };
  billingPortal: { sessions: { create(p: Stripe.BillingPortal.SessionCreateParams): Promise<{ url: string }> } };
  subscriptions: {
    retrieve(id: string): Promise<Stripe.Subscription>;
    cancel(id: string): Promise<unknown>;
  };
  webhooks: { constructEventAsync(payload: string, header: string, secret: string): Promise<Stripe.Event> };
  /** The key's own account (checks a pasted key and names the account). */
  accounts: { retrieveCurrent(): Promise<Pick<Stripe.Account, 'id'> & Partial<Pick<Stripe.Account, 'settings' | 'business_profile' | 'email'>>> };
  products: {
    retrieve(id: string): Promise<Stripe.Product>;
    create(p: Stripe.ProductCreateParams): Promise<Stripe.Product>;
    update(id: string, p: Stripe.ProductUpdateParams): Promise<Stripe.Product>;
  };
  prices: {
    list(p: Stripe.PriceListParams): Promise<{ data: Stripe.Price[] }>;
    create(p: Stripe.PriceCreateParams): Promise<Stripe.Price>;
    update(id: string, p: Stripe.PriceUpdateParams): Promise<Stripe.Price>;
  };
  webhookEndpoints: {
    list(p: Stripe.WebhookEndpointListParams): Promise<{ data: Stripe.WebhookEndpoint[] }>;
    create(p: Stripe.WebhookEndpointCreateParams): Promise<Stripe.WebhookEndpoint>;
    del(id: string): Promise<unknown>;
  };
}

/** The events handleWebhook (services/billing.ts) acts on: what an endpoint KDRIVE creates subscribes to. */
export const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
] as const satisfies readonly Stripe.WebhookEndpointCreateParams.EnabledEvent[];

/** The API version endpoints KDRIVE creates are pinned to (the SDK's own). */
export const STRIPE_API_VERSION = Stripe.API_VERSION;

const clients = new Map<string, StripeClient>();
let testClient: StripeClient | null = null;

/** Tests: use `c` for every key instead of the real SDK (null puts the SDK back). */
export function setStripeClientForTests(c: StripeClient | null): void {
  testClient = c;
}

/** A client for `secretKey` (reused per key). */
export function stripeClient(secretKey: string): StripeClient {
  if (testClient) return testClient;
  let c = clients.get(secretKey);
  if (!c) {
    // A replaced key is dropped, so at most the current one or two stay in memory.
    if (clients.size >= 4) clients.clear();
    c = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 10_000, appInfo: { name: 'KDRIVE' } });
    clients.set(secretKey, c);
  }
  return c;
}

/** A Stripe error's kind, for both the SDK's errors and plain objects shaped like them. */
export function stripeErrorKind(e: unknown): 'auth' | 'permission' | 'missing' | 'invalid' | 'other' {
  const err = e as { type?: string; statusCode?: number; code?: string } | null;
  if (!err || typeof err !== 'object') return 'other';
  if (err.type === 'StripeAuthenticationError' || err.statusCode === 401) return 'auth';
  if (err.type === 'StripePermissionError' || err.statusCode === 403) return 'permission';
  if (err.code === 'resource_missing' || err.statusCode === 404) return 'missing';
  if (err.type === 'StripeInvalidRequestError' || err.statusCode === 400) return 'invalid';
  return 'other';
}

/** A Stripe error's message for an admin, with anything shaped like a key or secret masked. */
export function stripeErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  return msg.replace(/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9*]+/g, '[key]').replace(/\bwhsec_[A-Za-z0-9+/=_*-]+/g, '[secret]').slice(0, 300);
}

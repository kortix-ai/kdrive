// A fake Stripe for the billing suites: records what the API asked for and holds the objects
// Stripe "has" (customers, subscriptions, products, prices, webhook endpoints). Webhook
// signatures are the SDK's own, so signature checks run as in production.
import Stripe from 'stripe';
import type { StripeClient } from '../../src/services/stripe-client';

export const sdk = new Stripe('sk_test_not_a_real_key');

/** A Stripe-shaped error (what stripeErrorKind reads). */
export function stripeError(type: string, statusCode: number, message: string, code?: string): Error {
  return Object.assign(new Error(message), { type, statusCode, code });
}

export class FakeStripe implements StripeClient {
  customersMade: Stripe.CustomerCreateParams[] = [];
  sessions: Stripe.Checkout.SessionCreateParams[] = [];
  portals: Stripe.BillingPortal.SessionCreateParams[] = [];
  cancelled: string[] = [];
  subs = new Map<string, Stripe.Subscription>();
  /** Price id → plan for the subscriptions setSub makes (overridable per test). */
  planPrices: Record<'plus' | 'pro', string> = { plus: 'price_plus_monthly', pro: 'price_pro_monthly' };

  // Admin → Billing
  account: Partial<Stripe.Account> & { id: string } = { id: 'acct_1', settings: { dashboard: { display_name: 'KDRIVE Test' } } as Stripe.Account.Settings };
  accountError: Error | null = null;
  productStore = new Map<string, Stripe.Product>();
  priceStore: Stripe.Price[] = [];
  endpointStore: Stripe.WebhookEndpoint[] = [];
  endpointError: Error | null = null;
  deletedEndpoints: string[] = [];
  calls: string[] = [];
  private seq = 0;

  customers = { create: async (p: Stripe.CustomerCreateParams) => (this.customersMade.push(p), { id: `cus_${this.customersMade.length}` }) };
  checkout = {
    sessions: { create: async (p: Stripe.Checkout.SessionCreateParams) => (this.sessions.push(p), { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }) },
  };
  billingPortal = { sessions: { create: async (p: Stripe.BillingPortal.SessionCreateParams) => (this.portals.push(p), { url: 'https://billing.stripe.com/p/session/1' }) } };
  subscriptions = {
    retrieve: async (id: string) => {
      const s = this.subs.get(id);
      if (!s) throw new Error(`no such subscription: ${id}`);
      return s;
    },
    cancel: async (id: string) => {
      this.cancelled.push(id);
      return {};
    },
  };
  webhooks = sdk.webhooks;

  accounts = {
    retrieveCurrent: async () => {
      this.calls.push('accounts.retrieveCurrent');
      if (this.accountError) throw this.accountError;
      return this.account as Stripe.Account;
    },
  };

  products = {
    retrieve: async (id: string) => {
      this.calls.push(`products.retrieve ${id}`);
      const p = this.productStore.get(id);
      if (!p) throw stripeError('StripeInvalidRequestError', 404, `No such product: '${id}'`, 'resource_missing');
      return p;
    },
    create: async (p: Stripe.ProductCreateParams) => {
      this.calls.push(`products.create ${p.id}`);
      const product = { id: p.id ?? `prod_${++this.seq}`, object: 'product', active: true, name: p.name, metadata: p.metadata ?? {} } as unknown as Stripe.Product;
      this.productStore.set(product.id, product);
      return product;
    },
    update: async (id: string, p: Stripe.ProductUpdateParams) => {
      this.calls.push(`products.update ${id}`);
      const product = { ...this.productStore.get(id)!, ...(p as object) } as Stripe.Product;
      this.productStore.set(id, product);
      return product;
    },
  };

  prices = {
    list: async (p: Stripe.PriceListParams) => {
      this.calls.push(`prices.list ${p.product}`);
      return { data: this.priceStore.filter((x) => (!p.product || x.product === p.product) && (p.active === undefined || x.active === p.active)) };
    },
    create: async (p: Stripe.PriceCreateParams) => {
      this.calls.push(`prices.create ${p.product} ${p.unit_amount} ${p.currency}`);
      if (p.lookup_key && p.transfer_lookup_key) for (const x of this.priceStore) if (x.lookup_key === p.lookup_key) x.lookup_key = null;
      const price = {
        id: `price_${++this.seq}`,
        object: 'price',
        active: true,
        product: p.product,
        unit_amount: p.unit_amount,
        currency: p.currency,
        recurring: { interval: p.recurring?.interval, interval_count: 1 },
        lookup_key: p.lookup_key ?? null,
        metadata: p.metadata ?? {},
      } as unknown as Stripe.Price;
      this.priceStore.push(price);
      return price;
    },
    update: async (id: string, p: Stripe.PriceUpdateParams) => {
      this.calls.push(`prices.update ${id}`);
      if (p.lookup_key && p.transfer_lookup_key) for (const x of this.priceStore) if (x.lookup_key === p.lookup_key) x.lookup_key = null;
      const price = this.priceStore.find((x) => x.id === id)!;
      Object.assign(price, { lookup_key: p.lookup_key ?? price.lookup_key, metadata: { ...price.metadata, ...(p.metadata as object) } });
      return price;
    },
  };

  webhookEndpoints = {
    list: async () => {
      this.calls.push('webhookEndpoints.list');
      return { data: [...this.endpointStore] };
    },
    create: async (p: Stripe.WebhookEndpointCreateParams) => {
      this.calls.push(`webhookEndpoints.create ${p.url}`);
      if (this.endpointError) throw this.endpointError;
      const ep = {
        id: `we_${++this.seq}`,
        object: 'webhook_endpoint',
        url: p.url,
        enabled_events: p.enabled_events,
        metadata: p.metadata ?? {},
        api_version: p.api_version ?? null,
        secret: `whsec_fake${this.seq}secret`,
      } as unknown as Stripe.WebhookEndpoint;
      this.endpointStore.push({ ...ep, secret: undefined } as Stripe.WebhookEndpoint);
      return ep;
    },
    del: async (id: string) => {
      this.calls.push(`webhookEndpoints.del ${id}`);
      this.deletedEndpoints.push(id);
      this.endpointStore = this.endpointStore.filter((e) => e.id !== id);
      return { id, deleted: true };
    },
  };

  /** Puts a subscription in the fake's store, as Stripe would hold it now. */
  setSub(
    id: string,
    customer: string,
    plan: 'plus' | 'pro',
    status: Stripe.Subscription.Status,
    extra: { cancelAtPeriodEnd?: boolean; userId?: string; priceId?: string; priceMetadata?: Record<string, string> } = {},
  ) {
    const sub = {
      id,
      object: 'subscription',
      customer,
      status,
      cancel_at_period_end: !!extra.cancelAtPeriodEnd,
      metadata: extra.userId ? { userId: extra.userId, plan } : {},
      items: {
        object: 'list',
        data: [{ price: { id: extra.priceId ?? this.planPrices[plan], metadata: extra.priceMetadata ?? {} }, current_period_end: 1_900_000_000 }],
      },
    } as unknown as Stripe.Subscription;
    this.subs.set(id, sub);
    return sub;
  }
}

import { z } from 'zod';
import { BILLING_CURRENCIES, currencyDecimals, PAID_PLAN_IDS, PLAN_IDS } from '../plans';
import { IsoDateSchema } from './common';

export const PlanIdSchema = z.enum(PLAN_IDS);
export const PaidPlanIdSchema = z.enum(PAID_PLAN_IDS);

/** A monthly price in the currency's major unit (9 = 9.00). */
export const PlanPriceSchema = z.object({ amount: z.number(), currency: z.string() });

/** The paid plans' prices as an admin set them (null: not set, "Price coming soon"). */
export const PlanPricesSchema = z.object({ plus: PlanPriceSchema.nullable(), pro: PlanPriceSchema.nullable() });

// ── storage requests (no billing configured: a person asks, an admin grants) ─

export const STORAGE_REQUEST_NOTE_MAX = 500;

export const StorageRequestStatusSchema = z.enum(['open', 'granted', 'dismissed']);
export type StorageRequestStatus = z.infer<typeof StorageRequestStatusSchema>;

export const StorageRequestSchema = z.object({
  id: z.string(),
  plan: PaidPlanIdSchema,
  note: z.string().nullable(),
  status: StorageRequestStatusSchema,
  createdAt: IsoDateSchema,
  resolvedAt: IsoDateSchema.nullable(),
});
export type StorageRequest = z.infer<typeof StorageRequestSchema>;

export const CreateStorageRequest = z.object({
  plan: PaidPlanIdSchema,
  note: z.string().trim().max(STORAGE_REQUEST_NOTE_MAX).optional(),
});
export type CreateStorageRequest = z.input<typeof CreateStorageRequest>;

/** The signed-in user's latest request (open, or the last one an admin answered), if any. */
export const StorageRequestResponse = z.object({ request: StorageRequestSchema.nullable() });
export type StorageRequestResponse = z.infer<typeof StorageRequestResponse>;

// ── subscriptions (Stripe) ─────────────────────────────────────────────────

/** Stripe's subscription statuses, as stored. */
export const SubscriptionStatusSchema = z.string();

export const SubscriptionSchema = z.object({
  plan: PaidPlanIdSchema.nullable(),
  status: SubscriptionStatusSchema,
  /** The plan's storage is in effect (active, trialing, or past due while Stripe retries the card). */
  entitled: z.boolean(),
  currentPeriodEnd: IsoDateSchema.nullable(),
  cancelAtPeriodEnd: z.boolean(),
});
export type Subscription = z.infer<typeof SubscriptionSchema>;

export const BillingResponse = z.object({
  /** Stripe is configured: paid plans go through Checkout instead of a request. */
  enabled: z.boolean(),
  /** The plan the user's quota amounts to (planForQuota). */
  plan: PlanIdSchema,
  quotaBytes: z.number(),
  subscription: SubscriptionSchema.nullable(),
  /** A Stripe customer exists, so the billing portal can open. */
  hasBillingAccount: z.boolean(),
});
export type BillingResponse = z.infer<typeof BillingResponse>;

export const CheckoutRequest = z.object({ plan: PaidPlanIdSchema });
export type CheckoutRequest = z.input<typeof CheckoutRequest>;

/** A Stripe-hosted page (Checkout or the billing portal) to send the browser to. */
export const RedirectResponse = z.object({ url: z.string().url() });
export type RedirectResponse = z.infer<typeof RedirectResponse>;

// ── admin ──────────────────────────────────────────────────────────────────

export const AdminStorageRequestSchema = StorageRequestSchema.extend({
  user: z.object({ id: z.string(), email: z.string(), name: z.string().nullable() }),
  usedBytes: z.number(),
  quotaBytes: z.number(),
  subscription: SubscriptionSchema.nullable(),
  resolvedBy: z.string().nullable(),
});
export type AdminStorageRequest = z.infer<typeof AdminStorageRequestSchema>;

export const AdminStorageRequestsQuery = z.object({ status: z.enum(['open', 'all']).default('open') });
export type AdminStorageRequestsQuery = z.input<typeof AdminStorageRequestsQuery>;

export const AdminStorageRequestsResponse = z.object({ requests: z.array(AdminStorageRequestSchema) });
export type AdminStorageRequestsResponse = z.infer<typeof AdminStorageRequestsResponse>;

export const AdminStorageRequestResponse = z.object({ request: AdminStorageRequestSchema });
export type AdminStorageRequestResponse = z.infer<typeof AdminStorageRequestResponse>;

// ── admin: Stripe configuration (Admin → Billing) ─────────────────────────────

/** A Stripe secret or restricted API key (live or test). */
export const STRIPE_KEY_PATTERN = /^(sk|rk)_(live|test)_[A-Za-z0-9]{8,240}$/;
/** A webhook endpoint's signing secret. */
export const STRIPE_WEBHOOK_SECRET_PATTERN = /^whsec_[A-Za-z0-9+/=_-]{8,240}$/;

export const SetBillingKeyRequest = z.object({
  secretKey: z.string().trim().regex(STRIPE_KEY_PATTERN, 'Paste a Stripe secret key: it starts with sk_live_, sk_test_, rk_live_ or rk_test_.'),
});
export type SetBillingKeyRequest = z.input<typeof SetBillingKeyRequest>;

export const SetBillingWebhookSecretRequest = z.object({
  webhookSecret: z.string().trim().regex(STRIPE_WEBHOOK_SECRET_PATTERN, 'Paste a webhook signing secret: it starts with whsec_.'),
});
export type SetBillingWebhookSecretRequest = z.input<typeof SetBillingWebhookSecretRequest>;

/** A plan's monthly price as an admin types it: more than 0.50, at most two decimals (none for JPY). */
export const PlanPriceInput = z
  .object({
    amount: z.number().min(0.5, 'At least 0.50.').max(100_000, 'At most 100,000.'),
    currency: z.enum(BILLING_CURRENCIES),
  })
  .refine((p) => Number.isInteger(Math.round(p.amount * 10 ** currencyDecimals(p.currency) * 1e6) / 1e6), {
    message: 'Too many decimals for this currency.',
    path: ['amount'],
  });
export type PlanPriceInput = z.input<typeof PlanPriceInput>;

export const SetBillingPricesRequest = z
  .object({ plus: PlanPriceInput, pro: PlanPriceInput })
  .refine((r) => r.plus.currency === r.pro.currency, { message: 'Both plans use one currency.', path: ['pro', 'currency'] });
export type SetBillingPricesRequest = z.input<typeof SetBillingPricesRequest>;

export const BillingSourceSchema = z.enum(['admin', 'env']);
export type BillingSource = z.infer<typeof BillingSourceSchema>;

/**
 * How the webhook reaches KDRIVE: `auto` an endpoint KDRIVE created in Stripe, `manual` a signing
 * secret pasted by an admin (or set in the environment), `missing` none yet (events are refused).
 */
export const BillingWebhookStatusSchema = z.enum(['auto', 'manual', 'missing']);
export type BillingWebhookStatus = z.infer<typeof BillingWebhookStatusSchema>;

/** GET /api/admin/billing (and every billing change): the configuration, never a secret. */
export const AdminBillingResponse = z.object({
  /** Where the Stripe key comes from: Admin → Billing, STRIPE_SECRET_KEY (which wins), or nowhere. */
  source: BillingSourceSchema.nullable(),
  /** Paid plans go through Checkout: a usable key, a webhook secret and a Price for both plans. */
  enabled: z.boolean(),
  mode: z.enum(['live', 'test']).nullable(),
  /** The Stripe account's display name, when the key may read it. */
  account: z.string().nullable(),
  /** "sk_live_…ab12": enough to tell keys apart. */
  keyHint: z.string().nullable(),
  /** The saved key cannot be used (e.g. the server's auth secret changed): paste it again. */
  keyError: z.string().optional(),
  /** STRIPE_SECRET_KEY is set: the key comes from the server environment (read-only here). */
  envConfigured: z.boolean(),
  webhook: z.object({
    url: z.string(),
    status: BillingWebhookStatusSchema,
    /** The signing secret is STRIPE_WEBHOOK_SECRET (read-only here). */
    fromEnv: z.boolean().optional(),
    endpointId: z.string().optional(),
    /** Why automatic setup did not happen (shown next to the manual field). */
    error: z.string().optional(),
  }),
  prices: PlanPricesSchema,
  /** A plan's Price is STRIPE_PRICE_* (its amount is shown only at Checkout). */
  pricesFromEnv: z.object({ plus: z.boolean(), pro: z.boolean() }),
  /** A plan's Price exists in Stripe for its current amount. */
  pricesReady: z.object({ plus: z.boolean(), pro: z.boolean() }),
  updatedAt: IsoDateSchema.nullable(),
  updatedBy: z.string().nullable(),
  /** Something the last change could not finish (the change itself was saved). */
  warning: z.string().optional(),
});
export type AdminBillingResponse = z.infer<typeof AdminBillingResponse>;

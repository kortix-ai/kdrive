import { z } from 'zod';
import { PAID_PLAN_IDS, PLAN_IDS } from '../plans';
import { IsoDateSchema } from './common';

export const PlanIdSchema = z.enum(PLAN_IDS);
export const PaidPlanIdSchema = z.enum(PAID_PLAN_IDS);

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

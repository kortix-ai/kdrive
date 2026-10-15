// Paid plans as Stripe monthly subscriptions.
//
// Off until Stripe is configured: under Admin → Billing, with the key pasted there or taken
// from STRIPE_SECRET_KEY (services/billing-config.ts resolves the pieces). Then /pricing sends people to Stripe Checkout and
// the billing portal instead of the storage request flow (services/storage-requests.ts), which
// stays for admins.
//
// Stripe is the source of truth. Checkout and the portal only start things; a
// subscription's state reaches us through signed webhooks, and each one is
// re-read from Stripe (events can arrive late and out of order). The plan a
// subscription is entitled to becomes the user's quota; when it ends the quota
// goes back to the default. Files are never deleted: a drive over its new quota
// simply refuses uploads, as it does today.

import { and, eq, inArray } from 'drizzle-orm';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import {
  formatBytes,
  isPaidPlan,
  planById,
  planForQuota,
  type BillingResponse,
  type PaidPlanId,
  type Subscription,
} from '@volumes/shared';
import { appUrl } from '../auth/policy';
import { db } from '../db/client';
import { bauthUser, billingAccounts, billingEvents, storageRequests, type BillingAccountRow } from '../db/schema';
import { env, type StripeConfig } from '../env';
import { audit } from '../lib/audit';
import { ApiError } from '../lib/http';
import type { SessionUser } from '../types';
import { billingEnabled, resolveBilling, type ResolvedBilling } from './billing-config';
import { getQuotaBytes, writeQuota } from './quota';
import { stripeClient, type StripeClient } from './stripe-client';

export { billingEnabled } from './billing-config';
export { setStripeClientForTests, type StripeClient } from './stripe-client';

const NOT_SET_UP = () => new ApiError(404, 'not_found', 'Billing is not set up on this server.');

/** The configuration in effect, when billing is on. */
async function config(): Promise<StripeConfig> {
  const r = await resolveBilling();
  if (!r.stripe) throw NOT_SET_UP();
  return r.stripe;
}

function stripe(cfg: StripeConfig): StripeClient {
  return stripeClient(cfg.secretKey);
}

/** Runs a Stripe call; any failure is a 502 the client can retry (never Stripe's own message). */
async function call<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[billing] ${what} failed: ${e instanceof Error ? e.message : String(e)}`);
    throw new ApiError(502, 'upstream_unavailable', 'Billing is temporarily unavailable. Try again shortly.');
  }
}

/** Statuses in which the plan's storage is in effect. past_due keeps it while Stripe retries the card. */
const ENTITLED = new Set(['active', 'trialing', 'past_due']);

function entitledPlan(row: Pick<BillingAccountRow, 'plan' | 'status'> | undefined | null): PaidPlanId | null {
  return row?.plan && row.status && ENTITLED.has(row.status) ? row.plan : null;
}

export function toSubscription(row: BillingAccountRow | undefined | null): Subscription | null {
  if (!row?.status) return null;
  return {
    plan: row.plan ?? null,
    status: row.status,
    entitled: entitledPlan(row) !== null,
    currentPeriodEnd: row.currentPeriodEnd ? row.currentPeriodEnd.toISOString() : null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  };
}

async function accountOf(userId: string): Promise<BillingAccountRow | undefined> {
  const [row] = await db.select().from(billingAccounts).where(eq(billingAccounts.userId, userId)).limit(1);
  return row;
}

/** Subscriptions of several users at once (admin lists). */
export async function subscriptionsFor(userIds: string[]): Promise<Map<string, Subscription>> {
  if (!userIds.length) return new Map();
  const rows = await db.select().from(billingAccounts).where(inArray(billingAccounts.userId, userIds));
  const out = new Map<string, Subscription>();
  for (const r of rows) {
    const s = toSubscription(r);
    if (s) out.set(r.userId, s);
  }
  return out;
}

/** GET /api/billing: the plan the quota amounts to, and the subscription behind it if any. */
export async function getBilling(userId: string): Promise<BillingResponse> {
  const [quotaBytes, row] = await Promise.all([getQuotaBytes(userId), accountOf(userId)]);
  return {
    enabled: await billingEnabled(),
    plan: planForQuota(quotaBytes).id,
    quotaBytes,
    subscription: toSubscription(row),
    hasBillingAccount: !!row,
  };
}

/** The user's Stripe customer, created on first use (one per user, reused by every checkout). */
async function ensureCustomer(cfg: StripeConfig, user: SessionUser): Promise<string> {
  const existing = await accountOf(user.id);
  if (existing) return existing.stripeCustomerId;
  const customer = await call('customers.create', () =>
    stripe(cfg).customers.create({ email: user.email, name: user.name ?? undefined, metadata: { userId: user.id } }),
  );
  await db.insert(billingAccounts).values({ userId: user.id, stripeCustomerId: customer.id }).onConflictDoNothing();
  // Two checkouts at once: the first row wins and the spare customer is never used.
  return (await accountOf(user.id))!.stripeCustomerId;
}

/** POST /api/billing/checkout: a Checkout Session for a monthly subscription to `plan`. */
export async function createCheckout(user: SessionUser, plan: PaidPlanId): Promise<string> {
  const cfg = await config();
  const current = entitledPlan(await accountOf(user.id));
  if (current) {
    throw new ApiError(409, 'conflict', `You already subscribe to ${planById(current).name}. Change or cancel it from Manage billing.`);
  }
  const customer = await ensureCustomer(cfg, user);
  const session = await call('checkout.sessions.create', () =>
    stripe(cfg).checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: user.id,
      line_items: [{ price: cfg.prices[plan], quantity: 1 }],
      metadata: { userId: user.id, plan },
      subscription_data: { metadata: { userId: user.id, plan } },
      success_url: appUrl('/pricing?checkout=success'),
      cancel_url: appUrl('/pricing?checkout=canceled'),
    }),
  );
  if (!session.url) throw new ApiError(502, 'upstream_unavailable', 'Billing is temporarily unavailable. Try again shortly.');
  return session.url;
}

/** POST /api/billing/portal: Stripe's billing portal (change plan or card, cancel, invoices). */
export async function createPortal(user: SessionUser): Promise<string> {
  const cfg = await config();
  const row = await accountOf(user.id);
  if (!row) throw new ApiError(404, 'not_found', 'There is no billing account to manage yet.');
  const session = await call('billingPortal.sessions.create', () =>
    stripe(cfg).billingPortal.sessions.create({ customer: row.stripeCustomerId, return_url: appUrl('/pricing') }),
  );
  return session.url;
}

/**
 * Account deletion: stops the subscription so nobody keeps paying for a drive that is gone.
 * Throws when Stripe refuses, so the deletion stops before any row is removed and can be retried.
 */
export async function cancelSubscriptionForDeletion(userId: string): Promise<void> {
  const row = await accountOf(userId);
  if (!row?.subscriptionId || !row.status || row.status === 'canceled' || row.status === 'incomplete_expired') return;
  // A key is enough to cancel, even while billing is otherwise incomplete.
  const { secretKey } = await resolveBilling();
  if (!secretKey) {
    console.warn(`[billing] account ${userId} has subscription ${row.subscriptionId} but Stripe is not configured; cancel it in the dashboard`);
    return;
  }
  await call('subscriptions.cancel', () => stripeClient(secretKey).subscriptions.cancel(row.subscriptionId!));
}

// ── webhooks ─────────────────────────────────────────────────────────────────

const idOf = (v: string | { id: string } | null | undefined): string | null => (typeof v === 'string' ? v : (v?.id ?? null));

/**
 * The plan a subscription pays for: the plan KDRIVE marked on its first item's Price (every
 * Price made from Admin → Billing, old amounts included), else a known plan Price id (current
 * or from STRIPE_PRICE_*), else the plan we put in the subscription's metadata at Checkout.
 */
function planOf(sub: Stripe.Subscription, r: ResolvedBilling): PaidPlanId | null {
  const price = sub.items?.data?.[0]?.price;
  const marked = price?.metadata?.kdrive_plan;
  if (marked && isPaidPlan(marked)) return marked;
  const known = price?.id ? r.priceIds.get(price.id) : undefined;
  if (known) return known;
  const meta = sub.metadata?.plan;
  return meta && isPaidPlan(meta) ? meta : null;
}

function periodEnd(sub: Stripe.Subscription): Date | null {
  // Newer API versions keep the period on each item.
  const s = sub.items?.data?.[0]?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof s === 'number' ? new Date(s * 1000) : null;
}

/**
 * Brings one subscription's state into billing_accounts and, when the plan it entitles
 * changes, the user's quota. Serialised per user by a row lock.
 */
async function syncSubscription(sub: Stripe.Subscription, hintUserId: string | null, r: ResolvedBilling): Promise<void> {
  const customerId = idOf(sub.customer);
  if (!customerId) return;
  await db.transaction(async (tx) => {
    let [row] = await tx.select().from(billingAccounts).where(eq(billingAccounts.stripeCustomerId, customerId)).for('update');
    if (!row) {
      // A customer made outside Checkout (the dashboard): link it through the user id we set as metadata.
      const userId = hintUserId ?? sub.metadata?.userId ?? null;
      const [u] = userId ? await tx.select({ id: bauthUser.id }).from(bauthUser).where(eq(bauthUser.id, userId)) : [];
      if (!u) {
        console.warn(`[billing] subscription ${sub.id}: no user for customer ${customerId}, ignored`);
        return;
      }
      await tx.insert(billingAccounts).values({ userId: u.id, stripeCustomerId: customerId }).onConflictDoNothing();
      [row] = await tx.select().from(billingAccounts).where(eq(billingAccounts.userId, u.id)).for('update');
      if (!row || row.stripeCustomerId !== customerId) return;
    }
    const plan = planOf(sub, r);
    const entitled = ENTITLED.has(sub.status);
    // An older subscription ending must not undo the one in effect now.
    if (row.subscriptionId && row.subscriptionId !== sub.id && !entitled && entitledPlan(row)) return;

    const before = entitledPlan(row);
    const after = entitled ? plan : null;
    await tx
      .update(billingAccounts)
      .set({
        subscriptionId: sub.id,
        plan,
        status: sub.status,
        currentPeriodEnd: periodEnd(sub),
        cancelAtPeriodEnd: !!sub.cancel_at_period_end,
        updatedAt: new Date(),
      })
      .where(eq(billingAccounts.userId, row.userId));
    if (before === after) return;

    const from = await getQuotaBytes(row.userId, tx);
    const to = after ? planById(after).storageBytes : env.defaultQuotaBytes;
    await writeQuota(row.userId, to, tx);
    if (after) {
      // Paying for a plan answers an open request for it (or for a smaller one).
      const open = await tx
        .select({ id: storageRequests.id, plan: storageRequests.plan })
        .from(storageRequests)
        .where(and(eq(storageRequests.userId, row.userId), eq(storageRequests.status, 'open')));
      const answered = open.filter((r) => planById(r.plan).storageBytes <= to).map((r) => r.id);
      if (answered.length) {
        await tx.update(storageRequests).set({ status: 'granted', resolvedAt: new Date() }).where(inArray(storageRequests.id, answered));
      }
    }
    const [u] = await tx.select({ email: bauthUser.email }).from(bauthUser).where(eq(bauthUser.id, row.userId));
    await audit(null, {
      kind: 'billing.plan_change',
      userId: row.userId,
      actorEmail: u?.email ?? null,
      target: after ? planById(after).name : 'Free',
      meta: { from, to, plan: after ?? 'free', status: sub.status, subscriptionId: sub.id },
    });
    console.info(`[billing] ${u?.email ?? row.userId}: ${before ?? 'free'} → ${after ?? 'free'} (${sub.status}, quota ${formatBytes(to)})`);
  });
}

async function syncById(r: ResolvedBilling, client: StripeClient, subscriptionId: string | null, hintUserId: string | null = null): Promise<void> {
  if (!subscriptionId) return;
  const sub = await call('subscriptions.retrieve', () => client.subscriptions.retrieve(subscriptionId));
  await syncSubscription(sub, hintUserId, r);
}

/** The subscription an invoice belongs to (moved under `parent` in newer API versions). */
function invoiceSubscription(inv: Stripe.Invoice): string | null {
  const parent = idOf(inv.parent?.subscription_details?.subscription ?? null);
  return parent ?? idOf((inv as unknown as { subscription?: string | { id: string } | null }).subscription ?? null);
}

/**
 * POST /api/billing/webhook. Verifies the signature over the raw body, then handles each
 * event once: its id is recorded first, and removed again if handling fails so Stripe's
 * retry runs it. Unknown event types are acknowledged and ignored. The events acted on are
 * WEBHOOK_EVENTS (services/stripe-client.ts), what an endpoint made from Admin → Billing sends.
 */
export async function handleWebhook(c: Context, rawBody: string): Promise<{ received: true; duplicate?: true }> {
  const r = await resolveBilling();
  if (!r.stripe) throw NOT_SET_UP();
  const client = stripe(r.stripe);
  const sig = c.req.header('stripe-signature');
  if (!sig) throw new ApiError(400, 'bad_request', 'Missing Stripe signature.');
  let event: Stripe.Event | null = null;
  // The endpoint's secret first; STRIPE_WEBHOOK_SECRET too, so an endpoint set up by env keeps working.
  for (const secret of r.webhookSecrets) {
    try {
      event = await client.webhooks.constructEventAsync(rawBody, sig, secret);
      break;
    } catch {
      /* try the next secret */
    }
  }
  if (!event) throw new ApiError(400, 'bad_request', 'Invalid Stripe signature.');
  const [fresh] = await db.insert(billingEvents).values({ id: event.id, type: event.type }).onConflictDoNothing().returning({ id: billingEvents.id });
  if (!fresh) return { received: true, duplicate: true };
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        if (s.mode === 'subscription') await syncById(r, client, idOf(s.subscription), s.client_reference_id ?? null);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncById(r, client, event.data.object.id);
        break;
      case 'invoice.payment_failed':
        await syncById(r, client, invoiceSubscription(event.data.object));
        break;
    }
  } catch (e) {
    await db.delete(billingEvents).where(eq(billingEvents.id, event.id));
    throw e;
  }
  return { received: true };
}

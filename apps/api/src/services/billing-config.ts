// Where billing's Stripe configuration comes from, and Admin → Billing, which sets it.
//
// An admin pastes one Stripe secret key and types the Plus and Pro monthly prices; KDRIVE
// does the rest: it checks the key, creates the webhook endpoint (and keeps its signing
// secret), and makes a Product per paid plan with a monthly Price for the amount. All of it
// lives in app_settings under one key, the secrets sealed (lib/secret-box.ts).
//
// Precedence, piece by piece: the environment wins over what is saved here. STRIPE_SECRET_KEY,
// when set, is the key (the paste field is hidden and a saved key is ignored); with it alone,
// Admin → Billing still creates the webhook and the Prices, stored here. STRIPE_WEBHOOK_SECRET
// and STRIPE_PRICE_PLUS / _PRO, read only next to that key, override the saved webhook secret
// and Price ids. Billing is on once a key, a webhook secret and both Prices resolve. Prices in
// Stripe never change: a new amount is a new Price, and people already subscribed keep paying
// the one they signed up for.

import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import {
  formatBytes,
  NO_PLAN_PRICES,
  PAID_PLAN_IDS,
  planById,
  toMinorUnits,
  type AdminBillingResponse,
  type BillingWebhookStatus,
  type PaidPlanId,
  type PlanPrice,
  type PlanPrices,
  type SetBillingPricesRequest,
} from '@volumes/shared';
import { appUrl } from '../auth/policy';
import { db } from '../db/client';
import { appSettings } from '../db/schema';
import { env, type StripeConfig } from '../env';
import { audit } from '../lib/audit';
import { ApiError } from '../lib/http';
import { open, seal } from '../lib/secret-box';
import type { SessionUser } from '../types';
import { STRIPE_API_VERSION, stripeClient, stripeErrorKind, stripeErrorMessage, WEBHOOK_EVENTS, type StripeClient } from './stripe-client';

const SETTING = 'billing';

interface StoredPrice extends PlanPrice {
  /** The Stripe Price for this amount, once created (null while no key is connected). */
  priceId: string | null;
}

/** app_settings['billing']: secrets are sealed boxes. */
interface StoredBilling {
  secretKey?: string | null;
  keyHint?: string | null;
  mode?: 'live' | 'test' | null;
  account?: string | null;
  webhook?: {
    status?: 'auto' | 'manual' | null;
    endpointId?: string | null;
    secret?: string | null;
    error?: string | null;
  } | null;
  prices?: Partial<Record<PaidPlanId, StoredPrice | null>> | null;
}

interface Row {
  value: StoredBilling;
  updatedAt: Date;
  updatedBy: string | null;
}

/** The configuration in effect. */
export interface ResolvedBilling {
  /** Where the key comes from. */
  source: 'admin' | 'env' | null;
  /** Everything Checkout and the webhook need, or null while billing is off. */
  stripe: StripeConfig | null;
  /** The key in use (billing may still be off for want of a webhook secret or prices). */
  secretKey: string | null;
  /** The webhook secret in use, and where it comes from. */
  webhookSecret: string | null;
  webhookFrom: 'admin' | 'env' | null;
  /** Signatures are checked against these, in order (env and saved, when both exist). */
  webhookSecrets: string[];
  /** The Price each plan sells at now, and whether STRIPE_PRICE_* set it. */
  planPriceIds: Record<PaidPlanId, string | null>;
  pricesFromEnv: Record<PaidPlanId, boolean>;
  /** Every Price id known to be a plan's (saved and env), for mapping a subscription to its plan. */
  priceIds: Map<string, PaidPlanId>;
  /** The paid plans' public prices (null for a plan whose Price comes from the environment). */
  prices: PlanPrices;
  keyError?: string;
  row: Row | null;
}

// ── cache ────────────────────────────────────────────────────────────────────

/** Other API processes see a change within this long; this one at once. */
const CACHE_MS = 30_000;
let cached: { at: number; row: Promise<Row | null> } | null = null;

export function clearBillingConfigCache(): void {
  cached = null;
  envAccounts.clear();
}

function loadRow(): Promise<Row | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.row;
  const row = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, SETTING))
    .then(([r]) => (r ? { value: r.value as StoredBilling, updatedAt: r.updatedAt, updatedBy: r.updatedBy } : null));
  cached = { at: Date.now(), row };
  row.catch(() => clearBillingConfigCache());
  return row;
}

async function saveRow(value: StoredBilling, by: SessionUser): Promise<void> {
  const now = new Date();
  await db
    .insert(appSettings)
    .values({ key: SETTING, value: value as Record<string, unknown>, updatedAt: now, updatedBy: by.email })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: value as Record<string, unknown>, updatedAt: now, updatedBy: by.email } });
  clearBillingConfigCache();
}

// ── resolution ───────────────────────────────────────────────────────────────

const KEY_UNREADABLE = "The saved Stripe key can't be read: this server's auth secret changed since it was saved. Paste the key again.";
const HOOK_UNREADABLE = "The saved webhook signing secret can't be read: this server's auth secret changed since it was saved. Set up the webhook again.";

function storedPrices(v: StoredBilling | undefined): PlanPrices {
  const out: PlanPrices = { ...NO_PLAN_PRICES };
  for (const id of PAID_PLAN_IDS) {
    const p = v?.prices?.[id];
    if (p) out[id] = { amount: p.amount, currency: p.currency };
  }
  return out;
}

export async function resolveBilling(): Promise<ResolvedBilling> {
  const row = await loadRow();
  const v = row?.value;
  const envKey = env.stripe?.secretKey || null;
  const savedKey = v?.secretKey ? open(v.secretKey) : null;
  // A saved key that no longer opens matters only when the environment has none.
  const keyError = v?.secretKey && !savedKey && !envKey ? KEY_UNREADABLE : undefined;
  const secretKey = envKey ?? savedKey;

  const envHook = (envKey && env.stripe?.webhookSecret) || null;
  const savedHook = v?.webhook?.secret ? open(v.webhook.secret) : null;
  const webhookSecret = envHook ?? savedHook;

  const priceIds = new Map<string, PaidPlanId>();
  const planPriceIds: Record<PaidPlanId, string | null> = { plus: null, pro: null };
  const pricesFromEnv: Record<PaidPlanId, boolean> = { plus: false, pro: false };
  const prices: PlanPrices = { ...NO_PLAN_PRICES };
  for (const id of PAID_PLAN_IDS) {
    const fromEnv = (envKey && env.stripe?.prices?.[id]) || null;
    const saved = v?.prices?.[id] ?? null;
    if (saved?.priceId) priceIds.set(saved.priceId, id);
    if (fromEnv) priceIds.set(fromEnv, id);
    planPriceIds[id] = fromEnv ?? saved?.priceId ?? null;
    pricesFromEnv[id] = !!fromEnv;
    // The amount behind an env Price is not known here: Checkout shows it.
    prices[id] = !fromEnv && saved ? { amount: saved.amount, currency: saved.currency } : null;
  }

  return {
    source: envKey ? 'env' : savedKey ? 'admin' : null,
    stripe:
      secretKey && webhookSecret && planPriceIds.plus && planPriceIds.pro
        ? { secretKey, webhookSecret, prices: { plus: planPriceIds.plus, pro: planPriceIds.pro } }
        : null,
    secretKey,
    webhookSecret,
    webhookFrom: envHook ? 'env' : savedHook ? 'admin' : null,
    webhookSecrets: [...new Set([envHook, savedHook].filter((s): s is string => !!s))],
    planPriceIds,
    pricesFromEnv,
    priceIds,
    prices,
    keyError,
    row,
  };
}

/** Billing is on: a usable key, a webhook secret and a Price for both paid plans. */
export async function billingEnabled(): Promise<boolean> {
  return (await resolveBilling()).stripe !== null;
}

/** What /api/config hands out: on or off, and the paid plans' prices. */
export async function publicBilling(): Promise<{ enabled: boolean; prices: PlanPrices }> {
  const r = await resolveBilling();
  return { enabled: r.stripe !== null, prices: r.prices };
}

// ── admin view ───────────────────────────────────────────────────────────────

const webhookUrl = () => appUrl('/api/billing/webhook');

function keyHint(key: string): string {
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

function keyMode(key: string): 'live' | 'test' {
  return key.includes('_live_') ? 'live' : 'test';
}

/** The account a key in the environment belongs to (asked once per key; null when Stripe will not say). */
const envAccounts = new Map<string, string | null>();

async function envAccount(key: string): Promise<string | null> {
  if (envAccounts.has(key)) return envAccounts.get(key)!;
  try {
    const { account } = await inspectKey(stripeClient(key));
    envAccounts.set(key, account);
    return account;
  } catch {
    return null;
  }
}

/** GET /api/admin/billing. */
export async function adminBillingView(warning?: string): Promise<AdminBillingResponse> {
  const r = await resolveBilling();
  const v = r.row?.value;
  const status: BillingWebhookStatus = !r.webhookSecret ? 'missing' : r.webhookFrom === 'admin' && v?.webhook?.status === 'auto' ? 'auto' : 'manual';
  return {
    source: r.source,
    enabled: r.stripe !== null,
    mode: r.secretKey ? keyMode(r.secretKey) : null,
    account: r.source === 'env' ? await envAccount(r.secretKey!) : r.source === 'admin' ? (v?.account ?? null) : null,
    keyHint: r.secretKey ? keyHint(r.secretKey) : null,
    ...(r.keyError ? { keyError: r.keyError } : {}),
    envConfigured: !!env.stripe?.secretKey,
    webhook: {
      url: webhookUrl(),
      status,
      ...(r.webhookFrom === 'env' ? { fromEnv: true } : {}),
      ...(status === 'auto' && v?.webhook?.endpointId ? { endpointId: v.webhook.endpointId } : {}),
      ...(status === 'missing' && r.secretKey ? { error: v?.webhook?.error ?? (v?.webhook?.secret ? HOOK_UNREADABLE : undefined) } : {}),
    },
    prices: r.prices,
    pricesFromEnv: r.pricesFromEnv,
    pricesReady: { plus: !!r.planPriceIds.plus, pro: !!r.planPriceIds.pro },
    updatedAt: r.row?.updatedAt.toISOString() ?? null,
    updatedBy: r.row?.updatedBy ?? null,
    ...(warning ? { warning } : {}),
  };
}

// ── Stripe setup ─────────────────────────────────────────────────────────────

/** Checks a key against Stripe and names its account (a restricted key may not read it: null). */
async function inspectKey(client: StripeClient): Promise<{ account: string | null }> {
  try {
    const a = await client.accounts.retrieveCurrent();
    return { account: a.settings?.dashboard?.display_name || a.business_profile?.name || a.email || null };
  } catch (e) {
    const kind = stripeErrorKind(e);
    if (kind === 'auth') throw new ApiError(400, 'bad_request', 'Stripe did not accept this key. Copy the whole secret key from the Stripe dashboard and try again.');
    if (kind === 'permission') return { account: null };
    console.warn(`[billing] key check failed: ${stripeErrorMessage(e)}`);
    throw new ApiError(502, 'upstream_unavailable', 'Could not reach Stripe to check the key. Try again shortly.');
  }
}

/** Stripe cannot deliver to this machine or a private name. */
function isPrivateUrl(url: string): boolean {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '::1' ||
    host === '0.0.0.0' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

type WebhookSetup = { status: 'auto'; endpointId: string; secret: string } | { status: 'missing'; error: string };

/**
 * Creates KDRIVE's webhook endpoint at /api/billing/webhook and removes the ones it made
 * before (the previous id, and any endpoint for the same URL marked as KDRIVE's), so a
 * replaced key or a retry never leaves duplicates. The new one is created first, so a failure
 * leaves the old one working.
 */
async function setupWebhook(client: StripeClient, previousId: string | null): Promise<WebhookSetup> {
  const url = webhookUrl();
  if (isPrivateUrl(url)) {
    return {
      status: 'missing',
      error: `${url} is not reachable from the internet, so Stripe cannot send events to it. For local testing, run \`stripe listen --forward-to ${url}\` and paste the signing secret it prints.`,
    };
  }
  let created: { id: string; secret?: string };
  try {
    created = await client.webhookEndpoints.create({
      url,
      enabled_events: [...WEBHOOK_EVENTS],
      api_version: STRIPE_API_VERSION,
      description: 'KDRIVE billing (created from Admin → Billing)',
      metadata: { kdrive: 'billing' },
    });
  } catch (e) {
    console.warn(`[billing] webhook endpoint not created: ${stripeErrorMessage(e)}`);
    return {
      status: 'missing',
      error: `Stripe did not create the webhook endpoint (${stripeErrorMessage(e)}). Add an endpoint for ${url} in the Stripe dashboard and paste its signing secret.`,
    };
  }
  if (!created.secret) {
    await client.webhookEndpoints.del(created.id).catch(() => {});
    return { status: 'missing', error: `Stripe did not return the endpoint's signing secret. Add an endpoint for ${url} in the Stripe dashboard and paste its signing secret.` };
  }
  try {
    const { data } = await client.webhookEndpoints.list({ limit: 100 });
    for (const ep of data) {
      if (ep.id === created.id) continue;
      if (ep.id === previousId || (ep.url === url && ep.metadata?.kdrive)) await client.webhookEndpoints.del(ep.id).catch(() => {});
    }
  } catch (e) {
    console.warn(`[billing] old webhook endpoints not cleaned up: ${stripeErrorMessage(e)}`);
  }
  return { status: 'auto', endpointId: created.id, secret: created.secret };
}

/**
 * The monthly Price for `plan` at `price`: KDRIVE's Product for the plan (id `kdrive_<plan>`,
 * made if missing), then an active monthly Price with this amount and currency (reused when one
 * exists, otherwise created). The current one carries the lookup key `kdrive_<plan>_monthly`.
 */
async function ensurePrice(client: StripeClient, plan: PaidPlanId, price: PlanPrice): Promise<string> {
  const product = `kdrive_${plan}`;
  const name = `KDRIVE ${planById(plan).name}`;
  const metadata = { kdrive_plan: plan };
  try {
    const p = await client.products.retrieve(product);
    if (!p.active) await client.products.update(product, { active: true });
  } catch (e) {
    if (stripeErrorKind(e) !== 'missing') throw e;
    await client.products.create({ id: product, name, description: `${formatBytes(planById(plan).storageBytes)} of storage, billed monthly.`, metadata });
  }
  const unit = toMinorUnits(price.amount, price.currency);
  const currency = price.currency.toLowerCase();
  const lookup = `kdrive_${plan}_monthly`;
  const { data } = await client.prices.list({ product, active: true, type: 'recurring', limit: 100 });
  const same = data.find(
    (p) => p.unit_amount === unit && p.currency === currency && p.recurring?.interval === 'month' && (p.recurring.interval_count ?? 1) === 1,
  );
  if (same) {
    if (same.lookup_key !== lookup || same.metadata?.kdrive_plan !== plan) {
      await client.prices.update(same.id, { lookup_key: lookup, transfer_lookup_key: true, metadata });
    }
    return same.id;
  }
  const created = await client.prices.create({
    product,
    unit_amount: unit,
    currency,
    recurring: { interval: 'month' },
    lookup_key: lookup,
    transfer_lookup_key: true,
    nickname: `${name} monthly`,
    metadata,
  });
  return created.id;
}

/** Prices for every plan that has an amount; on failure the ids stay null and the error is returned. */
async function ensurePrices(client: StripeClient, prices: StoredBilling['prices']): Promise<{ prices: StoredBilling['prices']; error?: string }> {
  const out: Partial<Record<PaidPlanId, StoredPrice | null>> = { ...(prices ?? {}) };
  try {
    for (const id of PAID_PLAN_IDS) {
      const p = out[id];
      if (p) out[id] = { amount: p.amount, currency: p.currency, priceId: await ensurePrice(client, id, p) };
    }
    return { prices: out };
  } catch (e) {
    console.warn(`[billing] plan prices not created: ${stripeErrorMessage(e)}`);
    return { prices: out, error: stripeErrorMessage(e) };
  }
}

function withoutPriceIds(prices: StoredBilling['prices']): StoredBilling['prices'] {
  const out: Partial<Record<PaidPlanId, StoredPrice | null>> = {};
  for (const id of PAID_PLAN_IDS) {
    const p = prices?.[id];
    out[id] = p ? { amount: p.amount, currency: p.currency, priceId: null } : null;
  }
  return out;
}

/** The saved configuration, the key in use (environment first) and whether it is the environment's. */
async function current(): Promise<{ v: StoredBilling; key: string | null; savedKey: string | null; envKey: string | null }> {
  const row = await loadRow();
  const v = row?.value ?? {};
  const savedKey = v.secretKey ? open(v.secretKey) : null;
  const envKey = env.stripe?.secretKey || null;
  return { v, key: envKey ?? savedKey, savedKey, envKey };
}

function needKey(key: string | null): asserts key is string {
  if (!key) throw new ApiError(409, 'conflict', 'Connect a Stripe key first.');
}

const KEY_FROM_ENV = "This server's Stripe key comes from STRIPE_SECRET_KEY in its environment: change or remove it there.";

function refuseEnvWebhook(): void {
  if (env.stripe?.secretKey && env.stripe.webhookSecret) {
    throw new ApiError(409, 'conflict', "The webhook signing secret comes from STRIPE_WEBHOOK_SECRET in this server's environment: change or remove it there.");
  }
}

/** The stored webhook after an automatic setup with `key` (a pasted secret is kept when setup is not possible). */
async function autoWebhook(v: StoredBilling, key: string): Promise<{ webhook: StoredBilling['webhook']; status: 'auto' | 'manual' | 'missing' }> {
  const hook = await setupWebhook(stripeClient(key), v.webhook?.endpointId ?? null);
  if (hook.status === 'auto') return { webhook: { status: 'auto', endpointId: hook.endpointId, secret: seal(hook.secret), error: null }, status: 'auto' };
  const keepManual = v.webhook?.status === 'manual' && !!v.webhook.secret && open(v.webhook.secret) !== null;
  return keepManual
    ? { webhook: { ...v.webhook, error: null }, status: 'manual' }
    : { webhook: { status: null, endpointId: null, secret: null, error: hook.error }, status: 'missing' };
}

// ── admin changes ────────────────────────────────────────────────────────────

/** PUT /api/admin/billing/key: connects (or replaces) the Stripe key, then sets up the webhook and the prices. */
export async function adminSetKey(c: Context, admin: SessionUser, secretKey: string): Promise<AdminBillingResponse> {
  const { v, savedKey: previous, envKey } = await current();
  if (envKey) throw new ApiError(409, 'conflict', KEY_FROM_ENV);
  const client = stripeClient(secretKey);
  const { account } = await inspectKey(client);
  const mode = keyMode(secretKey);
  const replaced = !!previous && previous !== secretKey;

  const { webhook, status } = env.stripe?.webhookSecret ? { webhook: v.webhook, status: 'manual' as const } : await autoWebhook(v, secretKey);
  // The endpoint made with the old key lives in that key's account: remove it there (best effort).
  if (replaced && v.webhook?.endpointId && status === 'auto' && webhook?.endpointId !== v.webhook.endpointId) {
    await stripeClient(previous!).webhookEndpoints.del(v.webhook.endpointId).catch(() => {});
  }
  const ensured = await ensurePrices(client, withoutPriceIds(v.prices));
  await saveRow({ ...v, secretKey: seal(secretKey), keyHint: keyHint(secretKey), mode, account, webhook, prices: ensured.prices }, admin);
  await audit(c, { kind: 'billing.config_key', userId: admin.id, target: keyHint(secretKey), meta: { mode, account, webhook: status, replaced } });
  return adminBillingView(ensured.error ? `The plan prices could not be created in Stripe (${ensured.error}). Save the prices again.` : undefined);
}

/**
 * PUT /api/admin/billing/prices: the plans' monthly prices, and their Stripe Prices when a key is
 * in use. With a key and no webhook secret yet (a key from the environment), the webhook endpoint
 * is set up too, so saving the prices is the one step left.
 */
export async function adminSetPrices(c: Context, admin: SessionUser, req: SetBillingPricesRequest): Promise<AdminBillingResponse> {
  const { v, key, envKey } = await current();
  if (envKey && (env.stripe?.prices?.plus || env.stripe?.prices?.pro)) {
    throw new ApiError(409, 'conflict', "The plan prices come from STRIPE_PRICE_PLUS / STRIPE_PRICE_PRO in this server's environment: change or remove them there.");
  }
  const next: Record<PaidPlanId, StoredPrice> = { plus: { ...req.plus, priceId: null }, pro: { ...req.pro, priceId: null } };
  for (const id of PAID_PLAN_IDS) {
    const before = v.prices?.[id];
    if (before?.priceId && before.amount === next[id].amount && before.currency === next[id].currency) next[id].priceId = before.priceId;
  }
  let webhook = v.webhook;
  if (key) {
    const client = stripeClient(key);
    try {
      for (const id of PAID_PLAN_IDS) if (!next[id].priceId) next[id].priceId = await ensurePrice(client, id, next[id]);
    } catch (e) {
      console.warn(`[billing] plan prices not created: ${stripeErrorMessage(e)}`);
      throw new ApiError(502, 'upstream_unavailable', `Stripe did not take the prices: ${stripeErrorMessage(e)}`);
    }
    const hasSecret = !!(envKey && env.stripe?.webhookSecret) || (!!v.webhook?.secret && open(v.webhook.secret) !== null);
    if (!hasSecret) webhook = (await autoWebhook(v, key)).webhook;
  }
  await saveRow({ ...v, webhook, prices: next }, admin);
  await audit(c, {
    kind: 'billing.config_prices',
    userId: admin.id,
    target: PAID_PLAN_IDS.map((id) => `${planById(id).name} ${next[id].amount} ${next[id].currency}`).join(', '),
    meta: Object.fromEntries(PAID_PLAN_IDS.map((id) => [id, { amount: next[id].amount, currency: next[id].currency, priceId: next[id].priceId }])),
  });
  return adminBillingView();
}

/** PUT /api/admin/billing/webhook-secret: a signing secret pasted by hand (an endpoint made elsewhere, or `stripe listen`). */
export async function adminSetWebhookSecret(c: Context, admin: SessionUser, webhookSecret: string): Promise<AdminBillingResponse> {
  const { v, key } = await current();
  needKey(key);
  refuseEnvWebhook();
  // An endpoint KDRIVE made is replaced by the pasted secret: remove it so it stops sending events nobody checks.
  if (v.webhook?.status === 'auto' && v.webhook.endpointId) await stripeClient(key).webhookEndpoints.del(v.webhook.endpointId).catch(() => {});
  await saveRow({ ...v, webhook: { status: 'manual', endpointId: null, secret: seal(webhookSecret), error: null } }, admin);
  await audit(c, { kind: 'billing.config_webhook', userId: admin.id, target: 'manual', meta: { status: 'manual' } });
  return adminBillingView();
}

/** POST /api/admin/billing/webhook: sets up the webhook endpoint automatically (again, e.g. once the server is public). */
export async function adminRetryWebhook(c: Context, admin: SessionUser): Promise<AdminBillingResponse> {
  const { v, key } = await current();
  needKey(key);
  refuseEnvWebhook();
  const hook = await setupWebhook(stripeClient(key), v.webhook?.endpointId ?? null);
  if (hook.status === 'missing') {
    // Keep what works (a pasted secret); only remember why.
    await saveRow({ ...v, webhook: { ...(v.webhook ?? {}), error: hook.error } }, admin);
    await audit(c, { kind: 'billing.config_webhook', userId: admin.id, target: 'auto', meta: { status: 'failed' } });
    return adminBillingView(hook.error);
  }
  await saveRow({ ...v, webhook: { status: 'auto', endpointId: hook.endpointId, secret: seal(hook.secret), error: null } }, admin);
  await audit(c, { kind: 'billing.config_webhook', userId: admin.id, target: 'auto', meta: { status: 'auto', endpointId: hook.endpointId } });
  return adminBillingView();
}

/**
 * DELETE /api/admin/billing: turns billing off. Forgets the saved key and webhook secret and
 * removes KDRIVE's webhook endpoint from Stripe (best effort). The prices stay, so connecting
 * again finds the same Stripe Prices. Subscriptions are not touched. A key from the
 * environment cannot be disconnected here.
 */
export async function adminDisconnect(c: Context, admin: SessionUser): Promise<AdminBillingResponse> {
  const { v, savedKey, envKey } = await current();
  if (envKey) throw new ApiError(409, 'conflict', KEY_FROM_ENV);
  if (!v.secretKey) return adminBillingView();
  if (savedKey && v.webhook?.endpointId) await stripeClient(savedKey).webhookEndpoints.del(v.webhook.endpointId).catch(() => {});
  await saveRow({ prices: withoutPriceIds(v.prices) }, admin);
  await audit(c, { kind: 'billing.config_disconnect', userId: admin.id, target: v.keyHint ?? null, meta: { mode: v.mode ?? null } });
  return adminBillingView();
}

import { DEFAULT_QUOTA_BYTES, GiB, TiB } from './constants';

// Storage plans. The one place their names, sizes and selling points live: the
// pricing page renders this list, the API grants `storageBytes` when a request
// is granted or a subscription starts. The paid plans' prices are not set here:
// an admin types them under Admin → Billing (the API creates the matching
// monthly Prices in Stripe) and /api/config hands them out; `withPrices` lays
// them over this list. `price: null` renders as "Price coming soon".

export const PLAN_IDS = ['free', 'plus', 'pro'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
/** Plans that cost money: the ones a person can request or subscribe to. */
export const PAID_PLAN_IDS = ['plus', 'pro'] as const satisfies readonly PlanId[];
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

export interface PlanPrice {
  /** Per month, in the currency's major unit (9 = 9.00). */
  amount: number;
  /** ISO 4217, e.g. "USD". */
  currency: string;
}

export interface Plan {
  id: PlanId;
  name: string;
  storageBytes: number;
  /** Null until the price is decided. */
  price: PlanPrice | null;
  /** One line under the name. */
  tagline: string;
  features: string[];
}

export const PLANS: readonly Plan[] = [
  {
    id: 'free',
    name: 'Free',
    storageBytes: DEFAULT_QUOTA_BYTES,
    price: { amount: 0, currency: 'USD' },
    tagline: 'Everything KDRIVE does, for one person getting started.',
    features: ['10 GB of storage', 'Every change kept as a version', 'Share links, live or pinned', 'AI agents through MCP'],
  },
  {
    id: 'plus',
    name: 'Plus',
    storageBytes: 100 * GiB,
    price: null,
    tagline: 'Room for a working archive: projects, photos, years of drafts.',
    features: ['100 GB of storage', 'Everything in Free', 'More room for checkpoints and history', 'Shared drives with editors and viewers'],
  },
  {
    id: 'pro',
    name: 'Pro',
    storageBytes: 1 * TiB,
    price: null,
    tagline: 'For large media libraries and drives several people work in.',
    features: ['1 TB of storage', 'Everything in Plus', 'Room for large media and datasets', 'Priority help when something goes wrong'],
  },
];

/** A paid plan's price as an admin set it, or null while it is not set. */
export type PlanPrices = Record<PaidPlanId, PlanPrice | null>;

export const NO_PLAN_PRICES: PlanPrices = { plus: null, pro: null };

/** The plans with the paid plans' prices from `prices` (from /api/config); missing ones stay null. */
export function withPrices(prices: Partial<PlanPrices> | null | undefined): Plan[] {
  return PLANS.map((p) => (isPaidPlan(p.id) ? { ...p, price: prices?.[p.id] ?? p.price } : p));
}

/** Currencies an admin can price the plans in (ISO 4217, upper case). */
export const BILLING_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'SGD', 'INR', 'JPY'] as const;
export type BillingCurrency = (typeof BILLING_CURRENCIES)[number];

/** Digits after the decimal point in `currency`'s major unit (Stripe amounts are in the minor unit). */
export function currencyDecimals(currency: string): number {
  return ['JPY', 'KRW', 'VND', 'CLP'].includes(currency.toUpperCase()) ? 0 : 2;
}

/** 9.5 USD → 950 (Stripe's unit_amount). */
export function toMinorUnits(amount: number, currency: string): number {
  return Math.round(amount * 10 ** currencyDecimals(currency));
}

export function planById(id: PlanId): Plan {
  return PLANS.find((p) => p.id === id)!;
}

export function isPaidPlan(id: string): id is PaidPlanId {
  return (PAID_PLAN_IDS as readonly string[]).includes(id);
}

/**
 * The plan a quota amounts to: the largest plan whose storage fits in it. Free unless an admin
 * or a subscription raised the quota to a paid plan's size (a quota between two plans counts as
 * the smaller one, so a person with 20 GB can still ask for Plus).
 */
export function planForQuota(quotaBytes: number): Plan {
  let best = PLANS[0];
  for (const p of PLANS) if (p.storageBytes <= quotaBytes && p.storageBytes >= best.storageBytes) best = p;
  return best;
}

/** "$9 / month", "Free", or null while the price is not decided. */
export function formatPlanPrice(p: Plan): string | null {
  if (!p.price) return null;
  if (p.price.amount === 0) return 'Free';
  const amount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: p.price.currency,
    minimumFractionDigits: Number.isInteger(p.price.amount) ? 0 : 2,
  }).format(p.price.amount);
  return `${amount} / month`;
}

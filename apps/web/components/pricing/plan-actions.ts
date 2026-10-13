// What each plan card on /pricing offers, from who is looking: signed out (sign up),
// on this plan (current, maybe Manage billing), already covered by their quota
// (included), or a step up: Stripe Checkout when billing is on, a storage request
// when it is not. Pure, so the decisions are tested without a browser.
import { format } from 'date-fns';
import { planById, type Plan, type PlanId, type StorageRequest, type Subscription } from '@volumes/shared';

export const SIGNUP_FOR_PLAN_HREF = '/signup?next=/pricing';

export interface Viewer {
  signedIn: boolean;
  billingEnabled: boolean;
  /** planForQuota(quotaBytes). */
  plan: PlanId;
  quotaBytes: number;
  subscription: Subscription | null;
  request: StorageRequest | null;
}

export type PlanAction =
  | { kind: 'signup'; label: string; href: string }
  | { kind: 'current'; label: string; manage: boolean }
  | { kind: 'included'; label: string }
  | { kind: 'checkout'; label: string }
  | { kind: 'portal'; label: string }
  | { kind: 'request'; label: string; requested: boolean };

export function planAction(plan: Plan, v: Viewer, signupFreeHref: string): PlanAction {
  if (!v.signedIn) {
    return plan.id === 'free'
      ? { kind: 'signup', label: 'Get started', href: signupFreeHref }
      : { kind: 'signup', label: `Sign up for ${plan.name}`, href: SIGNUP_FOR_PLAN_HREF };
  }
  if (plan.id === v.plan) {
    const subscribed = !!v.subscription?.entitled && v.subscription.plan === plan.id;
    return { kind: 'current', label: 'Current plan', manage: subscribed };
  }
  if (plan.storageBytes <= v.quotaBytes) return { kind: 'included', label: 'Included in your plan' };
  if (v.billingEnabled) {
    return v.subscription?.entitled ? { kind: 'portal', label: `Change to ${plan.name}` } : { kind: 'checkout', label: `Upgrade to ${plan.name}` };
  }
  const requested = v.request?.status === 'open' && v.request.plan === plan.id;
  return { kind: 'request', label: requested ? `Requested ${plan.name}` : `Request ${plan.name}`, requested };
}

/** "Requested Plus on 13 Oct — we'll email you." and the other answers, or null when there is nothing to say. */
export function requestStatusText(r: StorageRequest | null): string | null {
  if (!r) return null;
  const name = planById(r.plan).name;
  if (r.status === 'open') return `Requested ${name} on ${format(new Date(r.createdAt), 'd MMM')} — we'll email you.`;
  if (r.status === 'granted') return r.resolvedAt ? `Your request for ${name} was granted on ${format(new Date(r.resolvedAt), 'd MMM')}.` : null;
  return `Your request for ${name} on ${format(new Date(r.createdAt), 'd MMM')} was not granted. You can ask again.`;
}

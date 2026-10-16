'use client';

// The three plan cards (Free, Plus, Pro) from PLANS with the prices an admin set (/api/config),
// and what each offers the person looking (plan-actions.ts). Signed in, their current plan is marked and a request's status shows
// above the cards; with Stripe on, paid plans go to Checkout and subscribers to the portal.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Check } from 'lucide-react';
import { formatBytes, formatPlanPrice, isPaidPlan, planById, planForQuota, withPrices, type Plan, type StorageRequest } from '@volumes/shared';
import { SIGNUP_HREF } from '@/components/landing/cta';
import { useConfig } from '@/lib/api/hooks';
import { isApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { useVx } from '@/lib/store';
import { planAction, requestStatusText, type PlanAction, type Viewer } from './plan-actions';
import { RequestDialog } from './request-dialog';

const quiet = { revalidateOnFocus: false, shouldRetryOnError: false };

/** "?checkout=success" / "canceled" from Stripe's redirect, read once on mount. */
function useCheckoutReturn(): 'success' | 'canceled' | null {
  const [v, setV] = useState<'success' | 'canceled' | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('checkout');
    if (p === 'success' || p === 'canceled') setV(p);
  }, []);
  return v;
}

/** The card's price line; null while /api/config (which carries the prices) is on its way. */
export function priceText(plan: Plan, billingEnabled: boolean, loaded = true): string | null {
  const text = formatPlanPrice(plan);
  if (text) return text;
  if (!loaded) return null;
  return billingEnabled ? 'Price shown at checkout' : 'Price coming soon';
}

export function PricingPlans({ signedIn: signedInHint }: { signedIn: boolean }) {
  const { data: config, error: configError } = useConfig();
  const plans = withPrices(config?.billing.prices);
  const pricesLoaded = !!config || !!configError;
  const billing = useSWR(signedInHint ? 'billing' : null, () => api.billing.get(), quiet);
  const request = useSWR(signedInHint ? 'storage-request' : null, () => api.me.storageRequest(), quiet);
  const checkout = useCheckoutReturn();
  const [asking, setAsking] = useState<Plan | null>(null);
  const [going, setGoing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The cookie is only a hint: a stale one answers 401, and the page reads as signed out.
  const signedIn = signedInHint && !(isApiError(billing.error) && billing.error.status === 401);
  const loading = signedIn && !billing.data && !billing.error;
  const billingEnabled = billing.data?.enabled ?? config?.billing.enabled ?? false;

  // Back from Checkout: Stripe confirms by webhook a moment later, so look again for a little while.
  const confirmed = !!billing.data?.subscription?.entitled;
  const refresh = billing.mutate;
  useEffect(() => {
    if (checkout !== 'success' || confirmed) return;
    let n = 0;
    const t = setInterval(() => {
      if (++n > 15) clearInterval(t);
      void refresh();
    }, 2000);
    return () => clearInterval(t);
  }, [checkout, confirmed, refresh]);

  const quotaBytes = billing.data?.quotaBytes ?? 0;
  const viewer: Viewer = {
    signedIn,
    billingEnabled,
    plan: billing.data?.plan ?? planForQuota(quotaBytes).id,
    quotaBytes,
    subscription: billing.data?.subscription ?? null,
    request: request.data?.request ?? null,
  };

  const go = async (key: string, fn: () => Promise<{ url: string }>) => {
    setGoing(key);
    setError(null);
    try {
      window.location.assign((await fn()).url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open billing. Try again.');
      setGoing(null);
    }
  };

  const onSent = (r: StorageRequest) => {
    setAsking(null);
    void request.mutate({ request: r }, { revalidate: false });
    useVx.getState().toast({ kind: 'success', message: requestStatusText(r) ?? 'Request sent.' });
  };

  const status = !signedIn
    ? null
    : checkout === 'success'
      ? confirmed
        ? `You're on ${planById(billing.data?.plan ?? 'free').name}. Your drives can now hold ${formatBytes(quotaBytes)}.`
        : 'Thanks. Your plan updates as soon as Stripe confirms the payment.'
      : checkout === 'canceled'
        ? 'Checkout canceled. Nothing was charged.'
        : requestStatusText(viewer.request);
  const sub = viewer.subscription;

  return (
    <>
      {signedIn && (status || sub) ? (
        <div className="kd-pricing__status" role="status">
          {status ? <p>{status}</p> : null}
          {sub?.entitled && sub.cancelAtPeriodEnd && sub.currentPeriodEnd ? (
            <p className="kd-pricing__status-sub">
              Your subscription ends on {new Date(sub.currentPeriodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}; your
              storage goes back to 10 GB then. Files are never deleted.
            </p>
          ) : sub?.status === 'past_due' ? (
            <p className="kd-pricing__status-sub">Your last payment failed. Update your card from Manage billing to keep your plan.</p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="kd-pricing__error" role="alert">
          {error}
        </p>
      ) : null}
      <ol className="kd-plans" aria-label="Plans" aria-busy={loading || undefined}>
        {plans.map((plan) => {
          const action = planAction(plan, viewer, SIGNUP_HREF);
          const current = action.kind === 'current';
          return (
            <li key={plan.id} className={`kd-plan${current ? ' kd-plan--current' : ''}${plan.id === 'plus' ? ' kd-plan--lead' : ''}`} data-plan={plan.id}>
              <div className="kd-plan__top">
                <h3 className="kd-plan__name">{plan.name}</h3>
                {current ? <span className="kd-plan__badge">Your plan</span> : null}
              </div>
              <p className="kd-plan__size kd-mono">{formatBytes(plan.storageBytes)}</p>
              <p className={`kd-plan__price${plan.price || !pricesLoaded ? '' : ' kd-plan__price--tbd'}`} aria-busy={!pricesLoaded || undefined}>
                {priceText(plan, billingEnabled, pricesLoaded) ?? '\u00a0'}
              </p>
              <p className="kd-plan__tagline">{plan.tagline}</p>
              <ul className="kd-plan__features">
                {plan.features.map((f) => (
                  <li key={f}>
                    <Check size={15} strokeWidth={2} aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="kd-plan__cta">
                {loading ? (
                  <span className="kd-btn kd-btn--ghost kd-plan__btn" aria-hidden>
                    &nbsp;
                  </span>
                ) : (
                  <PlanButton
                    plan={plan}
                    action={action}
                    busy={going === plan.id || (going === 'portal' && (action.kind === 'portal' || action.kind === 'current'))}
                    onRequest={() => setAsking(plan)}
                    onCheckout={() => {
                      const id = plan.id;
                      if (isPaidPlan(id)) void go(id, () => api.billing.checkout(id));
                    }}
                    onPortal={() => void go('portal', () => api.billing.portal())}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {asking ? <RequestDialog plan={asking} onClose={() => setAsking(null)} onSent={onSent} /> : null}
    </>
  );
}

function PlanButton({
  plan,
  action,
  busy,
  onRequest,
  onCheckout,
  onPortal,
}: {
  plan: Plan;
  action: PlanAction;
  busy: boolean;
  onRequest: () => void;
  onCheckout: () => void;
  onPortal: () => void;
}) {
  const lead = plan.id === 'plus';
  const cls = `kd-btn ${lead ? 'kd-btn--primary' : 'kd-btn--ghost'} kd-plan__btn`;
  switch (action.kind) {
    case 'signup':
      return (
        <Link href={action.href} className={cls}>
          {action.label}
          <span className="kd-btn__arrow" aria-hidden="true">
            →
          </span>
        </Link>
      );
    case 'current':
      return action.manage ? (
        <button type="button" className="kd-btn kd-btn--ghost kd-plan__btn" onClick={onPortal} disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Opening…' : 'Manage billing'}
        </button>
      ) : (
        <span className="kd-plan__note">{action.label}</span>
      );
    case 'included':
      return <span className="kd-plan__note">{action.label}</span>;
    case 'checkout':
    case 'portal':
      return (
        <button type="button" className={cls} onClick={action.kind === 'checkout' ? onCheckout : onPortal} disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Opening…' : action.label}
          {busy ? null : (
            <span className="kd-btn__arrow" aria-hidden="true">
              →
            </span>
          )}
        </button>
      );
    case 'request':
      return (
        <button type="button" className={action.requested ? 'kd-btn kd-btn--ghost kd-plan__btn' : cls} onClick={onRequest}>
          {action.requested ? `${action.label} · change` : action.label}
        </button>
      );
  }
}

export default PricingPlans;

'use client';

// Admin → Billing: Stripe for the paid plans, set up from here. An admin pastes one secret key and
// types the Plus and Pro monthly prices; the API checks the key, creates the webhook endpoint and
// the plan Prices in Stripe and keeps the secrets sealed. Three cards: the connection (key, live or
// test, account, disconnect), the plan prices (one currency for both) and the webhook (its URL, and
// a field for a signing secret when Stripe cannot reach this server, e.g. `stripe listen` locally).
// A key in the server environment (STRIPE_SECRET_KEY) wins and is shown read-only; saving the prices
// then sets up the webhook and the Prices with it. Secrets are write-only: no field is ever filled
// from the server.
import { useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { ChevronDown, TriangleAlert } from 'lucide-react';
import {
  BILLING_CURRENCIES,
  currencyDecimals,
  formatBytes,
  PAID_PLAN_IDS,
  planById,
  STRIPE_KEY_PATTERN,
  STRIPE_WEBHOOK_SECRET_PATTERN,
  type AdminBillingResponse,
  type BillingCurrency,
  type PaidPlanId,
} from '@volumes/shared';
import { formatWhen } from '@/components/preview/names';
import { CopyButton } from '@/components/share/copy-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Menu } from '@/components/ui/menu';
import { api } from '@/lib/api/endpoints';
import { isoTitle } from '@/lib/format';
import { useVx } from '@/lib/store';
import { LoadError, Loading } from './parts';

export const BILLING_KEY = 'admin-billing';

/** Parses a typed monthly price ("9", "9.50"); error text when empty, not a number, under 0.50 or too precise. */
export function parsePrice(input: string, currency: string): { amount: number | null; error: string | null } {
  const s = input.trim().replace(/,/g, '');
  if (!s) return { amount: null, error: 'Enter a monthly price.' };
  if (!/^\d+(\.\d+)?$/.test(s)) return { amount: null, error: 'Enter a number, like 9 or 9.50.' };
  const n = Number(s);
  const decimals = currencyDecimals(currency);
  if ((s.split('.')[1]?.length ?? 0) > decimals) return { amount: null, error: decimals ? `At most ${decimals} decimals.` : `${currency} has no decimals.` };
  if (n < 0.5) return { amount: null, error: 'At least 0.50.' };
  if (n > 100_000) return { amount: null, error: 'At most 100,000.' };
  return { amount: n, error: null };
}

/** A price for the input: 9 → "9", 9.5 → "9.50". */
export function priceInput(amount: number, currency: string): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(currencyDecimals(currency));
}

const looksLikeKey = (s: string) => STRIPE_KEY_PATTERN.test(s.trim());
const looksLikeWebhookSecret = (s: string) => STRIPE_WEBHOOK_SECRET_PATTERN.test(s.trim());

function errText(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

function Card({ title, lead, aside, children }: { title: string; lead: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-vx-md border border-vx-hair bg-vx-bg-2 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 max-w-[560px]">
          <h2 className="vx-title">{title}</h2>
          <p className="vx-body mt-1 text-vx-text-3">{lead}</p>
        </div>
        {aside ? <div className="flex shrink-0 items-center gap-1.5">{aside}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Note({ tone, children }: { tone: 'warn' | 'danger' | 'quiet'; children: React.ReactNode }) {
  const cls =
    tone === 'danger'
      ? 'bg-vx-danger-wash text-vx-danger'
      : tone === 'warn'
        ? 'bg-vx-warn-wash text-vx-text-2'
        : 'bg-vx-surface-2 text-vx-text-2';
  return (
    <p role={tone === 'quiet' ? undefined : 'alert'} className={`mt-3 flex items-start gap-2 rounded-vx-sm px-3 py-2 text-[13px] leading-5 ${cls}`}>
      {tone !== 'quiet' ? <TriangleAlert size={16} strokeWidth={1.75} aria-hidden className={`mt-0.5 shrink-0 ${tone === 'warn' ? 'text-vx-warn' : ''}`} /> : null}
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

export function Billing() {
  const { data, error, mutate } = useSWR(BILLING_KEY, () => api.admin.billing(), { revalidateOnFocus: false, shouldRetryOnError: false });
  const [warning, setWarning] = useState<string | null>(null);

  /** A change answered with the new configuration: show it, and let /pricing and Checkout see it. */
  const apply = (next: AdminBillingResponse) => {
    setWarning(next.warning ?? null);
    void mutate(next, { revalidate: false });
    void globalMutate('config');
    void globalMutate('billing');
  };

  if (error && !data) return <LoadError what="billing" onRetry={() => void mutate()} />;
  if (!data) return <Loading lines={[70, 60, 80]} />;

  return (
    <div className="flex max-w-[760px] flex-col gap-4 pt-5">
      {warning ? <Note tone="warn">{warning}</Note> : null}
      <Connection data={data} onChange={apply} />
      <Prices data={data} onChange={apply} />
      <Webhook data={data} onChange={apply} />
      {data.updatedAt ? (
        <p className="vx-meta text-vx-text-3">
          Last changed by {data.updatedBy ?? 'an admin'} · <span title={isoTitle(data.updatedAt)}>{formatWhen(data.updatedAt)}</span>
        </p>
      ) : null}
    </div>
  );
}

function Connection({ data, onChange }: { data: AdminBillingResponse; onChange: (d: AdminBillingResponse) => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const connected = data.source === 'admin';
  const typedLive = /^(sk|rk)_live_/.test(key.trim());

  const save = async () => {
    if (!looksLikeKey(key) || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const next = await api.admin.setBillingKey(key.trim());
      setKey('');
      onChange(next);
      useVx.getState().toast({ kind: 'success', message: `Stripe connected (${next.mode === 'live' ? 'live' : 'test'} mode).` });
    } catch (e) {
      setErr(errText(e, 'Could not save the key.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Stripe connection"
      lead={
        data.source === 'env'
          ? 'The Stripe key this server uses. KDRIVE creates the webhook and the plan prices with it.'
          : 'Paste a secret key from the Stripe dashboard (Developers → API keys). KDRIVE checks it, creates the webhook and the plan prices for you.'
      }
      aside={
        <>
          {data.mode ? <Badge tone={data.mode === 'live' ? 'past' : 'neutral'}>{data.mode === 'live' ? 'LIVE' : 'TEST'}</Badge> : null}
          <Badge tone={data.enabled ? 'live' : 'dashed'} pip={data.enabled}>
            {data.enabled ? 'Billing on' : 'Billing off'}
          </Badge>
        </>
      }
    >
      {data.source ? (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[13px] leading-5">
          <dt className="text-vx-text-3">Key</dt>
          <dd className="vx-meta text-vx-text-1">{data.keyHint}</dd>
          {data.account ? (
            <>
              <dt className="text-vx-text-3">Account</dt>
              <dd className="text-vx-text-1">{data.account}</dd>
            </>
          ) : null}
          <dt className="text-vx-text-3">From</dt>
          <dd className="text-vx-text-1">{connected ? 'Saved here (encrypted)' : 'Server environment (STRIPE_SECRET_KEY)'}</dd>
        </dl>
      ) : null}
      {data.keyError ? <Note tone="danger">{data.keyError}</Note> : null}
      {data.mode === 'live' ? <Note tone="warn">Live mode: Checkout charges real cards.</Note> : null}
      {data.source === 'env' ? (
        <Note tone="quiet">
          The key comes from this server&apos;s environment and wins over one saved here. To change it, change STRIPE_SECRET_KEY on the server and restart
          the API.{data.enabled ? '' : ' Set the plan prices below: KDRIVE then creates the prices and the webhook in Stripe with this key.'}
        </Note>
      ) : (
        <form
          className="mt-4 flex flex-wrap items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            size="sm"
            type="password"
            mono
            autoComplete="off"
            spellCheck={false}
            placeholder={connected ? 'Paste a new key to replace it' : 'sk_live_… or sk_test_…'}
            aria-label="Stripe secret key"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setErr(null);
            }}
            invalid={err ?? (key.trim() && !looksLikeKey(key) ? 'A secret key starts with sk_live_, sk_test_, rk_live_ or rk_test_.' : null)}
            hint={typedLive ? 'A live key: once prices are set, people pay real money.' : 'Stored encrypted. It is never shown again, here or anywhere.'}
            className="min-w-[240px] flex-1"
          />
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!looksLikeKey(key)}>
            {connected ? 'Replace key' : 'Connect Stripe'}
          </Button>
          {connected ? (
            <Button size="sm" variant="danger-text" onClick={() => setConfirming(true)} disabled={busy}>
              Disconnect
            </Button>
          ) : null}
        </form>
      )}

      <ConfirmDialog
        open={confirming}
        danger
        title="Disconnect Stripe?"
        body={
          <>
            New subscriptions stop: paid plans go back to storage requests. The key and the
            webhook secret are forgotten and KDRIVE&apos;s webhook endpoint is removed from Stripe. Existing subscriptions keep running in Stripe; cancel them
            there if they should stop. The prices stay for next time.
          </>
        }
        confirmLabel="Disconnect"
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          onChange(await api.admin.disconnectBilling());
          useVx.getState().toast({ kind: 'success', message: 'Stripe disconnected.' });
        }}
      />
    </Card>
  );
}

function Prices({ data, onChange }: { data: AdminBillingResponse; onChange: (d: AdminBillingResponse) => void }) {
  const initialCurrency = (data.prices.plus?.currency ?? data.prices.pro?.currency ?? 'USD') as BillingCurrency;
  const [currency, setCurrency] = useState<BillingCurrency>(initialCurrency);
  const [values, setValues] = useState<Record<PaidPlanId, string>>(() => ({
    plus: data.prices.plus ? priceInput(data.prices.plus.amount, data.prices.plus.currency) : '',
    pro: data.prices.pro ? priceInput(data.prices.pro.amount, data.prices.pro.currency) : '',
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const envOnly = data.pricesFromEnv.plus || data.pricesFromEnv.pro;
  const parsed = { plus: parsePrice(values.plus, currency), pro: parsePrice(values.pro, currency) };
  const valid = parsed.plus.amount !== null && parsed.pro.amount !== null;
  // Nothing to save: the same amounts, already in Stripe when a key is connected.
  const unchanged = PAID_PLAN_IDS.every(
    (id) => data.prices[id]?.amount === parsed[id].amount && data.prices[id]?.currency === currency && (!data.source || data.pricesReady[id]),
  );

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const next = await api.admin.setBillingPrices({
        plus: { amount: parsed.plus.amount!, currency },
        pro: { amount: parsed.pro.amount!, currency },
      });
      onChange(next);
      useVx.getState().toast({ kind: 'success', message: 'Prices saved.' });
    } catch (e) {
      setErr(errText(e, 'Could not save the prices.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Plan prices"
      lead={
        <>
          Monthly, shown on the pricing page and charged at Checkout. A new amount is a new price in Stripe: people already subscribed keep what they
          pay.
        </>
      }
      aside={
        <Menu
          align="end"
          minWidth={140}
          items={BILLING_CURRENCIES.map((c) => ({ id: c, label: c, checked: c === currency, onSelect: () => setCurrency(c) }))}
          trigger={(p) => (
            <Button {...p} size="sm" variant="outline" disabled={envOnly} trailing={<ChevronDown size={14} strokeWidth={1.75} aria-hidden />} aria-label={`Currency: ${currency}`}>
              <span className="font-mono text-[12px]">{currency}</span>
            </Button>
          )}
        />
      }
    >
      {envOnly ? (
        <Note tone="quiet">
          The prices are the Stripe Prices named by STRIPE_PRICE_PLUS / STRIPE_PRICE_PRO in this server&apos;s environment; Checkout shows their amounts.
          Remove those variables to set the prices here.
        </Note>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">
            {PAID_PLAN_IDS.map((id) => {
              const plan = planById(id);
              const ready = data.pricesReady[id] && data.prices[id]?.amount === parsed[id].amount && data.prices[id]?.currency === currency;
              return (
                <Input
                  key={id}
                  size="sm"
                  inputMode="decimal"
                  autoComplete="off"
                  label={
                    <span className="flex items-center gap-2">
                      {plan.name} <span className="vx-meta text-vx-text-3">{formatBytes(plan.storageBytes)}</span>
                      {data.source && data.prices[id] ? (
                        <Badge tone={ready ? 'live' : 'dashed'} title={ready ? 'This amount exists as a monthly Price in Stripe' : 'Not in Stripe yet: save the prices'}>
                          {ready ? 'In Stripe' : 'Not in Stripe'}
                        </Badge>
                      ) : null}
                    </span>
                  }
                  placeholder={id === 'plus' ? '9' : '29'}
                  value={values[id]}
                  suffix={`${currency} / month`}
                  onChange={(e) => {
                    setValues((v) => ({ ...v, [id]: e.target.value }));
                    setErr(null);
                  }}
                  invalid={values[id].trim() ? parsed[id].error : null}
                />
              );
            })}
          </div>
          {err ? <Note tone="danger">{err}</Note> : null}
          {!data.source ? <p className="vx-micro mt-3 text-vx-text-3">Saved now; the prices are created in Stripe when a key is connected.</p> : null}
          <div className="mt-4 flex justify-end">
            <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!valid || unchanged}>
              Save prices
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function Webhook({ data, onChange }: { data: AdminBillingResponse; onChange: (d: AdminBillingResponse) => void }) {
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState<'secret' | 'auto' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const status = data.webhook.status;
  const editable = !!data.source && !data.webhook.fromEnv && status !== 'auto';

  const run = async (what: 'secret' | 'auto') => {
    if (busy) return;
    setBusy(what);
    setErr(null);
    try {
      const next = what === 'secret' ? await api.admin.setBillingWebhookSecret(secret.trim()) : await api.admin.retryBillingWebhook();
      if (what === 'secret') setSecret('');
      onChange(next);
      if (next.webhook.status !== 'missing') useVx.getState().toast({ kind: 'success', message: 'Webhook ready.' });
    } catch (e) {
      setErr(errText(e, 'Could not set up the webhook.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title="Webhook"
      lead="Stripe tells KDRIVE here when someone subscribes, changes plan, cancels or misses a payment; the storage follows."
      aside={
        <Badge tone={status === 'auto' ? 'live' : status === 'manual' ? 'neutral' : 'danger'} pip={status === 'auto'}>
          {status === 'auto' ? 'Set up automatically' : data.webhook.fromEnv ? 'From environment' : status === 'manual' ? 'Signing secret set' : 'Not set up'}
        </Badge>
      }
    >
      <div className="flex items-center gap-2">
        <Input size="sm" mono readOnly value={data.webhook.url} aria-label="Webhook URL" className="min-w-0 flex-1" />
        <CopyButton text={data.webhook.url} />
      </div>
      {data.webhook.endpointId ? <p className="vx-meta mt-2 text-vx-text-3">Endpoint {data.webhook.endpointId}</p> : null}
      {data.webhook.fromEnv ? (
        <p className="vx-micro mt-3 text-vx-text-3">The signing secret is STRIPE_WEBHOOK_SECRET in this server&apos;s environment.</p>
      ) : editable ? (
        <>
          {data.webhook.error ? <Note tone="warn">{data.webhook.error}</Note> : null}
          <form
            className="mt-4 flex flex-wrap items-start gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (looksLikeWebhookSecret(secret)) void run('secret');
            }}
          >
            <Input
              size="sm"
              type="password"
              mono
              autoComplete="off"
              spellCheck={false}
              placeholder="whsec_…"
              aria-label="Webhook signing secret"
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value);
                setErr(null);
              }}
              invalid={err ?? (secret.trim() && !looksLikeWebhookSecret(secret) ? 'A signing secret starts with whsec_.' : null)}
              hint="Optional: the signing secret of an endpoint you made yourself, or the one `stripe listen` prints."
              className="min-w-[240px] flex-1"
            />
            <Button type="submit" size="sm" variant="primary" loading={busy === 'secret'} disabled={!looksLikeWebhookSecret(secret) || !!busy}>
              Save secret
            </Button>
            <Button size="sm" variant="text" loading={busy === 'auto'} disabled={!!busy} onClick={() => void run('auto')}>
              Set up automatically
            </Button>
          </form>
        </>
      ) : !data.source ? (
        <p className="vx-micro mt-3 text-vx-text-3">Connect a key above: the endpoint is created in Stripe for this URL.</p>
      ) : null}
    </Card>
  );
}

export default Billing;

import { Hono } from 'hono';
import { BillingResponse, CheckoutRequest, CreateStorageRequest, RedirectResponse, StorageRequestResponse } from '@volumes/shared';
import { ok, parseJson } from '../lib/http';
import { checkRateLimitKey, limits } from '../middleware/rate-limit';
import { createCheckout, createPortal, getBilling, handleWebhook } from '../services/billing';
import { getMyStorageRequest, requestStorage } from '../services/storage-requests';
import type { AppEnv } from '../types';

/** /api/me/storage-requests: ask an admin for a paid plan's storage (the flow while billing is off). */
export const storageRequestRoutes = new Hono<AppEnv>();

storageRequestRoutes.get('/me/storage-requests', async (c) =>
  ok(c, StorageRequestResponse, { request: await getMyStorageRequest(c.get('user').id) }),
);

storageRequestRoutes.post('/me/storage-requests', async (c) => {
  const req = await parseJson(c, CreateStorageRequest);
  const { request, created } = await requestStorage(c, c.get('user'), req);
  return ok(c, StorageRequestResponse, { request }, created ? 201 : 200);
});

/**
 * /api/billing: Stripe subscriptions for the paid plans. The webhook is public (app.ts lists it
 * in PUBLIC_PATHS and the CSRF guard skips it): Stripe's signature is its only credential.
 */
export const billingRoutes = new Hono<AppEnv>();

billingRoutes.get('/', async (c) => ok(c, BillingResponse, await getBilling(c.get('user').id)));

billingRoutes.post('/checkout', async (c) => {
  const user = c.get('user');
  const req = await parseJson(c, CheckoutRequest);
  checkRateLimitKey(limits.billingSession, user.id);
  return ok(c, RedirectResponse, { url: await createCheckout(user, req.plan) });
});

billingRoutes.post('/portal', async (c) => {
  const user = c.get('user');
  checkRateLimitKey(limits.billingSession, user.id);
  return ok(c, RedirectResponse, { url: await createPortal(user) });
});

billingRoutes.post('/webhook', async (c) => c.json(await handleWebhook(c, await c.req.text())));

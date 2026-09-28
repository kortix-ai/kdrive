import type { Context } from 'hono';
import { notImplemented } from '../lib/http';

/** Placeholder handler for routes a builder has not filled yet: 501 not_implemented. */
export const stub = (_c: Context): Response => {
  throw notImplemented();
};

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { type ZodType, z } from 'zod';
import type { ErrorCode } from '@volumes/shared';
import { env } from '../env';

/** An error with an HTTP status and a stable code; rendered as the JSON envelope. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public details?: Record<string, unknown>,
    public headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) => new ApiError(400, 'bad_request', message, details);
export const notFound = (message = 'Not found.') => new ApiError(404, 'not_found', message);
export const forbidden = (message = 'Forbidden.') => new ApiError(403, 'forbidden', message);
export const notImplemented = () => new ApiError(501, 'not_implemented', 'Not implemented yet.');

/** Parses the JSON body with a zod schema. Bad JSON or a schema failure is a 400. */
export async function parseJson<S extends ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    const text = await c.req.text();
    raw = text.trim() === '' ? {} : JSON.parse(text);
  } catch {
    throw badRequest('Request body is not valid JSON.');
  }
  return schema.parse(raw);
}

/**
 * Parses the query string. Repeated keys (`?paths=a&paths=b`) become arrays;
 * single keys stay strings.
 */
export function parseQuery<S extends ZodType>(c: Context, schema: S): z.output<S> {
  const all = c.req.queries();
  const obj: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(all)) obj[k] = v.length === 1 ? v[0] : v;
  return schema.parse(obj);
}

/** Sends JSON; in dev and test the payload is validated against the response schema first. */
export function ok<S extends ZodType>(c: Context, schema: S, data: z.input<S>, status: ContentfulStatusCode = 200): Response {
  if (!env.isProd) {
    const r = schema.safeParse(data);
    if (!r.success) {
      console.error('[response schema mismatch]', c.req.method, c.req.path, JSON.stringify(r.error.issues).slice(0, 2000));
      throw new ApiError(500, 'internal', 'Response failed schema validation.');
    }
    return c.json(r.data as object, status);
  }
  return c.json(data as object, status);
}

export function noContent(c: Context): Response {
  return c.body(null, 204);
}

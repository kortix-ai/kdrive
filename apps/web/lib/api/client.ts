import type { ZodType } from 'zod';
import type { ErrorCode } from '@volumes/shared';

/** A non-2xx API answer (or a network failure: status 0, code `upstream_unavailable`). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode | string,
    message: string,
    public details: Record<string, unknown> = {},
    public retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const isApiError = (e: unknown, code?: string): e is ApiError => e instanceof ApiError && (!code || e.code === code);

export interface ApiInit extends Omit<RequestInit, 'body'> {
  /** JSON body (sets content-type: application/json). */
  json?: unknown;
  /** Raw body (e.g. a block); pass its content-type in headers. */
  body?: BodyInit | null;
}

/** Builds `?a=1&b=x&b=y`, skipping null/undefined/'' and repeating arrays. */
export function qs(params: Record<string, string | number | boolean | null | undefined | (string | number)[]>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) for (const x of v) sp.append(k, String(x));
    else sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/**
 * fetch against our same-origin API. JSON in/out, throws ApiError on non-2xx,
 * returns undefined for 204. When `schema` is given the payload is parsed with it.
 */
export async function apiFetch<T = unknown>(path: string, init: ApiInit = {}, schema?: ZodType<T>): Promise<T> {
  const { json, headers, body, ...rest } = init;
  const h = new Headers(headers);
  let payload: BodyInit | null | undefined = body;
  if (json !== undefined) {
    h.set('content-type', 'application/json');
    payload = JSON.stringify(json);
  }
  if (!h.has('accept')) h.set('accept', 'application/json');
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...rest, headers: h, body: payload });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError(0, 'upstream_unavailable', 'Could not reach the server. Check your connection.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const env = (data as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error;
    const ra = res.headers.get('retry-after');
    throw new ApiError(
      res.status,
      env?.code ?? (res.status === 401 ? 'unauthorized' : res.status === 404 ? 'not_found' : 'internal'),
      env?.message ?? `Request failed (${res.status}).`,
      env?.details ?? {},
      ra ? Number(ra) || null : null,
    );
  }
  if (schema) {
    const r = schema.safeParse(data);
    if (!r.success) {
      console.warn('[api] response did not match schema', path, r.error.issues.slice(0, 3));
      return data as T;
    }
    return r.data;
  }
  return data as T;
}

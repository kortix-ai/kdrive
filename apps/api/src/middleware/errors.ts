import type { Context, ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { PathError, type ErrorCode } from '@volumes/shared';
import { ApiError } from '../lib/http';
import { VolumeStoreError } from '../storage/types';

interface Envelope {
  status: number;
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** Maps a VolumeStore error to our HTTP envelope (architecture §6.1). */
export function mapStoreError(e: VolumeStoreError): Envelope {
  const retry = e.extra.retryAfterSeconds;
  const retryHeaders = retry !== undefined ? { 'Retry-After': String(Math.max(1, Math.ceil(retry))) } : undefined;
  switch (e.code) {
    case 'path_not_found':
      return { status: 404, code: 'path_not_found', message: 'That file or folder does not exist at this version.', details: pick(e, ['path']) };
    case 'not_found':
      return { status: 410, code: 'version_gone', message: 'This version is no longer available.' };
    case 'volume_not_found':
      return { status: 404, code: 'not_found', message: 'Workspace storage not found.' };
    case 'path_exists':
      return {
        status: 409,
        code: 'path_exists',
        message: 'Something with that name already exists.',
        details: { paths: e.extra.paths ?? (e.extra.path ? [e.extra.path] : []) },
      };
    case 'not_a_file':
      return { status: 409, code: 'not_a_file', message: 'That is a folder, not a file.', details: pick(e, ['path']) };
    case 'not_a_directory':
      return { status: 409, code: 'not_a_directory', message: 'That is a file, not a folder.', details: pick(e, ['path']) };
    case 'directory_not_empty':
    case 'conflict':
    case 'volume_exists':
    case 'volume_busy':
      return { status: 409, code: 'conflict', message: e.message || 'Conflict.' };
    case 'quota_exceeded':
      if (e.extra.limit === 'volumes') {
        return { status: 409, code: 'storage_limit', message: 'No more workspaces can be created on this server.', details: pick(e, ['max']) };
      }
      if (e.extra.limit === 'tags') {
        return { status: 409, code: 'tag_budget_exceeded', message: 'This workspace has used all 100 checkpoints and pinned links.', details: pick(e, ['max']) };
      }
      if (e.extra.limit === 'stored_bytes') {
        return {
          status: 413,
          code: 'quota_exceeded',
          message: 'History is full; remove checkpoints or wait for old versions to expire.',
          details: { limit: 'stored_bytes' },
        };
      }
      return { status: 413, code: 'quota_exceeded', message: 'Storage limit exceeded.', details: { limit: e.extra.limit ?? 'bytes' } };
    case 'rate_limited':
      return { status: 429, code: 'rate_limited', message: 'Storage is busy. Try again shortly.', details: pick(e, ['retryAfterSeconds']), headers: retryHeaders ?? { 'Retry-After': '5' } };
    case 'commit_failed':
    case 'unavailable':
      return { status: 503, code: 'upstream_unavailable', message: 'Storage is temporarily unavailable. Try again shortly.', headers: retryHeaders ?? { 'Retry-After': '2' } };
    case 'payload_too_large':
      return { status: 413, code: 'payload_too_large', message: 'Too large.', details: pick(e, ['max']) };
    case 'range_not_satisfiable':
      return { status: 416, code: 'range_not_satisfiable', message: 'Requested range not satisfiable.' };
    case 'bad_request':
      if (e.extra.missing?.length) {
        return { status: 409, code: 'conflict', message: 'Some blocks are still missing.', details: { missing: e.extra.missing } };
      }
      return { status: 400, code: 'bad_request', message: e.message || 'Bad request.' };
    default:
      return { status: 500, code: 'internal', message: 'Storage error.' };
  }
}

function pick(e: VolumeStoreError, keys: (keyof VolumeStoreError['extra'])[]): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (e.extra[k] !== undefined) out[k] = e.extra[k];
  return Object.keys(out).length ? out : undefined;
}

export function toEnvelope(err: unknown): Envelope {
  if (err instanceof ApiError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details, headers: err.headers };
  }
  if (err instanceof VolumeStoreError) return mapStoreError(err);
  if (err instanceof PathError) return { status: 400, code: 'invalid_path', message: err.message };
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const where = first?.path?.length ? `${first.path.join('.')}: ` : '';
    return {
      status: 400,
      code: 'bad_request',
      message: `${where}${first?.message ?? 'Invalid request.'}`,
      details: { issues: err.issues.slice(0, 20).map((i) => ({ path: i.path.map(String), message: i.message })) },
    };
  }
  if (err instanceof HTTPException) {
    const status = err.status;
    const code: ErrorCode = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : status === 413 ? 'payload_too_large' : 'bad_request';
    return { status, code, message: err.message || 'Request failed.' };
  }
  return { status: 500, code: 'internal', message: 'Something went wrong.' };
}

export function errorResponse(c: Context, err: unknown): Response {
  const env = toEnvelope(err);
  if (env.status >= 500 && env.status !== 501) {
    // Log without secrets or bodies: the error name, message and the route only.
    const reqId = (c.get('reqId' as never) as string | undefined) ?? '-';
    const detail = err instanceof VolumeStoreError ? `${err.code}: ${err.message}` : err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[${reqId}] ${c.req.method} ${c.req.path} -> ${env.status} ${detail}`);
    if (err instanceof Error && err.stack && !(err instanceof VolumeStoreError) && process.env.NODE_ENV !== 'production') {
      console.error(err.stack.split('\n').slice(1, 6).join('\n'));
    }
  }
  const body = { error: { code: env.code, message: env.message, ...(env.details ? { details: env.details } : {}) } };
  const res = c.json(body, env.status as 400);
  if (env.headers) for (const [k, v] of Object.entries(env.headers)) res.headers.set(k, v);
  return res;
}

export const onError: ErrorHandler = (err, c) => errorResponse(c, err);

import { describe, expect, test } from 'bun:test';
import { ZodError, z } from 'zod';
import { PathError } from '@volumes/shared';
import { PlatinumError, RateLimitError } from '@platinum-dev/sdk';
import { ApiError } from '../lib/http';
import { toStoreError } from '../storage/platinum';
import { VolumeStoreError } from '../storage/types';
import { TokenBucket } from './rate-limit';
import { toEnvelope } from './errors';

const se = (status: number, code: VolumeStoreError['code'], extra: VolumeStoreError['extra'] = {}) => new VolumeStoreError(status, code, code, extra);

describe('error envelope mapping', () => {
  test('store codes map per architecture §6.1', () => {
    expect(toEnvelope(se(404, 'path_not_found'))).toMatchObject({ status: 404, code: 'path_not_found' });
    expect(toEnvelope(se(404, 'not_found'))).toMatchObject({ status: 410, code: 'version_gone', message: 'This version is no longer available.' });
    expect(toEnvelope(se(404, 'volume_not_found'))).toMatchObject({ status: 404, code: 'not_found' });
    expect(toEnvelope(se(409, 'path_exists', { paths: ['/a'] }))).toMatchObject({ status: 409, code: 'path_exists', details: { paths: ['/a'] } });
    expect(toEnvelope(se(409, 'not_a_file'))).toMatchObject({ status: 409, code: 'not_a_file' });
    expect(toEnvelope(se(409, 'directory_not_empty'))).toMatchObject({ status: 409, code: 'conflict' });
    expect(toEnvelope(se(403, 'quota_exceeded', { limit: 'bytes' }))).toMatchObject({ status: 413, code: 'quota_exceeded' });
    expect(toEnvelope(se(403, 'quota_exceeded', { limit: 'volumes' }))).toMatchObject({ status: 409, code: 'storage_limit' });
    expect(toEnvelope(se(403, 'quota_exceeded', { limit: 'tags' }))).toMatchObject({ status: 409, code: 'tag_budget_exceeded' });
    expect(toEnvelope(se(429, 'rate_limited', { retryAfterSeconds: 30 }))).toMatchObject({ status: 429, code: 'rate_limited', headers: { 'Retry-After': '30' } });
    expect(toEnvelope(se(503, 'commit_failed'))).toMatchObject({ status: 503, code: 'upstream_unavailable' });
    expect(toEnvelope(se(413, 'payload_too_large'))).toMatchObject({ status: 413, code: 'payload_too_large' });
    expect(toEnvelope(se(416, 'range_not_satisfiable'))).toMatchObject({ status: 416 });
    expect(toEnvelope(se(400, 'bad_request', { missing: ['ab'] }))).toMatchObject({ status: 409, code: 'conflict', details: { missing: ['ab'] } });
    expect(toEnvelope(se(401, 'unauthorized'))).toMatchObject({ status: 500, code: 'internal' });
    expect(toEnvelope(se(403, 'insufficient_scope'))).toMatchObject({ status: 500, code: 'internal' });
  });

  test('ApiError, ZodError, PathError, unknown', () => {
    expect(toEnvelope(new ApiError(413, 'quota_exceeded', 'over', { overBytes: 5 }))).toMatchObject({ status: 413, details: { overBytes: 5 } });
    let zerr: unknown;
    try {
      z.object({ a: z.string() }).parse({});
    } catch (e) {
      zerr = e;
    }
    expect(zerr).toBeInstanceOf(ZodError);
    expect(toEnvelope(zerr)).toMatchObject({ status: 400, code: 'bad_request' });
    expect(toEnvelope(new PathError('bad'))).toMatchObject({ status: 400, code: 'invalid_path' });
    expect(toEnvelope(new Error('secret stuff'))).toEqual({ status: 500, code: 'internal', message: 'Something went wrong.' });
  });
});

describe('platinum error conversion', () => {
  test('codes, statuses and extras', () => {
    const a = toStoreError(new PlatinumError(409, { code: 'path_exists', error: 'exists', paths: ['/a', '/b'] }, 'exists', 'path_exists'));
    expect(a.code).toBe('path_exists');
    expect(a.extra.paths).toEqual(['/a', '/b']);
    const b = toStoreError(new PlatinumError(416, { code: 'bad_request' }, 'range', 'bad_request'));
    expect(b.code).toBe('range_not_satisfiable');
    const c = toStoreError(new RateLimitError(429, { code: 'rate_limited' }, 'slow down', 'rate_limited', 30));
    expect(c.code).toBe('rate_limited');
    expect(c.extra.retryAfterSeconds).toBe(30);
    const d = toStoreError(new PlatinumError(0, undefined, 'ECONNREFUSED'));
    expect(d.code).toBe('unavailable');
    expect(d.extra.retryable).toBe(true);
    const e = toStoreError(new PlatinumError(400, { code: 'bad_request', error: 'upload incomplete', missing: ['aa'] }, 'x', 'bad_request'));
    expect(e.extra.missing).toEqual(['aa']);
    const f = toStoreError(new PlatinumError(403, { code: 'quota_exceeded', limit: 'tags', max: 100 }, 'x', 'quota_exceeded'));
    expect(f.extra).toMatchObject({ limit: 'tags', max: 100 });
  });
});

describe('TokenBucket', () => {
  test('allows capacity, then asks to wait, refills over time', () => {
    let t = 0;
    const b = new TokenBucket(2, 1, () => t);
    expect(b.take('k')).toBe(0);
    expect(b.take('k')).toBe(0);
    expect(b.take('k')).toBeGreaterThan(0);
    t += 1000;
    expect(b.take('k')).toBe(0);
    expect(b.take('other')).toBe(0);
  });
});

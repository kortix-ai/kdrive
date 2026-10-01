import { describe, expect, test } from 'bun:test';
import { ApiError } from '../lib/http';
import { VolumeStoreError } from '../storage/types';
import type { AgentPrincipal } from '../agents/principal';
import { ERROR_HINTS, PARTIAL_HINT, UNKNOWN_OUTCOME_HINT } from './descriptions';
import { toolError, toolErrorBody } from './errors';
import { capBytes, utf8Window } from './output';
import { MAX_RESULT_BYTES, ok, withTool } from './result';

const principal = (scope: AgentPrincipal['scope'], mode: AgentPrincipal['mode'] = 'review'): AgentPrincipal => ({
  kind: 'token',
  credential: 'pat:unit',
  grantId: 'unit',
  name: 'Unit agent',
  user: { id: 'u', email: 'u@test.local', name: null, image: null },
  scope,
  mode,
  workspaceId: null,
});

describe('ok()', () => {
  test('summary line, resource links, JSON copy equal to structuredContent', () => {
    const data = { a: 1, list: ['x'] };
    const r = ok({ summary: 'Read 1 file', links: [{ uri: 'http://x/drive?ws=1', name: 'a.txt', mimeType: 'text/plain' }], data });
    expect(r.content[0]).toEqual({ type: 'text', text: 'Read 1 file' });
    expect(r.content[1]).toEqual({ type: 'resource_link', uri: 'http://x/drive?ws=1', name: 'a.txt', mimeType: 'text/plain' });
    expect(JSON.parse((r.content[2] as { text: string }).text)).toEqual(r.structuredContent as object);
    expect(r.isError).toBeUndefined();
  });

  test('a result past the size cap is refused rather than built', () => {
    const big = { text: 'x'.repeat(MAX_RESULT_BYTES + 1) };
    expect(() => ok({ summary: 'big', data: big })).toThrow(ApiError);
    expect(() => ok({ summary: 'fits', data: { text: 'x'.repeat(1024) } })).not.toThrow();
  });

  test('at most 50 links, with "(+N more)" on the summary', () => {
    const links = Array.from({ length: 53 }, (_, i) => ({ uri: `http://x/${i}`, name: `f${i}` }));
    const r = ok({ summary: 'Wrote 53 files', links, data: {} });
    expect(r.content[0]).toEqual({ type: 'text', text: 'Wrote 53 files (+3 more)' });
    expect(r.content.filter((c) => c.type === 'resource_link')).toHaveLength(50);
  });
});

describe('toolError()', () => {
  const body = (e: unknown, write = false) => toolErrorBody(e, { write });

  test('single JSON text block, isError, no structuredContent', () => {
    const r = toolError(new ApiError(404, 'path_not_found', 'Gone.', { path: '/a' }), { write: false });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toBeUndefined();
    expect(r.content).toHaveLength(1);
    const parsed = JSON.parse((r.content[0] as { text: string }).text);
    expect(parsed.error).toEqual({ code: 'path_not_found', message: 'Gone.', hint: ERROR_HINTS.path_not_found, details: { path: '/a' } });
  });

  test('outcome mapping for writes', () => {
    expect(body(new ApiError(409, 'stale_base', 'x', { conflicts: [] }), true).details.outcome).toBe('not_committed');
    expect(body(new ApiError(413, 'quota_exceeded', 'x'), true).details.outcome).toBe('not_committed');
    const lost = body(new VolumeStoreError(503, 'unavailable', 'down'), true);
    expect(lost.code).toBe('upstream_unavailable');
    expect(lost.details.outcome).toBe('unknown');
    expect(lost.hint).toBe(UNKNOWN_OUTCOME_HINT);
    const crash = body(new TypeError('boom secret'), true);
    expect(crash).toMatchObject({ code: 'internal', message: 'Something went wrong.', details: { outcome: 'unknown' } });
    expect(body(new ApiError(404, 'not_found', 'x')).details.outcome).toBeUndefined();
    expect(body(new VolumeStoreError(503, 'unavailable', 'down')).hint).toBe('Try again shortly.');
  });

  test('rate limits expose retry_after_seconds; every mapped code has its hint', () => {
    const r = body(new ApiError(429, 'rate_limited', 'slow', { retryAfterSeconds: 7 }));
    expect(r.details).toEqual({ retry_after_seconds: 7 });
    for (const [code, hint] of Object.entries(ERROR_HINTS)) {
      if (code === 'internal' || code === 'upstream_unavailable') continue;
      expect(body(new ApiError(400, code as never, 'm')).hint).toBe(hint);
    }
    expect(PARTIAL_HINT('abc')).toContain('abc');
  });
});

describe('withTool()', () => {
  test('re-checks the scope and turns throws into error results', async () => {
    const run = withTool('undo', principal('drive:write', 'review'), async () => ok({ summary: 'x', data: {} }));
    const r = await run({});
    expect(r.isError).toBe(true);
    expect(JSON.parse((r.content[0] as { text: string }).text).error.code).toBe('insufficient_scope');
    const run2 = withTool('read_files', principal('drive:read'), async () => {
      throw new ApiError(404, 'not_found', 'nope');
    });
    const r2 = await run2({});
    expect(JSON.parse((r2.content[0] as { text: string }).text).error.code).toBe('not_found');
    const run3 = withTool('get_links', principal('drive:read'), async () => ok({ summary: 'fine', data: { a: 1 } }));
    expect((await run3({})).structuredContent).toEqual({ a: 1 });
  });
});

describe('output caps', () => {
  test('capBytes never splits a character', () => {
    const c = capBytes('aé€😀', 4);
    expect(c).toEqual({ text: 'aé', truncated: true, totalBytes: 10, shownBytes: 3 });
    expect(capBytes('abc', 10).truncated).toBe(false);
  });

  test('utf8Window snaps both ends to character boundaries', () => {
    const bytes = new TextEncoder().encode('é€x'); // c3 a9 | e2 82 ac | 78
    expect(utf8Window(bytes, 1, 10)).toEqual({ start: 2, end: 6, startAdjusted: true });
    expect(utf8Window(bytes, 0, 3)).toEqual({ start: 0, end: 2, startAdjusted: false });
    expect(utf8Window(bytes, 2, 3)).toEqual({ start: 2, end: 5, startAdjusted: false });
  });
});

// The Platinum driver against a scripted fetch: retries on the org write
// ceiling, upload slot accounting (no abort exists), and `queued` commits.
import { describe, expect, test } from 'bun:test';
import { PlatinumStore } from './platinum';
import { UploadSlots } from './upload-slots';

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

function scripted(replies: Reply[]) {
  const calls: { method: string; url: string }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    calls.push({ method: req.method, url: req.url });
    const r = replies.shift();
    if (!r) throw new Error(`unexpected call ${req.method} ${req.url}`);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json', ...(r.headers ?? {}) },
    });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const commitResult = (id: string, outcome = 'fast', head = id) => ({
  commit_id: id,
  outcome,
  head_commit_id: head,
  overwritten: [],
  skipped: [],
  overwritten_count: 0,
  duration_ms: 1,
});
const busy: Reply = { status: 429, body: { error: 'org write ceiling', code: 'rate_limited' }, headers: { 'retry-after': '0' } };
const V = 'vol_01J8ZQ3ABCDEFGHJKMNPQRSTVW';

describe('PlatinumStore', () => {
  test('mutations retry the org write ceiling (429) and then succeed', async () => {
    const { fetchFn, calls } = scripted([busy, busy, { status: 200, body: commitResult('vc_01J8ZQ3ABCDEFGHJKMNPQRSTV1') }]);
    const store = new PlatinumStore({ url: 'http://pt.test', token: 't', fetch: fetchFn, slots: new UploadSlots(), writeRetryMs: 5_000 });
    const r = await store.move(V, '/a', '/b');
    expect(r.commitId).toBe('vc_01J8ZQ3ABCDEFGHJKMNPQRSTV1');
    expect(calls.map((c) => c.method)).toEqual(['POST', 'POST', 'POST']);
  });

  test('an aborted plan keeps its local slot (Platinum still counts it); a commit frees it', async () => {
    const slots = new UploadSlots(4, 15 * 60_000);
    const { fetchFn } = scripted([
      { status: 200, body: { upload_id: 'vu_1', missing: [], expires_at: new Date().toISOString() } },
      { status: 200, body: { upload_id: 'vu_2', missing: [], expires_at: new Date().toISOString() } },
      { status: 200, body: { ...commitResult('vc_01J8ZQ3ABCDEFGHJKMNPQRSTV2'), files: 0 } },
    ]);
    const store = new PlatinumStore({ url: 'http://pt.test', token: 't', fetch: fetchFn, slots });
    const p1 = await store.planUpload(V, { files: [], dirs: ['/d'], overwrite: false });
    store.releaseUpload(p1.uploadId);
    expect(slots.inUse).toBe(1);
    const p2 = await store.planUpload(V, { files: [], dirs: ['/e'], overwrite: false });
    await store.commitUpload(V, p2.uploadId);
    expect(slots.inUse).toBe(1); // only the abandoned plan remains
  });

  test('org upload slots full: fail fast with the Retry-After instead of waiting on a held slot', async () => {
    const { fetchFn, calls } = scripted([
      { status: 429, body: { error: 'too many uploads', code: 'rate_limited', reason: 'org_uploads', retryAfterSeconds: 30 }, headers: { 'retry-after': '30' } },
    ]);
    const slots = new UploadSlots();
    const store = new PlatinumStore({ url: 'http://pt.test', token: 't', fetch: fetchFn, slots, planRetryMs: 60_000 });
    const t0 = Date.now();
    await expect(store.planUpload(V, { files: [], dirs: ['/d'], overwrite: false })).rejects.toMatchObject({
      code: 'rate_limited',
      extra: { reason: 'org_uploads', retryAfterSeconds: 30 },
    });
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(calls).toHaveLength(1);
    expect(slots.inUse).toBe(0);
  });

  test('an upload commit retries the write ceiling and resolves a queued merge', async () => {
    const old = 'vc_01J8ZQ3ABCDEFGHJKMNPQRSTV0';
    const side = 'vc_01J8ZQ3ABCDEFGHJKMNPQRSTV3';
    const merge = 'vc_01J8ZQ3ABCDEFGHJKMNPQRSTV4';
    const volume = (headId: string) => ({
      id: V,
      name: 'vx-test',
      kind: 'volume',
      temporary: false,
      head_commit_id: headId,
      size_limit_bytes: 1,
      logical_bytes: 0,
      unique_bytes: 0,
      file_count: 0,
      region: 'x',
      forked_from: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_commit_at: null,
      live_mounts: 0,
    });
    const { fetchFn } = scripted([busy, { status: 200, body: { ...commitResult(side, 'queued', old), files: 1 } }, { status: 200, body: volume(merge) }]);
    const store = new PlatinumStore({ url: 'http://pt.test', token: 't', fetch: fetchFn, slots: new UploadSlots(), mergeWaitMs: 10_000 });
    const r = await store.commitUpload(V, 'vu_9');
    expect(r).toMatchObject({ outcome: 'merged', commitId: side, headCommitId: merge, files: 1 });
  });
});

// resolveUploadPlan: validation, conflict resolution against head, ledger rows and the quota estimate.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { UploadPlanRequest, keepBothName } from '@volumes/shared';
import { resetRateLimits } from '../middleware/rate-limit';
import { getStore } from '../storage';
import { uploadBytes } from '../storage/contract';
import type { WorkspaceCtx } from '../types';
import { ApiError } from '../lib/http';
import { resetDb, sha256Hex, signInWithWorkspace } from '../../test/helpers';
import { uploadSummary } from '../routes/uploads';
import { logicalSize, resolveUploadPlan } from './upload-plan';
import { getWorkspaceForUser } from './workspaces';

const enc = (s: string) => new TextEncoder().encode(s);
let n = 0;
// The emulator allows 25 live volumes per process and resetDb() keeps volumes: drop ours after each test.
const created: string[] = [];
async function dropVolumes() {
  for (const v of created.splice(0)) await getStore().deleteVolume(v, { missingOk: true }).catch(() => {});
}

async function freshWs(): Promise<WorkspaceCtx> {
  const { ws, me } = await signInWithWorkspace(`plan-${Date.now().toString(36)}-${n++}@test.local`);
  const ctx = await getWorkspaceForUser(me.user.id, ws);
  if (!ctx) throw new Error('workspace missing');
  created.push(ctx.volumeId);
  return ctx;
}

const file = (path: string, content: string) => ({ path, size: enc(content).length, blocks: content ? [sha256Hex(content)] : [] });
const req = (body: unknown) => UploadPlanRequest.parse(body);

async function expectApiError(p: Promise<unknown>, status: number, code: string): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).status).toBe(status);
    expect((e as ApiError).code as string).toBe(code);
    return e as ApiError;
  }
  throw new Error(`expected ${status} ${code}`);
}

beforeAll(resetDb);
beforeEach(() => resetRateLimits());
afterEach(dropVolumes);
afterAll(dropVolumes);

describe('resolveUploadPlan', () => {
  test('a clean plan: added rows with block hashes, dirs, logical size estimate', async () => {
    const ws = await freshWs();
    const r = await resolveUploadPlan(ws, req({ files: [file('/a/x.txt', 'hello'), file('/a/empty.txt', '')], dirs: ['/a/sub'], conflict: 'ask' }));
    expect(r.plan).toEqual({
      files: [
        { path: '/a/x.txt', size: 5, blocks: [sha256Hex('hello')] },
        { path: '/a/empty.txt', size: 0, blocks: [] },
      ],
      dirs: ['/a/sub'],
      overwrite: false,
    });
    expect(r.renamed).toEqual([]);
    expect(r.totalBytes).toBe(5);
    expect(r.addedBytes).toBe(4096 + 0 + 4096 + 4096); // x.txt, empty.txt, /a/sub, and /a (a missing parent)
    expect(r.changes).toEqual([
      { op: 'added', path: '/a/x.txt', entryType: 'file', size: 5, prevSize: undefined, blockHashes: [sha256Hex('hello')], mtime: undefined },
      { op: 'added', path: '/a/empty.txt', entryType: 'file', size: 0, prevSize: undefined, blockHashes: [], mtime: undefined },
      { op: 'added', path: '/a/sub', entryType: 'dir' },
    ]);
    expect(await uploadSummary(ws, r)).toBe('Uploaded folder a (2 files)');
  });

  test('validation: block count, duplicates, a file used as a folder, the root', async () => {
    const ws = await freshWs();
    await expectApiError(resolveUploadPlan(ws, req({ files: [{ path: '/a', size: 2 * 1024 * 1024, blocks: [sha256Hex('x')] }] })), 400, 'bad_request');
    await expectApiError(resolveUploadPlan(ws, req({ files: [file('/a', 'x'), file('/a', 'y')] })), 400, 'bad_request');
    await expectApiError(resolveUploadPlan(ws, req({ files: [file('/a', 'x'), file('/a/b', 'y')] })), 400, 'bad_request');
    await expectApiError(resolveUploadPlan(ws, req({ files: [file('/a', 'x')], dirs: ['/a'] })), 400, 'bad_request');
    await expectApiError(resolveUploadPlan(ws, req({ files: [], dirs: ['/'] })), 400, 'invalid_path');
    expect(() => req({ files: [file('/a/../../b', 'x')] })).toThrow();
    expect(() => req({ files: [file('/a\u0000b', 'x')] })).toThrow();
  });

  test('ask lists every conflict; keep-both avoids head and the plan itself; replace counts only growth', async () => {
    const ws = await freshWs();
    const vol = ws.volumeId;
    await uploadBytes(getStore(), vol, '/docs/a.txt', enc('old'));
    await uploadBytes(getStore(), vol, '/docs/a (1).txt', enc('older'));
    await uploadBytes(getStore(), vol, '/docs/b.txt', enc('b'));

    const ask = await expectApiError(
      resolveUploadPlan(ws, req({ files: [file('/docs/a.txt', 'new'), file('/docs/b.txt', 'bb'), file('/docs/c.txt', 'c')], conflict: 'ask' })),
      409,
      'conflict',
    );
    expect(ask.details).toEqual({ conflicts: ['/docs/a.txt', '/docs/b.txt'] });

    // The plan also carries "a (2).txt", so the renamed copy must skip it.
    const kb = await resolveUploadPlan(
      ws,
      req({ files: [file('/docs/a.txt', 'new'), file('/docs/a (2).txt', 'two')], conflict: 'keep-both' }),
    );
    expect(kb.renamed).toEqual([{ from: '/docs/a.txt', to: '/docs/a (3).txt' }]);
    expect(kb.plan.files.map((f) => f.path)).toEqual(['/docs/a (3).txt', '/docs/a (2).txt']);
    expect(kb.plan.overwrite).toBe(false);
    expect(kb.changes.every((c) => c.op === 'added')).toBe(true);

    const rep = await resolveUploadPlan(ws, req({ files: [file('/docs/a.txt', 'x'.repeat(5000))], conflict: 'replace' }));
    expect(rep.plan.overwrite).toBe(true);
    expect(rep.replaced).toEqual(['/docs/a.txt']);
    expect(rep.changes[0]).toMatchObject({ op: 'changed', prevSize: 3, size: 5000 });
    expect(rep.addedBytes).toBe(logicalSize(5000) - logicalSize(3));
    expect(await uploadSummary(ws, rep)).toBe('Replaced a.txt');
    expect(keepBothName('a.txt', 3)).toBe('a (3).txt');
  });

  test('folder vs file clashes are refused with a clear code', async () => {
    const ws = await freshWs();
    await uploadBytes(getStore(), ws.volumeId, '/report', enc('a file named like a folder'));
    await getStore().planUpload(ws.volumeId, { files: [], dirs: ['/photos'], overwrite: false }).then(async (p) => {
      await getStore().commitUpload(ws.volumeId, p.uploadId);
    });
    await expectApiError(resolveUploadPlan(ws, req({ files: [file('/report/q1.txt', 'q')], conflict: 'replace' })), 409, 'not_a_directory');
    await expectApiError(resolveUploadPlan(ws, req({ files: [file('/report/deep/q1.txt', 'q')], conflict: 'ask' })), 409, 'not_a_directory');
    await expectApiError(resolveUploadPlan(ws, req({ files: [], dirs: ['/report'], conflict: 'ask' })), 409, 'not_a_directory');
    await expectApiError(resolveUploadPlan(ws, req({ files: [file('/photos', 'x')], conflict: 'replace' })), 409, 'not_a_file');
    // keep-both sidesteps the folder by renaming the file
    const kb = await resolveUploadPlan(ws, req({ files: [file('/photos', 'x')], conflict: 'keep-both' }));
    expect(kb.renamed).toEqual([{ from: '/photos', to: '/photos (1)' }]);
    // an existing folder in `dirs` is fine and records nothing
    const same = await resolveUploadPlan(ws, req({ files: [file('/photos/p.jpg', 'p')], dirs: ['/photos'], conflict: 'ask' }));
    expect(same.changes.map((c) => c.path)).toEqual(['/photos/p.jpg']);
    expect(await uploadSummary(ws, same)).toBe('Uploaded p.jpg to /photos');
  });

  test('summaries', async () => {
    const ws = await freshWs();
    const s = (files: string[], dirs: string[] = [], replaced: string[] = []) =>
      uploadSummary(ws, { plan: { files: files.map((path) => ({ path, size: 1, blocks: [] })), dirs, overwrite: false }, replaced });
    expect(await s(['/a.txt'])).toBe('Uploaded a.txt');
    expect(await s(['/a.txt', '/b.txt'])).toBe('Uploaded 2 files');
    expect(await s([], ['/New'])).toBe('Created folder New');
    expect(await s([], ['/A', '/B'])).toBe('Created 2 folders');
    expect(await s(['/Trip/a.jpg', '/Trip/day/b.jpg'], ['/Trip/empty'])).toBe('Uploaded folder Trip (2 files)');
    await uploadBytes(getStore(), ws.volumeId, '/Work/keep.txt', enc('k'));
    expect(await s(['/Work/a.txt', '/Work/b.txt'])).toBe('Uploaded 2 files to /Work');
    expect(await s(['/Work/Trip/a.jpg', '/Work/Trip/b.jpg'])).toBe('Uploaded folder Trip (2 files) to /Work');
  });
});

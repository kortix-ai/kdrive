import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { BLOCK_SIZE } from '@volumes/shared';
import { getStore } from '../storage';
import { withAction } from './ledger';
import { blockSourceFromMemory, hashBlocks, serverUpload } from './server-upload';
import { cleanWorld, countingStore, freshWorld, kitFor } from './versioning-test-kit';
import { readStream } from './versioning-util';

describe('serverUpload', () => {
  beforeEach(() => freshWorld());
  afterEach(cleanWorld);

  test('uploads a 2.5 MiB file from memory as 3 blocks in one commit', async () => {
    const k = await kitFor('su1@test.local');
    const bytes = new Uint8Array(BLOCK_SIZE * 2 + BLOCK_SIZE / 2).map((_, i) => (i * 7) % 253);
    const h = hashBlocks(bytes);
    expect(h.blocks).toHaveLength(3);
    const spy = countingStore();
    try {
      const { action } = await withAction(
        k.ctx,
        { kind: 'upload', summary: 'Wrote big.bin', paths: [{ op: 'added', path: '/big.bin', entryType: 'file', size: bytes.length, blockHashes: h.blocks }] },
        (rec) => serverUpload(k.ctx.ws, [{ path: '/big.bin', size: bytes.length, blocks: h.blocks }], [], blockSourceFromMemory(h.chunks), rec),
      );
      expect(action.status).toBe('committed');
      expect(spy.counts.putBlock).toBe(3);
    } finally {
      spy.restore();
    }
    const r = await getStore().read(k.vol, '/big.bin');
    expect(await readStream(r.body)).toEqual(bytes);
  });

  test('a source that returns the wrong bytes is refused before anything is sent', async () => {
    const k = await kitFor('su2@test.local');
    const bytes = new TextEncoder().encode('the real content');
    const h = hashBlocks(bytes);
    const wrong = new Map([[h.blocks[0], new TextEncoder().encode('something else!!')]]);
    const spy = countingStore();
    try {
      await expect(
        withAction(k.ctx, { kind: 'upload', summary: 'Wrote a.txt', paths: [] }, (rec) =>
          serverUpload(k.ctx.ws, [{ path: '/a.txt', size: bytes.length, blocks: h.blocks }], [], blockSourceFromMemory(wrong), rec),
        ),
      ).rejects.toMatchObject({ status: 500, code: 'internal' });
      expect(spy.counts.putBlock).toBe(0);
    } finally {
      spy.restore();
    }
    const listing = await getStore().list(k.vol, '/', {});
    expect(listing.entries.map((e) => e.path)).not.toContain('/a.txt');
  });

  test('hashBlocks: the empty file has no blocks; chunks are deduplicated', () => {
    expect(hashBlocks(new Uint8Array(0)).blocks).toEqual([]);
    const same = hashBlocks(new Uint8Array(BLOCK_SIZE * 2));
    expect(same.blocks).toHaveLength(2);
    expect(same.blocks[0]).toBe(same.blocks[1]);
    expect(same.chunks.size).toBe(1);
  });
});

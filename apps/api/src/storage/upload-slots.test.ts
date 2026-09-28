import { describe, expect, test } from 'bun:test';
import { UploadSlots } from './upload-slots';
import { VolumeStoreError } from './types';

describe('UploadSlots', () => {
  test('FIFO wait, release hands the slot over, timeout is rate_limited', async () => {
    const s = new UploadSlots(2);
    await s.acquire('a');
    await s.acquire('b');
    expect(s.inUse).toBe(2);
    const order: string[] = [];
    const c = s.acquire('c', { waitMs: 1000 }).then(() => order.push('c'));
    const d = s.acquire('d', { waitMs: 1000 }).then(() => order.push('d'));
    s.release('a');
    await c;
    s.release('b');
    await d;
    expect(order).toEqual(['c', 'd']);
    const e = await s.acquire('e', { waitMs: 20 }).catch((x) => x);
    expect(e).toBeInstanceOf(VolumeStoreError);
    expect((e as VolumeStoreError).code).toBe('rate_limited');
  });

  test('idle slots are swept after the TTL; rename re-keys', async () => {
    let t = 0;
    const s = new UploadSlots(1, 1000, () => t);
    await s.acquire('tmp');
    s.rename('tmp', 'real');
    expect(s.has('real')).toBe(true);
    t = 2000;
    expect(s.inUse).toBe(0);
  });
});

import { describe, expect, test } from 'bun:test';
import { registerInfinite, revalidateAll } from './swr';

describe('revalidateAll', () => {
  test('also refreshes paged lists (the timeline), which SWR key filters never reach', async () => {
    let calls = 0;
    const off = registerInfinite(async () => {
      calls++;
    });
    await revalidateAll();
    expect(calls).toBe(1);
    off();
    await revalidateAll();
    expect(calls).toBe(1);
  });
});

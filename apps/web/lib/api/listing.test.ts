import { describe, expect, test } from 'bun:test';
import { listingFor } from './listing';

describe('listing across a workspace switch', () => {
  const fromA = { path: '/', entries: [{ path: '/report.pdf', name: 'report.pdf' }] };

  test('a listing kept from the previous workspace is never shown (or acted on) as the new one', () => {
    // SWR keepPreviousData hands back ws-a's root while ws-b's root loads: rows (and their
    // delete / rename / move actions) would then target ws-b with ws-a's paths.
    expect(listingFor(fromA, 'ws-a', 'ws-b')).toBeUndefined();
    expect(listingFor(fromA, 'ws-a', null)).toBeUndefined();
  });

  test('within one workspace the previous listing is kept while the next folder loads (as before)', () => {
    expect(listingFor(fromA, 'ws-a', 'ws-a')).toBe(fromA);
    expect(listingFor(undefined, 'ws-a', 'ws-a')).toBeUndefined();
  });
});

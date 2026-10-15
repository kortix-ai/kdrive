import { describe, expect, test } from 'bun:test';
import { open, seal } from './secret-box';

const A = 'secret-a-0000000000000000000000000000000000';
const B = 'secret-b-0000000000000000000000000000000000';

describe('secret box', () => {
  test('round trip; every seal is different; the plain text never shows', () => {
    const one = seal('sk_test_abc123', A);
    const two = seal('sk_test_abc123', A);
    expect(one).not.toBe(two);
    expect(one.startsWith('v1:')).toBe(true);
    expect(one).not.toContain('sk_test');
    expect(open(one, A)).toBe('sk_test_abc123');
    expect(open(two, A)).toBe('sk_test_abc123');
    expect(open(seal('', A), A)).toBe('');
  });

  test('defaults to the server auth secret', () => {
    expect(open(seal('whsec_x'))).toBe('whsec_x');
    expect(open(seal('whsec_x'), A)).toBeNull();
  });

  test('another secret, tampering and malformed boxes open to null', () => {
    const box = seal('sk_live_abc123', A);
    expect(open(box, B)).toBeNull();
    const [v, iv, body] = box.split(':');
    const flipped = Buffer.from(body, 'base64url');
    flipped[0] ^= 1;
    expect(open(`${v}:${iv}:${flipped.toString('base64url')}`, A)).toBeNull();
    expect(open(`v2:${iv}:${body}`, A)).toBeNull();
    expect(open('sk_live_abc123', A)).toBeNull();
    expect(open('v1::', A)).toBeNull();
    expect(open(`v1:${iv}:AAAA`, A)).toBeNull();
  });
});

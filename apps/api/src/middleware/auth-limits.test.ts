import { describe, expect, test } from 'bun:test';
import { ApiError } from '../lib/http';
import { AUTH_BODY_MAX, bodyEmail, readAuthBody } from './auth-limits';
import { ipBucket } from './rate-limit';

const buf = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const status = (f: () => unknown) => {
  try {
    f();
    return 0;
  } catch (e) {
    return e instanceof ApiError ? e.status : -1;
  }
};

describe('readAuthBody fails closed', () => {
  test('reads a small JSON object', () => {
    expect(readAuthBody('application/json; charset=utf-8', buf('{"email":"A@x.test"}'))).toEqual({ email: 'A@x.test' });
  });
  test('refuses form bodies, oversized, unparseable and non-object bodies', () => {
    expect(status(() => readAuthBody('application/x-www-form-urlencoded', buf('email=a%40x.test')))).toBe(400);
    expect(status(() => readAuthBody(undefined, buf('{}')))).toBe(400);
    expect(status(() => readAuthBody('application/json', buf(`{"email":"a@x.test","pad":"${'x'.repeat(AUTH_BODY_MAX)}"}`)))).toBe(413);
    expect(status(() => readAuthBody('application/json', buf('{"email":')))).toBe(400);
    expect(status(() => readAuthBody('application/json', buf('["a@x.test"]')))).toBe(400);
    expect(status(() => readAuthBody('application/json', undefined))).toBe(400);
  });
  test('a missing address is a 400, never a skipped limit', () => {
    expect(bodyEmail({ email: ' Ada@X.test ' })).toBe('ada@x.test');
    expect(status(() => bodyEmail({}))).toBe(400);
    expect(status(() => bodyEmail({ email: 5 }))).toBe(400);
    expect(status(() => bodyEmail({ email: 'a@x.test' }, 'newEmail'))).toBe(400);
  });
});

describe('ipBucket', () => {
  test('IPv4 stays as is; IPv4-mapped IPv6 is its IPv4', () => {
    expect(ipBucket('203.0.113.9')).toBe('203.0.113.9');
    expect(ipBucket('::ffff:203.0.113.9')).toBe('203.0.113.9');
  });
  test('IPv6 counts as its /64', () => {
    const a = ipBucket('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    expect(a).toBe('2001:db8:1:2::/64');
    expect(ipBucket('2001:0db8:0001:0002::1')).toBe(a);
    expect(ipBucket('[2001:db8:1:2::ffff]')).toBe(a);
    expect(ipBucket('2001:db8:1:3::1')).not.toBe(a);
    expect(ipBucket('::1')).toBe('0:0:0:0::/64');
    expect(ipBucket('fe80::1%en0')).toBe('fe80:0:0:0::/64');
  });
});

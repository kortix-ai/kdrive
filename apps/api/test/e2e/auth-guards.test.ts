// End to end: the guards in front of better-auth's account routes. Per-address limits
// cannot be skipped by padding or re-encoding the body, IPv6 clients count per /64, and
// better-auth's origin, callbackURL and CSRF checks run in tests exactly as in production.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { TestClient } from '../helpers';
import { endWorld, freshWorld } from './kit';

beforeEach(async () => {
  await freshWorld();
});
afterAll(endWorld);

const PASSWORD = 'a fine password';
const json = (body: unknown, headers: Record<string, string> = {}) => ({
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json', ...headers },
});

describe('per-address limits fail closed', () => {
  test('a padded body is refused, not waved past the per-address bucket', async () => {
    const c = new TestClient('x');
    const r = await c.raw('POST', '/api/auth/sign-in/email', json({ email: 't@test.local', password: 'guess guess', pad: 'x'.repeat(5000) }));
    expect(r.status).toBe(413);
  });

  test('a form-encoded body is refused', async () => {
    const r = await new TestClient('x').raw('POST', '/api/auth/sign-in/email', {
      body: 'email=t%40test.local&password=guess+guess',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(r.status).toBe(400);
  });

  test('a body without the address is refused', async () => {
    const r = await new TestClient('x').post('/api/auth/request-password-reset', { redirectTo: '/reset-password' });
    expect(r.status).toBe(400);
  });

  test('guessing one address still stops at 10 whatever else the body carries', async () => {
    const c = new TestClient('x');
    const attempt = (i: number) => c.raw('POST', '/api/auth/sign-in/email', json({ email: 'T@test.local', password: `guess ${i} guess`, n: i }));
    for (let i = 0; i < 10; i++) expect((await attempt(i)).status).toBe(401);
    expect((await attempt(10)).status).toBe(429);
  });

  test('IPv6 clients share one budget per /64', async () => {
    const c = new TestClient('x');
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const r = await c.raw('POST', '/api/auth/sign-in/email', json({ email: `u${i}@test.local`, password: PASSWORD }, { 'x-forwarded-for': `2001:db8:1:2::${i.toString(16)}` }));
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
    const other = await c.raw('POST', '/api/auth/sign-in/email', json({ email: 'z@test.local', password: PASSWORD }, { 'x-forwarded-for': '2001:db8:1:3::1' }));
    expect(other.status).toBe(401);
  });
});

describe("better-auth's own origin checks run in tests", () => {
  test('a sign-in from a foreign origin is refused', async () => {
    const r = await new TestClient('x').raw('POST', '/api/auth/sign-in/email', json({ email: 'a@test.local', password: PASSWORD }, { origin: 'https://evil.example' }));
    expect(r.status).toBe(403);
  });

  test('absolute foreign callbacks are refused on verify-email, reset and forgot-password', async () => {
    const c = new TestClient('x');
    const evil = encodeURIComponent('https://evil.example/x');
    expect((await c.raw('GET', `/api/auth/verify-email?token=t&callbackURL=${evil}`)).status).toBe(403);
    expect((await c.raw('GET', `/api/auth/reset-password/sometoken?callbackURL=${evil}`)).status).toBe(403);
    const forgot = await c.post('/api/auth/request-password-reset', { email: 'a@test.local', redirectTo: 'https://evil.example/r' });
    expect(forgot.status).toBe(403);
  });
});

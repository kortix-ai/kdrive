import { describe, expect, test } from 'bun:test';
import { DEV_SECRET, EXAMPLE_SECRET, loadEnv } from './env';

const GOOD = 'a'.repeat(64);

describe('loadEnv hardening', () => {
  test('a missing NODE_ENV is development: dev login needs the opt-in and a localhost origin', () => {
    const e = loadEnv({ VOLUMES_DEV_LOGIN: '1' });
    expect(e.NODE_ENV).toBe('development');
    expect(e.devLoginEnabled).toBe(true);
    expect(e.secureCookies).toBe(false);
    expect(loadEnv({}).devLoginEnabled).toBe(false);
  });

  test('dev login stays off for a public origin, even in development', () => {
    const e = loadEnv({ VOLUMES_DEV_LOGIN: '1', BETTER_AUTH_URL: 'https://drive.example.com' });
    expect(e.devLoginEnabled).toBe(false);
    expect(e.secureCookies).toBe(true);
  });

  test('production refuses a missing, short, placeholder or dev secret', () => {
    const base = { NODE_ENV: 'production', BETTER_AUTH_URL: 'https://drive.example.com' };
    expect(() => loadEnv(base)).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => loadEnv({ ...base, BETTER_AUTH_SECRET: 'short' })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => loadEnv({ ...base, BETTER_AUTH_SECRET: EXAMPLE_SECRET })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => loadEnv({ ...base, BETTER_AUTH_SECRET: DEV_SECRET })).toThrow(/BETTER_AUTH_SECRET/);
    const ok = loadEnv({ ...base, BETTER_AUTH_SECRET: GOOD, VOLUMES_DEV_LOGIN: '1' });
    expect(ok.devLoginEnabled).toBe(false);
    expect(ok.secureCookies).toBe(true);
  });

  test('production over plain http keeps cookies without Secure (a local run), still no dev login', () => {
    const e = loadEnv({ NODE_ENV: 'production', BETTER_AUTH_SECRET: GOOD, VOLUMES_DEV_LOGIN: '1' });
    expect(e.devLoginEnabled).toBe(false);
    expect(e.secureCookies).toBe(false);
    expect(e.trustedOrigins).toEqual(['http://localhost:4100']);
  });

  test('the API listens on loopback unless told otherwise', () => {
    expect(loadEnv({}).API_HOST).toBe('127.0.0.1');
    expect(loadEnv({ API_HOST: '0.0.0.0' }).API_HOST).toBe('0.0.0.0');
  });
});

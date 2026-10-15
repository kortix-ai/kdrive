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

describe('account email settings', () => {
  const prod = { NODE_ENV: 'production', BETTER_AUTH_URL: 'https://drive.example.com', BETTER_AUTH_SECRET: 'a'.repeat(64) };

  test('defaults: open sign-up, verification optional, sender derived from the public origin', () => {
    const e = loadEnv(prod);
    expect(e.signupMode).toBe('open');
    expect(e.requireEmailVerification).toBe(false);
    expect(e.emailFrom).toEqual({ email: 'noreply@drive.example.com', name: 'KDRIVE' });
    // No provider in production: links are never printed, so the flows that need them are off.
    expect(e.emailLinks).toBe(false);
    expect(loadEnv({ ...prod, RESEND_API_KEY: 're_x' }).emailLinks).toBe(true);
    expect(loadEnv({}).emailLinks).toBe(true); // local run: printed to the API log
  });

  test('required verification without a provider refuses to boot outside development', () => {
    expect(() => loadEnv({ ...prod, VOLUMES_REQUIRE_EMAIL_VERIFICATION: '1' })).toThrow(/VOLUMES_REQUIRE_EMAIL_VERIFICATION/);
    expect(loadEnv({ ...prod, VOLUMES_REQUIRE_EMAIL_VERIFICATION: '1', MAILTRAP_API_TOKEN: 'm' }).requireEmailVerification).toBe(true);
    expect(loadEnv({ VOLUMES_REQUIRE_EMAIL_VERIFICATION: '1' }).requireEmailVerification).toBe(true);
  });

  test('sign-up mode and allowlist parse; unknown modes are refused', () => {
    const e = loadEnv({ VOLUMES_SIGNUP_MODE: 'invite-only', VOLUMES_SIGNUP_ALLOWLIST: ' Ada@X.test , @team.test ,' });
    expect(e.signupMode).toBe('invite-only');
    expect(e.signupAllowlist).toEqual(['ada@x.test', '@team.test']);
    expect(() => loadEnv({ VOLUMES_SIGNUP_MODE: 'maybe' })).toThrow(/VOLUMES_SIGNUP_MODE/);
  });

  test('Stripe: the secret key alone turns billing config on; the other variables are optional overrides', () => {
    expect(loadEnv({ NODE_ENV: 'test' }).stripe).toBeNull();
    expect(loadEnv({ NODE_ENV: 'test', STRIPE_SECRET_KEY: 'sk_test_abc12345' }).stripe).toEqual({
      secretKey: 'sk_test_abc12345',
      webhookSecret: null,
      prices: { plus: null, pro: null },
    });
    expect(loadEnv({ NODE_ENV: 'test', STRIPE_SECRET_KEY: 'sk_test_abc12345', STRIPE_PRICE_PLUS: 'price_1' }).stripe?.prices).toEqual({ plus: 'price_1', pro: null });
    // Overrides without a key are ignored, not a startup error.
    expect(loadEnv({ NODE_ENV: 'test', STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PRICE_PRO: 'price_2' }).stripe).toBeNull();
  });
});

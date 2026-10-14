import { describe, expect, test } from 'bun:test';
import { authErrorCopy, oauthErrorCopy, passwordStrength, providerButtonLabel, providerLabel, safeNext } from './auth-bits';

describe('safeNext', () => {
  test('keeps same-origin app paths', () => {
    expect(safeNext('/drive/docs?x=1')).toBe('/drive/docs?x=1');
    expect(safeNext('/settings')).toBe('/settings');
  });

  test('refuses other origins, empty values and the auth pages themselves', () => {
    for (const bad of [null, '', 'https://evil.test', '//evil.test', '/\\evil.test', '/signin', '/signup?next=/x', '/forgot-password', '/reset-password?token=t']) {
      expect(safeNext(bad)).toBe('/drive');
    }
    expect(safeNext('/signups')).toBe('/signups');
  });

  test('paths the browser would resolve to another host are refused (tab, newline, dot segments)', () => {
    for (const bad of ['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/%09/evil.com'.replace('%09', '\t'), '/.//evil.com', '/x/..//evil.com', '/\u0000/x', '/a\\b']) {
      expect(safeNext(bad)).toBe('/drive');
    }
    // The checked value is what the browser would navigate to.
    expect(safeNext('/drive/./docs?x=1#top')).toBe('/drive/docs?x=1#top');
  });

  test('an email confirm step may be a ?next= target; other verify-email states are not', () => {
    expect(safeNext('/verify-email?step=confirm&token=abc')).toBe('/verify-email?step=confirm&token=abc');
    expect(safeNext('/verify-email?step=verify&token=abc')).toBe('/drive');
    expect(safeNext('/verify-email?step=confirm')).toBe('/drive');
  });
});

describe('oauthErrorCopy', () => {
  test('an unlinked password account points at password sign-in and reset', () => {
    expect(oauthErrorCopy('account_not_linked')).toMatchObject({ reset: true, message: expect.stringMatching(/password account/) });
  });
  test('restricted sign-ups, cancellations and the rest', () => {
    expect(oauthErrorCopy('SIGNUP_RESTRICTED')?.message).toMatch(/invite-only/);
    expect(oauthErrorCopy('access_denied')?.message).toMatch(/cancelled/);
    expect(oauthErrorCopy('invalid_code')).toEqual({ message: 'Sign-in failed. Try again.', reset: false });
    expect(oauthErrorCopy(null)).toBeNull();
  });
});

describe('authErrorCopy', () => {
  test('maps better-auth codes to plain copy', () => {
    expect(authErrorCopy({ status: 401, code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }, 'x')).toBe('Wrong email or password.');
    expect(authErrorCopy({ status: 422, code: 'USER_ALREADY_EXISTS' }, 'x')).toMatch(/sign in or reset/);
    expect(authErrorCopy({ status: 429 }, 'x')).toMatch(/Too many attempts/);
  });

  test('falls back to the message, then the fallback', () => {
    expect(authErrorCopy({ status: 400, code: 'SOMETHING', message: 'Server said no' }, 'x')).toBe('Server said no');
    expect(authErrorCopy(null, 'Fallback.')).toBe('Fallback.');
  });
});

describe('passwordStrength', () => {
  test('length rules, patterns pull down', () => {
    expect(passwordStrength('short').score).toBe(0);
    expect(passwordStrength('password123').score).toBe(1);
    expect(passwordStrength('aaaaaaaaaaaa').score).toBe(1);
    expect(passwordStrength('tulip-river').score).toBeGreaterThanOrEqual(1);
    expect(passwordStrength('Tulip river 42!').score).toBeGreaterThanOrEqual(3);
    expect(passwordStrength('correct horse battery staple').score).toBe(4);
    expect(passwordStrength('x', 8).hint).toContain('8');
  });
});

describe('providerLabel and new codes', () => {
  test('provider ids read well', () => {
    expect(providerLabel('github')).toBe('GitHub');
    expect(providerLabel('google')).toBe('Google');
  });
  test('the sign-up page offers to sign up with a provider; sign-in continues', () => {
    expect(providerButtonLabel('google', 'signup')).toBe('Sign up with Google');
    expect(providerButtonLabel('google', 'signin')).toBe('Continue with Google');
    expect(providerButtonLabel('github', 'signup')).toBe('Sign up with GitHub');
  });
  test('verify-email is never a ?next= target', () => {
    expect(safeNext('/verify-email?error=x')).toBe('/drive');
  });
  test('restricted sign-ups and stale sessions get plain copy', () => {
    expect(authErrorCopy({ status: 403, code: 'SIGNUP_RESTRICTED' }, 'x')).toMatch(/invite-only/);
    expect(authErrorCopy({ status: 400, code: 'INVALID_PASSWORD' }, 'x')).toMatch(/current password/);
    expect(authErrorCopy({ status: 422, code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' }, 'x')).not.toMatch(/already exists/);
  });
});

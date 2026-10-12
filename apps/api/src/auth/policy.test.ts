import { afterEach, describe, expect, test } from 'bun:test';
import { env } from '../env';
import { hashPassword, verifyPassword } from './password';
import { emailActionLink, signupAllowed } from './policy';

const saved = { mode: env.signupMode, allow: env.signupAllowlist };
afterEach(() => Object.assign(env, { signupMode: saved.mode, signupAllowlist: saved.allow }));

describe('emailActionLink', () => {
  test('points at the app page with the step and token, never at the API', () => {
    const u = new URL(emailActionLink('approve', 'a.b-c_d'));
    expect(u.origin).toBe('http://localhost:4100');
    expect(u.pathname).toBe('/verify-email');
    expect(u.searchParams.get('step')).toBe('approve');
    expect(u.searchParams.get('token')).toBe('a.b-c_d');
    expect(u.href).not.toContain('/api/');
  });
});

describe('signupAllowed', () => {
  test('open lets anyone in', () => {
    env.signupMode = 'open';
    expect(signupAllowed('anyone@x.test')).toBe(true);
  });
  test('invite-only: listed addresses, listed domains and admins', () => {
    Object.assign(env, { signupMode: 'invite-only', signupAllowlist: ['ok@x.test', '@team.test'] });
    expect(signupAllowed('OK@x.test')).toBe(true);
    expect(signupAllowed('a@team.test')).toBe(true);
    expect(signupAllowed('a@sub.team.test')).toBe(false);
    expect(signupAllowed('admin@test.local')).toBe(true);
    expect(signupAllowed('no@x.test')).toBe(false);
  });
  test('closed: admins only', () => {
    Object.assign(env, { signupMode: 'closed', signupAllowlist: ['ok@x.test'] });
    expect(signupAllowed('ok@x.test')).toBe(false);
    expect(signupAllowed('admin@test.local')).toBe(true);
  });
});

describe('password hashing', () => {
  test('argon2id round trip; garbage hashes never verify', async () => {
    const h = await hashPassword('pw pw pw pw');
    expect(h).toStartWith('$argon2id$');
    expect(await verifyPassword({ hash: h, password: 'pw pw pw pw' })).toBe(true);
    expect(await verifyPassword({ hash: h, password: 'nope' })).toBe(false);
    expect(await verifyPassword({ hash: '', password: 'x' })).toBe(false);
    expect(await verifyPassword({ hash: 'zz:zz', password: 'x' })).toBe(false);
  });
});

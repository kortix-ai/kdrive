// End to end: account policy. Rate limits on sign-in / sign-up / forgot / resend,
// VOLUMES_SIGNUP_MODE (invite-only, closed) without revealing which addresses exist,
// VOLUMES_REQUIRE_EMAIL_VERIFICATION holding unverified users, and GET /api/config.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { env } from '../../src/env';
import { TestClient } from '../helpers';
import { captureMail, type Mailbox } from '../mail';
import { endWorld, freshWorld } from './kit';

let mail: Mailbox;
const saved = { mode: env.signupMode, allow: env.signupAllowlist, verify: env.requireEmailVerification };
beforeEach(async () => {
  await freshWorld();
  mail = captureMail();
});
afterEach(() => {
  Object.assign(env, { signupMode: saved.mode, signupAllowlist: saved.allow, requireEmailVerification: saved.verify });
  mail.restore();
  endWorld();
});
afterAll(endWorld);

const PASSWORD = 'a fine password';
const signUp = (email: string) => new TestClient(email).post('/api/auth/sign-up/email', { email, password: PASSWORD, name: 'N' });
const signIn = async (email: string, password = PASSWORD) => {
  const c = new TestClient(email);
  return { c, r: await c.post('/api/auth/sign-in/email', { email, password }) };
};

describe('rate limits', () => {
  test('sign-in guessing on one address stops at 10 per 15 minutes', async () => {
    await signUp('target@test.local');
    for (let i = 0; i < 10; i++) expect((await signIn('target@test.local', `guess number ${i}`)).r.status).toBe(401);
    const blocked = await signIn('target@test.local', PASSWORD);
    expect(blocked.r.status).toBe(429);
    expect(Number(blocked.r.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  test('forgot password: 3 mails per address per hour, the 4th ask is refused', async () => {
    await signUp('lost@test.local');
    const ask = () => new TestClient('x').post('/api/auth/request-password-reset', { email: 'lost@test.local', redirectTo: '/reset-password' });
    for (let i = 0; i < 3; i++) expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(429);
    expect(await mail.to('lost@test.local', 'password-reset')).toHaveLength(3);
  });

  test('resend verification: 3 per address per hour', async () => {
    const send = () => new TestClient('x').post('/api/auth/send-verification-email', { email: 'v@test.local' });
    for (let i = 0; i < 3; i++) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });

  test('sign-up: 10 per client per hour', async () => {
    for (let i = 0; i < 10; i++) expect((await signUp(`u${i}@test.local`)).status).toBe(200);
    expect((await signUp('u10@test.local')).status).toBe(429);
  });
});

describe('sign-up modes', () => {
  test('closed: refused the same way whether or not the address exists; admins still get in', async () => {
    await signUp('existing@test.local');
    env.signupMode = 'closed';
    const fresh = await signUp('fresh@test.local');
    const existing = await signUp('existing@test.local');
    expect([fresh.status, existing.status]).toEqual([403, 403]);
    expect(fresh.body).toEqual(existing.body);
    expect(await mail.to('existing@test.local', 'account-exists')).toHaveLength(0);
    expect((await signUp('admin@test.local')).status).toBe(200); // the mode gate only; rights still need verification
    // Existing accounts sign in as before.
    expect((await signIn('existing@test.local')).r.status).toBe(200);
  });

  test('invite-only: listed addresses and domains may join, nobody else (dev login included)', async () => {
    Object.assign(env, { signupMode: 'invite-only', signupAllowlist: ['ok@test.local', '@team.test'] });
    expect((await signUp('ok@test.local')).status).toBe(200);
    expect((await signUp('anyone@team.test')).status).toBe(200);
    expect((await signUp('no@test.local')).status).toBe(403);
    expect((await new TestClient('d').post('/api/auth/dev/sign-in', { email: 'dev@else.test' })).status).toBe(403);
  });
});

describe('required verification', () => {
  test('an unverified user is held: /api/me answers, the drive does not, until the link is opened', async () => {
    env.requireEmailVerification = true;
    await signUp('hold@test.local');
    const { c, r } = await signIn('hold@test.local');
    expect(r.status).toBe(200);
    const me = await c.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.user.emailVerified).toBe(false);
    expect(me.body.defaultWorkspaceId).toBeNull(); // no drive is provisioned while held
    const held = await c.get('/api/workspaces');
    expect(held.status).toBe(403);
    expect(held.body.error.code).toBe('email_not_verified');

    const link = await mail.link('hold@test.local', 'email-verify');
    await c.get(`/api/auth/verify-email?token=${encodeURIComponent(link.searchParams.get('token')!)}`);
    const ws = (await c.get('/api/me')).body.defaultWorkspaceId as string;
    expect((await c.get(`/api/w/${ws}/files?path=/`)).status).toBe(200);
  });

  test('off by default: unverified users use the app', async () => {
    await signUp('free@test.local');
    const { c } = await signIn('free@test.local');
    const me = await c.get('/api/me');
    expect((await c.get(`/api/w/${me.body.defaultWorkspaceId}/files?path=/`)).status).toBe(200);
  });
});

test('config says what is on, never how', async () => {
  const r = await new TestClient('anon').get('/api/config');
  expect(r.body).toMatchObject({
    emailPassword: true,
    passwordReset: true,
    emailVerification: true,
    requireEmailVerification: false,
    signupMode: 'open',
    email: { enabled: false },
  });
  expect(JSON.stringify(r.body)).not.toMatch(/resend|mailtrap|api_key|token/i);
});

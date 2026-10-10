// End to end: account takeover and privilege paths. Admin rights need a verified address,
// an unverified account cannot move its address, the last email-change step never signs a
// browser in, a reset takes the whole account back (agent credentials included), and
// sign-up neither provisions storage nor mails a registered address on demand.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createEmailVerificationToken } from 'better-auth/api';
import { resolvePrincipal } from '../../src/agents/principal';
import { bauthUser } from '../../src/auth/schema';
import { db } from '../../src/db/client';
import { workspaces } from '../../src/db/schema';
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
async function signIn(email: string, password = PASSWORD): Promise<TestClient> {
  const c = new TestClient(email);
  const r = await c.post('/api/auth/sign-in/email', { email, password });
  if (r.status !== 200) throw new Error(`sign-in ${r.status} ${r.text}`);
  return c;
}
/** What the /verify-email page does when the user presses its button. */
const confirm = (c: TestClient, link: URL) => c.get(`/api/auth/verify-email?token=${encodeURIComponent(link.searchParams.get('token')!)}`);
const verify = async (email: string) => confirm(new TestClient('inbox'), await mail.link(email, 'email-verify'));

describe('admin rights need a verified address', () => {
  test('signing up with an unclaimed admin address by password grants nothing until it is verified', async () => {
    expect((await signUp('admin@test.local')).status).toBe(200);
    const c = await signIn('admin@test.local');
    expect((await c.get('/api/admin/users')).status).toBe(403);
    expect((await c.get('/api/me')).body.isAdmin).toBe(false);
    expect((await verify('admin@test.local')).status).toBe(200);
    expect((await c.get('/api/admin/users')).status).toBe(200);
    expect((await c.get('/api/me')).body.isAdmin).toBe(true);
  });
});

describe('email change cannot launder an unowned address', () => {
  beforeEach(() => {
    Object.assign(env, { signupMode: 'invite-only', signupAllowlist: ['@corp.test'], requireEmailVerification: true });
  });

  test('an unverified account cannot change its address at all', async () => {
    await signUp('nobody@corp.test');
    const c = await signIn('nobody@corp.test');
    const r = await c.post('/api/auth/change-email', { newEmail: 'evil@gmail.test' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(await mail.to('evil@gmail.test')).toHaveLength(0);
  });

  test('a verified account cannot move outside the sign-up policy, even with a valid token', async () => {
    await signUp('ok@corp.test');
    await verify('ok@corp.test');
    const c = await signIn('ok@corp.test');
    const r = await c.post('/api/auth/change-email', { newEmail: 'evil@gmail.test' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SIGNUP_RESTRICTED');
    // The update hook holds even for a correctly signed final-step token.
    const token = await createEmailVerificationToken(env.BETTER_AUTH_SECRET, 'ok@corp.test', 'evil@gmail.test', 3600, {
      requestType: 'change-email-verification',
    });
    expect((await c.get(`/api/auth/verify-email?token=${token}`)).status).toBe(403);
    expect((await c.get('/api/me')).body.user.email).toBe('ok@corp.test');
  });

  test('the final link needs the account to be signed in; it never mints a session', async () => {
    await signUp('ok@corp.test');
    await verify('ok@corp.test');
    const c = await signIn('ok@corp.test');
    expect((await c.post('/api/auth/change-email', { newEmail: 'new@corp.test' })).status).toBe(200);
    expect((await confirm(new TestClient('x'), await mail.link('ok@corp.test', 'email-change-confirm'))).status).toBe(200);
    const done = await mail.link('new@corp.test', 'email-change-verify');
    const stranger = new TestClient('stranger');
    const r = await confirm(stranger, done);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('SIGN_IN_REQUIRED');
    expect(stranger.cookies.size).toBe(0);
    expect((await c.get('/api/me')).body.user.email).toBe('ok@corp.test');
    expect((await confirm(c, done)).status).toBe(200);
    expect((await c.get('/api/me')).body.user).toMatchObject({ email: 'new@corp.test', emailVerified: true });
  });
});

describe('a password reset takes the whole account back', () => {
  test("a squatter's agent tokens stop working, and the reset verifies the address", async () => {
    await signUp('victim@test.local');
    const squatter = await signIn('victim@test.local');
    await squatter.get('/api/me');
    const pat = await squatter.post('/api/agents/tokens', { name: 'mine', scope: 'drive:read', mode: 'review', workspaceId: null });
    expect(pat.status).toBe(201);
    expect('user' in (await resolvePrincipal(`Bearer ${pat.body.secret}`))).toBe(true);

    await new TestClient('victim').post('/api/auth/request-password-reset', { email: 'victim@test.local', redirectTo: '/reset-password' });
    const link = await mail.link('victim@test.local', 'password-reset');
    const hop = await new TestClient('victim').raw('GET', `${link.pathname}${link.search}`);
    const token = new URL(hop.headers.get('location')!, 'http://localhost:4100').searchParams.get('token');
    expect((await new TestClient('victim').post('/api/auth/reset-password', { token, newPassword: 'the real owner 1' })).status).toBe(200);

    expect((await squatter.get('/api/me')).status).toBe(401);
    expect(await resolvePrincipal(`Bearer ${pat.body.secret}`)).toMatchObject({ status: 401 });
    const [u] = await db.select().from(bauthUser).where(eq(bauthUser.email, 'victim@test.local'));
    expect(u!.emailVerified).toBe(true);
    const notice = (await mail.to('victim@test.local', 'password-changed')).at(-1)!;
    expect(notice.text).toContain('1 agent token');
  });

  test('change password with "sign out other sessions" ends agent tokens too', async () => {
    await signUp('owner@test.local');
    const c = await signIn('owner@test.local');
    const pat = await c.post('/api/agents/tokens', { name: 't', scope: 'drive:read', mode: 'review', workspaceId: null });
    const r = await c.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'another fine one', revokeOtherSessions: true });
    expect(r.status).toBe(200);
    expect(await resolvePrincipal(`Bearer ${pat.body.secret}`)).toMatchObject({ status: 401 });
  });
});

describe('sign-up costs nothing and mails nobody on demand', () => {
  test('sign-up provisions no drive; a held user gets none until verified', async () => {
    env.requireEmailVerification = true;
    await signUp('held@test.local');
    const [u] = await db.select().from(bauthUser).where(eq(bauthUser.email, 'held@test.local'));
    const c = await signIn('held@test.local');
    const me = await c.get('/api/me');
    expect(me.body).toMatchObject({ defaultWorkspaceId: null, workspaces: [] });
    expect(await db.select().from(workspaces).where(eq(workspaces.userId, u!.id))).toHaveLength(0);
    await verify('held@test.local');
    expect((await c.get('/api/me')).body.defaultWorkspaceId).toEqual(expect.any(String));
  });

  test('repeat sign-ups for a registered address: one heads-up mail, then the address is limited', async () => {
    await signUp('taken@test.local');
    for (let i = 0; i < 4; i++) expect((await signUp('taken@test.local')).status).toBe(200);
    expect(await mail.to('taken@test.local', 'account-exists')).toHaveLength(1);
    expect((await signUp('taken@test.local')).status).toBe(429);
  });
});

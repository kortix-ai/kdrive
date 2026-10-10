// End to end: email + password accounts. Sign-up (enumeration-safe, then sign-in),
// argon2id hashes (legacy scrypt hashes still verify), the verify-email round trip
// through a captured mail (the page link, then the page's API call), forgot/reset with session revocation, change password
// with the notice mail, and "sign out other sessions".
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { hashPassword as scryptHash } from 'better-auth/crypto';
import { PASSWORD_MAX } from '@volumes/shared';
import { bauthAccount, bauthUser } from '../../src/auth/schema';
import { db } from '../../src/db/client';
import { TestClient } from '../helpers';
import { captureMail, type Mailbox } from '../mail';
import { endWorld, freshWorld } from './kit';

let mail: Mailbox;
beforeEach(async () => {
  await freshWorld();
  mail = captureMail();
});
afterEach(() => {
  mail.restore();
  endWorld();
});
afterAll(endWorld);

const EMAIL = 'ada@test.local';
const PASSWORD = 'correct horse battery';

async function signUp(email = EMAIL, password = PASSWORD, name = 'Ada') {
  return new TestClient(email).post('/api/auth/sign-up/email', { email, password, name, callbackURL: '/verify-email' });
}
async function signIn(email = EMAIL, password = PASSWORD) {
  const c = new TestClient(email);
  const r = await c.post('/api/auth/sign-in/email', { email, password });
  return { c, r };
}

describe('sign up and sign in', () => {
  test('sign-up creates the account without a session; signing in opens a ready drive', async () => {
    const r = await signUp();
    expect(r.status).toBe(200);
    expect(r.body.token).toBeNull();
    expect(r.headers.get('set-cookie') ?? '').not.toContain('session_token');
    const { c, r: s } = await signIn();
    expect(s.status).toBe(200);
    const me = await c.get('/api/me');
    expect(me.body.user).toMatchObject({ email: EMAIL, name: 'Ada', emailVerified: false });
    expect(me.body.workspaces.map((w: { name: string }) => w.name)).toEqual(['My Drive']);
  });

  test('a taken address gets the same answer as a new one, and its owner gets a heads-up', async () => {
    const first = await signUp();
    const again = await signUp(EMAIL.toUpperCase(), 'another password 1', 'Mallory');
    expect(again.status).toBe(first.status);
    expect(Object.keys(again.body).sort()).toEqual(Object.keys(first.body).sort());
    expect(again.body.token).toBeNull();
    expect(await mail.to(EMAIL, 'account-exists')).toHaveLength(1);
    // The original password still works; the attempted one does not.
    expect((await signIn()).r.status).toBe(200);
    expect((await signIn(EMAIL, 'another password 1')).r.status).toBe(401);
  });

  test('wrong password and unknown email answer identically', async () => {
    await signUp();
    const a = await signIn(EMAIL, 'not the password');
    const b = await signIn('nobody@test.local', PASSWORD);
    expect([a.r.status, b.r.status]).toEqual([401, 401]);
    expect(a.r.body).toEqual(b.r.body);
    expect((await a.c.get('/api/me')).status).toBe(401);
  });

  test('passwords outside the length limits are refused', async () => {
    expect((await signUp('short@test.local', 'short')).status).toBe(400);
    expect((await signUp('long@test.local', 'x'.repeat(PASSWORD_MAX + 1))).status).toBe(400);
  });

  test('new hashes are argon2id; a legacy scrypt hash still signs in', async () => {
    await signUp();
    const [u] = await db.select().from(bauthUser).where(eq(bauthUser.email, EMAIL));
    const [acct] = await db.select().from(bauthAccount).where(eq(bauthAccount.userId, u!.id));
    expect(acct!.password).toStartWith('$argon2id$');
    await db.update(bauthAccount).set({ password: await scryptHash(PASSWORD) }).where(eq(bauthAccount.id, acct!.id));
    expect((await signIn()).r.status).toBe(200);
    expect((await signIn(EMAIL, 'wrong password!')).r.status).toBe(401);
  });
});

describe('email verification', () => {
  test('sign-up mails a page link; pressing confirm verifies once and never signs anyone in', async () => {
    await signUp();
    const link = await mail.link(EMAIL, 'email-verify');
    // The mail carries the app page, not the API call: a scanner fetching it changes nothing.
    expect(link.origin).toBe('http://localhost:4100');
    expect(link.pathname).toBe('/verify-email');
    expect(link.searchParams.get('step')).toBe('verify');
    const { c: before } = await signIn();
    expect((await before.get('/api/me')).body.user.emailVerified).toBe(false);

    const opener = new TestClient('someone-else');
    const r = await opener.get(`/api/auth/verify-email?token=${encodeURIComponent(link.searchParams.get('token')!)}`);
    expect(r.status).toBe(200);
    expect((await opener.get('/api/me')).status).toBe(401); // autoSignInAfterVerification: false
    const { c } = await signIn();
    expect((await c.get('/api/me')).body.user.emailVerified).toBe(true);
    expect(await mail.to(EMAIL, 'welcome')).toHaveLength(1);
  });

  test('a tampered token is refused with INVALID_TOKEN', async () => {
    await signUp();
    const link = await mail.link(EMAIL, 'email-verify');
    const r = await new TestClient('x').get(`/api/auth/verify-email?token=${link.searchParams.get('token')}x`);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('INVALID_TOKEN');
  });

  test('resend answers the same for an unknown address and only mails the real one', async () => {
    await signUp();
    const { c } = await signIn();
    const mine = await c.post('/api/auth/send-verification-email', { email: EMAIL, callbackURL: '/verify-email' });
    const ghost = await new TestClient('x').post('/api/auth/send-verification-email', { email: 'ghost@test.local', callbackURL: '/verify-email' });
    expect([mine.status, ghost.status]).toEqual([200, 200]);
    expect(mine.body).toEqual(ghost.body);
    expect(await mail.to(EMAIL, 'email-verify')).toHaveLength(2);
    expect(await mail.to('ghost@test.local')).toHaveLength(0);
  });
});

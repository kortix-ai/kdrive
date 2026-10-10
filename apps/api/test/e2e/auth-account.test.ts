// End to end: forgot / reset password (mail, one-time token, every session ends, notice
// mail), change password (other sessions end, notice mail), "sign out other sessions"
// and the two-step email change.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
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

const EMAIL = 'grace@test.local';
const PASSWORD = 'first password 1';
const NEXT = 'second password 2';

async function account(): Promise<TestClient> {
  await new TestClient(EMAIL).post('/api/auth/sign-up/email', { email: EMAIL, password: PASSWORD, name: 'Grace' });
  return session();
}
async function session(password = PASSWORD): Promise<TestClient> {
  const c = new TestClient(EMAIL);
  const r = await c.post('/api/auth/sign-in/email', { email: EMAIL, password });
  if (r.status !== 200) throw new Error(`sign-in ${r.status} ${r.text}`);
  return c;
}
const follow = (c: TestClient, u: URL) => c.raw('GET', `${u.pathname}${u.search}`);
/** What the /verify-email page does when the user presses its button. */
const confirm = (c: TestClient, u: URL) => c.get(`/api/auth/verify-email?token=${encodeURIComponent(u.searchParams.get('token')!)}`);

describe('forgot and reset password', () => {
  test('the mailed link resets once, ends every session, and sends a notice', async () => {
    const a = await account();
    const b = await session();
    const ask = await new TestClient('x').post('/api/auth/request-password-reset', { email: EMAIL, redirectTo: '/reset-password' });
    const ghost = await new TestClient('x').post('/api/auth/request-password-reset', { email: 'ghost@test.local', redirectTo: '/reset-password' });
    expect([ask.status, ghost.status]).toEqual([200, 200]);
    expect(ask.body).toEqual(ghost.body);
    expect(await mail.to('ghost@test.local')).toHaveLength(0);

    const link = await mail.link(EMAIL, 'password-reset');
    const hop = await follow(new TestClient('x'), link);
    expect(hop.status).toBe(302);
    const token = new URL(hop.headers.get('location')!, 'http://localhost:4100').searchParams.get('token');
    expect(token).toBeTruthy();

    const reset = await new TestClient('x').post('/api/auth/reset-password', { token, newPassword: NEXT });
    expect(reset.status).toBe(200);
    expect((await a.get('/api/me')).status).toBe(401);
    expect((await b.get('/api/me')).status).toBe(401);
    expect(await mail.to(EMAIL, 'password-changed')).toHaveLength(1);

    const again = await new TestClient('x').post('/api/auth/reset-password', { token, newPassword: 'third password 3' });
    expect(again.status).toBe(400);
    await expect(session(PASSWORD)).rejects.toThrow('401');
    expect((await (await session(NEXT)).get('/api/me')).status).toBe(200);
  });
});

describe('signed-in account changes', () => {
  test('change password keeps this session, ends the others and sends a notice', async () => {
    const here = await account();
    const there = await session();
    const wrong = await here.post('/api/auth/change-password', { currentPassword: 'nope nope nope', newPassword: NEXT });
    expect(wrong.status).toBe(400);
    const r = await here.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: NEXT, revokeOtherSessions: true });
    expect(r.status).toBe(200);
    expect((await here.get('/api/me')).status).toBe(200);
    expect((await there.get('/api/me')).status).toBe(401);
    expect(await mail.to(EMAIL, 'password-changed')).toHaveLength(1);
    expect((await session(NEXT)).cookies.size).toBeGreaterThan(0);
  });

  test('sign out other sessions', async () => {
    const here = await account();
    const there = await session();
    const list = await here.get('/api/auth/list-sessions');
    expect(list.body).toHaveLength(2);
    expect((await here.post('/api/auth/revoke-other-sessions')).status).toBe(200);
    expect((await here.get('/api/me')).status).toBe(200);
    expect((await there.get('/api/me')).status).toBe(401);
  });

  test('email change: the old inbox approves, the new inbox confirms, then the address moves', async () => {
    const c = await account();
    await confirm(new TestClient('x'), await mail.link(EMAIL, 'email-verify')); // only verified accounts may change
    const NEW = 'grace.new@test.local';
    const r = await c.post('/api/auth/change-email', { newEmail: NEW, callbackURL: '/settings' });
    expect(r.status).toBe(200);
    const approve = await mail.link(EMAIL, 'email-change-confirm');
    expect(approve.pathname).toBe('/verify-email');
    expect(approve.searchParams.get('step')).toBe('approve');
    expect((await confirm(new TestClient('old-inbox'), approve)).status).toBe(200);
    expect((await c.get('/api/me')).body.user.email).toBe(EMAIL); // nothing moved yet

    const done = await mail.link(NEW, 'email-change-verify');
    expect(done.searchParams.get('step')).toBe('confirm');
    expect((await confirm(c, done)).status).toBe(200);
    const me = await c.get('/api/me');
    expect(me.body.user).toMatchObject({ email: NEW, emailVerified: true });
    expect(await mail.to(NEW, 'welcome')).toHaveLength(0); // a change is not a new account
  });

  test('changing to an address that is taken answers like any other change and mails nobody', async () => {
    const c = await account();
    await confirm(new TestClient('x'), await mail.link(EMAIL, 'email-verify'));
    await new TestClient('o').post('/api/auth/sign-up/email', { email: 'taken@test.local', password: PASSWORD, name: 'O' });
    const before = mail.outbox.length;
    const r = await c.post('/api/auth/change-email', { newEmail: 'taken@test.local' });
    expect(r.status).toBe(200);
    await mail.to('taken@test.local'); // settle background sends
    expect(mail.outbox.slice(before).filter((m) => m.category.startsWith('email-change'))).toHaveLength(0);
  });
});

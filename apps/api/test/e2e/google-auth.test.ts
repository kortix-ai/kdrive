// End to end: sign up and sign in with Google. The real app drives better-auth's whole provider
// flow (POST /sign-in/social → Google's authorize URL → GET /callback/google); only Google's token
// endpoint is answered in-process, with an unsigned ID token carrying the profile under test.
// Covers: the redirect URI we send, first sign-in creating a verified account with its drive and
// welcome mail, the sign-up mode gate (refused with ?error=SIGNUP_RESTRICTED, nothing created),
// and account linking (only when Google and this account have both verified the address).
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { bauthAccount, bauthUser } from '../../src/auth/schema';
import { db } from '../../src/db/client';
import { auditEvents } from '../../src/db/schema';
import { env } from '../../src/env';
import { ORIGIN, TestClient } from '../helpers';
import { captureMail, type Mailbox } from '../mail';
import { endWorld, freshWorld } from './kit';

const CALLBACK = `${ORIGIN}/api/auth/callback/google`;
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

interface GoogleProfile {
  email: string;
  verified?: boolean;
  sub?: string;
  name?: string;
}

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** An ID token as Google's token endpoint returns it (unsigned: the code exchange is the trust). */
const idToken = (p: GoogleProfile) =>
  `${b64url({ alg: 'RS256', kid: 'test', typ: 'JWT' })}.${b64url({
    iss: 'https://accounts.google.com',
    aud: env.GOOGLE_CLIENT_ID,
    sub: p.sub ?? `g-${p.email}`,
    email: p.email,
    email_verified: p.verified ?? true,
    name: p.name ?? 'Google Person',
    picture: 'https://lh3.googleusercontent.com/a/test',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.sig`;

const realFetch = globalThis.fetch;
let profile: GoogleProfile | null = null;
let tokenRequests: URLSearchParams[] = [];

let mail: Mailbox;
const saved = { mode: env.signupMode, allow: env.signupAllowlist };
beforeEach(async () => {
  await freshWorld();
  mail = captureMail();
  tokenRequests = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(TOKEN_ENDPOINT)) return realFetch(input, init);
    tokenRequests.push(new URLSearchParams(String(init?.body ?? '')));
    if (!profile) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    return Response.json({ access_token: 'ya29.test', expires_in: 3599, token_type: 'Bearer', scope: 'openid email profile', id_token: idToken(profile) });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  profile = null;
  Object.assign(env, { signupMode: saved.mode, signupAllowlist: saved.allow });
  mail.restore();
  endWorld();
});
afterAll(endWorld);

/** What the sign-in and sign-up pages send: back to the page itself on failure. */
async function startGoogle(c: TestClient, page: '/signin' | '/signup' = '/signup') {
  const r = await c.post('/api/auth/sign-in/social', {
    provider: 'google',
    callbackURL: `${ORIGIN}/drive`,
    errorCallbackURL: `${ORIGIN}${page}?next=%2Fdrive`,
  });
  expect(r.status).toBe(200);
  return new URL(r.body.url as string);
}

/** The whole round trip as the browser makes it; returns where the callback sends the browser. */
async function google(p: GoogleProfile, page: '/signin' | '/signup' = '/signup', c = new TestClient(p.email)) {
  const authorize = await startGoogle(c, page);
  profile = p;
  const cb = await c.raw('GET', `/api/auth/callback/google?${new URLSearchParams({ code: 'google-code', state: authorize.searchParams.get('state')! })}`);
  expect(cb.status).toBe(302);
  return { c, location: new URL(cb.headers.get('location')!, ORIGIN) };
}

const userRow = async (email: string) => (await db.select().from(bauthUser).where(eq(bauthUser.email, email)))[0];
const providersOf = async (userId: string) =>
  (await db.select({ p: bauthAccount.providerId }).from(bauthAccount).where(eq(bauthAccount.userId, userId))).map((r) => r.p).sort();

describe('Google sign-in wiring', () => {
  test('config lists google; the authorize URL carries our callback, PKCE and the identity scopes', async () => {
    expect((await new TestClient('anon').get('/api/config')).body.providers).toEqual(['google']);
    const u = await startGoogle(new TestClient('x'));
    expect(`${u.origin}${u.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('redirect_uri')).toBe(CALLBACK);
    expect(u.searchParams.get('client_id')).toBe(env.GOOGLE_CLIENT_ID!);
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')!.split(' ').sort()).toEqual(['email', 'openid', 'profile']);
    expect(u.searchParams.get('state')).toBeTruthy();
  });

  test('a callback whose state this browser never started is refused', async () => {
    profile = { email: 'x@gmail.test' };
    const r = await new TestClient('x').raw('GET', '/api/auth/callback/google?code=c&state=forged');
    expect(r.status).toBe(302);
    expect(new URL(r.headers.get('location')!, ORIGIN).searchParams.get('error')).toBeTruthy();
    expect(await userRow('x@gmail.test')).toBeUndefined();
  });
});

describe('sign up with Google', () => {
  test('first sign-in creates a verified account: drive on first /api/me, welcome mail, audit', async () => {
    const { c, location } = await google({ email: 'New.Person@Gmail.test', name: 'New Person' });
    expect(location.href).toBe(`${ORIGIN}/drive`);
    // The code went to Google's token endpoint with the same redirect URI and the PKCE verifier.
    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0].get('redirect_uri')).toBe(CALLBACK);
    expect(tokenRequests[0].get('code_verifier')).toBeTruthy();

    const me = await c.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email: 'new.person@gmail.test', name: 'New Person', emailVerified: true });
    expect(me.body.defaultWorkspaceId).toBeTruthy();
    expect(me.body.workspaces).toHaveLength(1);

    const row = await userRow('new.person@gmail.test');
    expect(await providersOf(row.id)).toEqual(['google']);
    expect(await mail.to('new.person@gmail.test', 'welcome')).toHaveLength(1);
    expect(await mail.to('new.person@gmail.test', 'email-verify')).toHaveLength(0);
    const kinds = (await db.select({ k: auditEvents.kind }).from(auditEvents).where(eq(auditEvents.userId, row.id))).map((r) => r.k);
    expect(kinds).toContain('auth.sign_up');
    expect(kinds).toContain('auth.sign_in');
  });

  test('signing in again reuses the account (no second user, no second welcome)', async () => {
    await google({ email: 'again@gmail.test' });
    const { c, location } = await google({ email: 'again@gmail.test' }, '/signin');
    expect(location.pathname).toBe('/drive');
    expect((await c.get('/api/me')).body.workspaces).toHaveLength(1);
    expect(await db.select().from(bauthUser)).toHaveLength(1);
    expect(await mail.to('again@gmail.test', 'welcome')).toHaveLength(1);
  });

  test('an address Google has not verified gets an unverified account and a verification mail', async () => {
    const { c } = await google({ email: 'unproven@corp.test', verified: false });
    expect((await c.get('/api/me')).body.user.emailVerified).toBe(false);
    expect(await mail.to('unproven@corp.test', 'email-verify')).toHaveLength(1);
    expect(await mail.to('unproven@corp.test', 'welcome')).toHaveLength(0);
  });
});

describe('the sign-up mode applies to Google sign-ups', () => {
  test('invite-only: a non-invited address is sent back with SIGNUP_RESTRICTED and nothing is created', async () => {
    Object.assign(env, { signupMode: 'invite-only', signupAllowlist: ['@team.test'] });
    const { c, location } = await google({ email: 'stranger@gmail.test' });
    expect(location.origin + location.pathname).toBe(`${ORIGIN}/signup`);
    expect(location.searchParams.get('error')).toBe('SIGNUP_RESTRICTED');
    expect(location.searchParams.get('next')).toBe('/drive');
    expect(await userRow('stranger@gmail.test')).toBeUndefined();
    expect(await db.select().from(bauthAccount)).toHaveLength(0);
    expect((await c.get('/api/me')).status).toBe(401);
    expect(mail.outbox).toHaveLength(0);
  });

  test('invite-only: invited domains, invited addresses and admins get in', async () => {
    Object.assign(env, { signupMode: 'invite-only', signupAllowlist: ['@team.test', 'guest@gmail.test'] });
    for (const email of ['someone@team.test', 'guest@gmail.test', 'admin@test.local']) {
      const { c, location } = await google({ email });
      expect(location.pathname).toBe('/drive');
      expect((await c.get('/api/me')).status).toBe(200);
    }
  });

  test('closed: refused on /signin too; an account that already exists still signs in', async () => {
    await google({ email: 'member@gmail.test' });
    env.signupMode = 'closed';
    const refused = await google({ email: 'late@gmail.test' }, '/signin');
    expect(refused.location.pathname).toBe('/signin');
    expect(refused.location.searchParams.get('error')).toBe('SIGNUP_RESTRICTED');
    expect(await userRow('late@gmail.test')).toBeUndefined();
    const member = await google({ email: 'member@gmail.test' }, '/signin');
    expect(member.location.pathname).toBe('/drive');
    expect((await member.c.get('/api/me')).status).toBe(200);
  });
});

describe('a password account with the same address', () => {
  const PASSWORD = 'a fine password';
  async function passwordAccount(email: string, verified: boolean) {
    expect((await new TestClient(email).post('/api/auth/sign-up/email', { email, password: PASSWORD, name: 'Pw' })).status).toBe(200);
    if (verified) await db.update(bauthUser).set({ emailVerified: true }).where(eq(bauthUser.email, email));
    return (await userRow(email)).id;
  }

  test('verified here and at Google: Google joins the same account', async () => {
    const id = await passwordAccount('both@gmail.test', true);
    const { c, location } = await google({ email: 'both@gmail.test' }, '/signin');
    expect(location.pathname).toBe('/drive');
    expect((await c.get('/api/me')).body.user.id).toBe(id);
    expect(await providersOf(id)).toEqual(['credential', 'google']);
    expect(await db.select().from(bauthUser)).toHaveLength(1);
  });

  test('never verified here: no link (whoever typed the address may not own it); reset the password first', async () => {
    const id = await passwordAccount('squatted@gmail.test', false);
    const { c, location } = await google({ email: 'squatted@gmail.test' }, '/signin');
    expect(location.pathname).toBe('/signin');
    expect(location.searchParams.get('error')).toBe('account_not_linked');
    expect(await providersOf(id)).toEqual(['credential']);
    expect((await c.get('/api/me')).status).toBe(401);
    expect((await userRow('squatted@gmail.test')).emailVerified).toBe(false);
  });

  test('Google has not verified the address: no link', async () => {
    const id = await passwordAccount('claimed@corp.test', true);
    const { location } = await google({ email: 'claimed@corp.test', verified: false }, '/signin');
    expect(location.searchParams.get('error')).toBe('account_not_linked');
    expect(await providersOf(id)).toEqual(['credential']);
  });
});

// Access controls on a share link: a password, view only (no downloads) and a
// list of the people it opens for. The public routes call assertLinkAccess on
// every read, so a gate holds for the listing, previews and downloads alike.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { ShareLinkRow } from '../db/schema';
import { sendInBackground, emailEnabled } from '../email/client';
import { renderLinkShared } from '../email/templates/link-shared';
import { env } from '../env';
import { ApiError } from '../lib/http';
import { checkRateLimit, clientIp, refundRateLimitKey } from '../middleware/rate-limit';
import type { SessionUser } from '../types';
import { driveRole } from './members';

/** An unlock lasts this long; after that the visitor types the password again. */
export const UNLOCK_TTL_SECONDS = 12 * 60 * 60;
const COOKIE = 'vx_link';

export function hashLinkPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: 'argon2id' });
}

/** The cookie only travels with this link's public routes (`/s/…`, or `/u/…` for an upload link). */
const cookiePath = (link: Pick<ShareLinkRow, 'token' | 'kind'>) => `/api/public/${link.kind === 'upload' ? 'u' : 's'}/${link.token}`;

/**
 * MAC over the link, the expiry and the stored hash. The hash carries its own
 * random salt, so setting a password (even the same one again) or removing it
 * changes the input and every earlier unlock stops verifying.
 */
function unlockMac(link: Pick<ShareLinkRow, 'id' | 'passwordHash'>, exp: number): Buffer {
  return createHmac('sha256', env.BETTER_AUTH_SECRET).update(`link-unlock\n${link.id}\n${exp}\n${link.passwordHash ?? ''}`).digest();
}

function isUnlocked(c: Context, link: ShareLinkRow): boolean {
  const raw = getCookie(c, COOKIE);
  const m = raw ? /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(raw) : null;
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp * 1000 <= Date.now()) return false;
  const given = Buffer.from(m[2], 'base64url');
  const want = unlockMac(link, exp);
  return given.length === want.length && timingSafeEqual(given, want);
}

function setUnlocked(c: Context, link: ShareLinkRow): void {
  const exp = Math.floor(Date.now() / 1000) + UNLOCK_TTL_SECONDS;
  setCookie(c, COOKIE, `${exp}.${unlockMac(link, exp).toString('base64url')}`, {
    path: cookiePath(link),
    httpOnly: true,
    secure: env.secureCookies,
    sameSite: 'Lax',
    maxAge: UNLOCK_TTL_SECONDS,
  });
}

/** The link's creator and the people of its drive always pass the email gate (they can see the files anyway). */
async function isInsider(user: SessionUser, link: ShareLinkRow): Promise<boolean> {
  return user.id === link.userId || (await driveRole(user.id, link.workspaceId)) !== null;
}

/**
 * The people gate: with an email list, the visitor must be signed in with a
 * verified address on it. 401 link_sign_in_required / 403 link_wrong_account.
 */
async function assertPerson(c: Context, link: ShareLinkRow): Promise<void> {
  if (link.allowedEmails.length === 0) return;
  const user = c.get('user') as SessionUser | undefined;
  if (!user) throw new ApiError(401, 'link_sign_in_required', 'Sign in to open this link.');
  if (await isInsider(user, link)) return;
  const email = user.email.toLowerCase();
  if (user.emailVerified && link.allowedEmails.includes(email)) return;
  const message = user.emailVerified
    ? 'This link is for specific people.'
    : 'This link is for specific people. Verify your email address to open it.';
  throw new ApiError(403, 'link_wrong_account', message, { email: user.email, verified: !!user.emailVerified });
}

/** Every public read: the people gate first (a stranger never even learns there is a password), then the password. */
export async function assertLinkAccess(c: Context, link: ShareLinkRow): Promise<void> {
  await assertPerson(c, link);
  if (link.passwordHash && !isUnlocked(c, link)) {
    throw new ApiError(401, 'link_password_required', 'This link needs a password.');
  }
}

/** Wrong passwords: 8 per link and address per 15 minutes, and 100 an hour per link from everywhere. */
const UNLOCK_IP = { name: 'link-unlock-ip', capacity: 8, refillPerSec: 8 / 900 } as const;
const UNLOCK_LINK = { name: 'link-unlock-link', capacity: 100, refillPerSec: 100 / 3600 } as const;

/** Checks a password and, when right, sets the unlock cookie. A right password gives its attempt back. */
export async function unlockLink(c: Context, link: ShareLinkRow, password: string): Promise<void> {
  await assertPerson(c, link);
  if (!link.passwordHash) return;
  const ipKey = `${clientIp(c)}|${link.id}`;
  checkRateLimit({ ...UNLOCK_IP, key: () => ipKey }, c);
  checkRateLimit({ ...UNLOCK_LINK, key: () => link.id }, c);
  // Bun.password.verify compares in constant time.
  const ok = await Bun.password.verify(password, link.passwordHash).catch(() => false);
  if (!ok) throw new ApiError(401, 'link_password_incorrect', 'That password is not right.');
  refundRateLimitKey(UNLOCK_IP, ipKey);
  refundRateLimitKey(UNLOCK_LINK, link.id);
  setUnlocked(c, link);
}

/** View-only links: 403 download_disabled for downloads and zips. */
export function assertDownloadAllowed(link: ShareLinkRow): void {
  if (!link.allowDownload) {
    throw new ApiError(403, 'download_disabled', 'Downloads are off for this link. You can still view it here.');
  }
}

/**
 * Mails the link to newly listed people. Skipped when no mail provider is
 * configured (a local run still logs it, like every other mail).
 */
export function mailLinkToPeople(
  link: ShareLinkRow,
  url: string,
  itemName: string,
  sender: { name: string | null; email: string },
  emails: string[],
): void {
  if (!emails.length || (!emailEnabled() && !env.isLocalMode)) return;
  for (const email of emails) {
    const mail = renderLinkShared({
      email,
      senderName: sender.name,
      senderEmail: sender.email,
      itemName,
      isDir: link.targetType === 'dir',
      hasPassword: !!link.passwordHash,
      url,
      upload: link.kind === 'upload',
    });
    sendInBackground({ to: email, ...mail, category: 'link-shared', links: [url] });
  }
}

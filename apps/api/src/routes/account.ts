import type { Context } from 'hono';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { getCookies } from 'better-auth/cookies';
import { AuditListQuery, AuditListResponse, DeleteAccountRequest } from '@volumes/shared';
import { auth } from '../auth';
import { ApiError, noContent, ok, parseJson, parseQuery } from '../lib/http';
import { clientIp } from '../middleware/rate-limit';
import { deleteAccount, listAuditEvents } from '../services/account';
import type { AppEnv } from '../types';

/** DELETE /api/me (typed confirmation) and GET /api/me/audit. */
export const accountRoutes = new Hono<AppEnv>();

/** Expires every better-auth session cookie (token, cached session data incl. chunks, dont-remember). */
function expireSessionCookies(c: Context): void {
  const cookies = getCookies(auth.options);
  const present = Object.keys(getCookie(c));
  const names = new Set<string>([cookies.sessionToken.name, cookies.sessionData.name, cookies.dontRememberToken.name]);
  for (const n of present) if (n.startsWith(`${cookies.sessionData.name}.`)) names.add(n);
  const a = cookies.sessionToken.attributes;
  for (const name of names) {
    setCookie(c, name, '', {
      path: a.path ?? '/',
      httpOnly: true,
      secure: !!a.secure,
      sameSite: 'Lax',
      maxAge: 0,
      expires: new Date(0),
      ...(name.startsWith('__Secure-') ? { secure: true } : {}),
    });
  }
}

accountRoutes.delete('/me', async (c) => {
  const user = c.get('user');
  const req = await parseJson(c, DeleteAccountRequest);
  if (req.confirm.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
    throw new ApiError(400, 'bad_request', 'Type your account email exactly to confirm.');
  }
  await deleteAccount(user.id, { ip: clientIp(c) });
  expireSessionCookies(c);
  return noContent(c);
});

accountRoutes.get('/me/audit', async (c) => {
  const q = parseQuery(c, AuditListQuery);
  return ok(c, AuditListResponse, await listAuditEvents({ userId: c.get('user').id, before: q.before, limit: q.limit }));
});

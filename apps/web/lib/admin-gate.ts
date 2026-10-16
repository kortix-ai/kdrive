// The admin console's server-side gate. Every /admin page asks the API who is signed in before
// anything renders: anyone who is not an admin (signed out included) gets the app's normal 404,
// so the console's existence never shows. React's cache() makes the layout and the page share
// one API call per request. Server only (next/headers).
import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { AdminSessionResponse } from '@volumes/shared';

const API = process.env.VOLUMES_API_ORIGIN ?? 'http://127.0.0.1:4101';

/** The signed-in admin, or null for anyone else (and when the API cannot be reached). */
export const adminSession = cache(async (): Promise<AdminSessionResponse | null> => {
  const h = await headers();
  const cookie = h.get('cookie');
  if (!cookie) return null;
  const forward: Record<string, string> = { cookie, accept: 'application/json' };
  const xff = h.get('x-forwarded-for');
  if (xff) forward['x-forwarded-for'] = xff;
  try {
    const r = await fetch(`${API}/api/admin/session`, { headers: forward, cache: 'no-store' });
    if (!r.ok) return null;
    const parsed = AdminSessionResponse.safeParse(await r.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
});

/** The signed-in admin; renders the 404 page for everyone else. */
export async function requireAdminPage(): Promise<AdminSessionResponse> {
  const s = await adminSession();
  if (!s) notFound();
  return s;
}

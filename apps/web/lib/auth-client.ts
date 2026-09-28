'use client';

import { createAuthClient } from 'better-auth/react';

let client: ReturnType<typeof createAuthClient> | null = null;

/** better-auth browser client (same origin; /api/auth is rewritten to the API). */
export function authClient() {
  if (!client) {
    const origin = typeof window === 'undefined' ? 'http://localhost:4100' : window.location.origin;
    client = createAuthClient({ baseURL: `${origin}/api/auth` });
  }
  return client;
}

export async function signInSocial(provider: 'google' | 'github', callbackURL = '/drive'): Promise<void> {
  await authClient().signIn.social({ provider, callbackURL });
}

export async function signOut(): Promise<void> {
  await authClient().signOut();
}

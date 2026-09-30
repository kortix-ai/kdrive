'use client';

// The auth client used ONLY on /oauth/sign-in: its plugin appends the OAuth
// provider's signed query to every sign-in request, so the authorization
// continues once the session exists. Never use it on /signin.
import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { createAuthClient } from 'better-auth/react';

function make(origin: string) {
  return createAuthClient({ baseURL: `${origin}/api/auth`, plugins: [oauthProviderClient()] });
}

let client: ReturnType<typeof make> | null = null;

export function oauthAuthClient() {
  if (!client) client = make(typeof window === 'undefined' ? 'http://localhost:4100' : window.location.origin);
  return client;
}

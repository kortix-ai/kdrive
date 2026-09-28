import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';

/**
 * Dev-only email sign-in (no password): POST /api/auth/dev/sign-in {email, name?}.
 * Registered only when VOLUMES_DEV_LOGIN=1 and NODE_ENV !== 'production'
 * (see auth/index.ts). Finds or creates the user, then issues a normal
 * better-auth session cookie.
 */
export function devLogin(): BetterAuthPlugin {
  return {
    id: 'volumes-dev-login',
    endpoints: {
      devSignIn: createAuthEndpoint(
        '/dev/sign-in',
        {
          method: 'POST',
          body: z.object({ email: z.string().email().max(320), name: z.string().max(120).optional() }),
        },
        async (ctx) => {
          if (process.env.NODE_ENV === 'production') throw new APIError('NOT_FOUND');
          const email = ctx.body.email.trim().toLowerCase();
          const found = await ctx.context.internalAdapter.findUserByEmail(email);
          let user = found?.user;
          if (!user) {
            const fallbackName = email.split('@')[0] ?? 'Dev user';
            user = await ctx.context.internalAdapter.createUser({
              email,
              name: ctx.body.name?.trim() || fallbackName,
              emailVerified: true,
            });
          }
          if (!user) throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Could not create the dev user.' });
          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (!session) throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Could not create a session.' });
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ user: { id: user.id, email: user.email, name: user.name ?? null, image: user.image ?? null } });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}

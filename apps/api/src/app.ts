import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { auth } from './auth';
import { ApiError } from './lib/http';
import { audit } from './lib/audit';
import { csrfGuard } from './middleware/csrf';
import { errorResponse, onError } from './middleware/errors';
import { checkRateLimit, clientIp, limits } from './middleware/rate-limit';
import { requireAdmin, requireUser, sessionMiddleware } from './middleware/session';
import { requireWorkspace } from './middleware/workspace';
import { accountRoutes } from './routes/account';
import { adminRoutes } from './routes/admin';
import { checkpointsRoutes } from './routes/checkpoints';
import { deletedRoutes } from './routes/deleted';
import { filesRoutes } from './routes/files';
import { healthRoutes } from './routes/health';
import { linksRoutes } from './routes/links';
import { meRoutes } from './routes/me';
import { publicRoutes } from './routes/public';
import { restoreRoutes } from './routes/restore';
import { timelineRoutes } from './routes/timeline';
import { uploadsRoutes } from './routes/uploads';
import { versionsRoutes } from './routes/versions';
import { workspacesRoutes } from './routes/workspaces';
import type { AppEnv } from './types';

const PUBLIC_PATHS = new Set(['/api/health', '/api/config']);

/**
 * Builds the Hono app. Mounts middleware and EVERY route module, so builders
 * only ever edit their own route files. Order: reqId → headers → CSRF →
 * better-auth → session → auth gates → routes.
 */
export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.onError(onError);
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'No such route.' } }, 404));

  // request id + baseline headers
  app.use('*', async (c, next) => {
    const reqId = c.req.header('x-request-id')?.slice(0, 64) || randomBytes(6).toString('hex');
    c.set('reqId', reqId);
    await next();
    c.header('X-Request-Id', reqId);
    if (!c.res.headers.has('X-Content-Type-Options')) c.header('X-Content-Type-Options', 'nosniff');
    if (!c.res.headers.has('Referrer-Policy')) c.header('Referrer-Policy', 'same-origin');
    if (!c.res.headers.has('Cache-Control') && c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store');
  });

  app.use('/api/*', csrfGuard);

  // better-auth owns /api/auth/* (its own CSRF / origin checks).
  app.use('/api/auth/dev/sign-in', async (c, next) => {
    checkRateLimit({ ...limits.devSignIn, key: (cc) => clientIp(cc) }, c);
    await next();
  });
  app.use('/api/auth/sign-out', async (c, next) => {
    try {
      const s = await auth.api.getSession({ headers: c.req.raw.headers });
      if (s?.user) await audit(c, { kind: 'auth.sign_out', userId: s.user.id, actorEmail: s.user.email });
    } catch {
      /* never block sign-out */
    }
    await next();
  });
  app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
    try {
      return await auth.handler(c.req.raw);
    } catch (e) {
      return errorResponse(c, e);
    }
  });

  app.use('/api/*', sessionMiddleware);

  // Everything except health, config and public share routes needs a user.
  app.use('/api/*', async (c, next) => {
    const p = c.req.path;
    if (PUBLIC_PATHS.has(p) || p.startsWith('/api/public/') || p === '/api/public') return next();
    return requireUser(c, async () => {
      const u = c.get('user');
      checkRateLimit({ ...limits.user, key: () => u.id }, c);
      await next();
    });
  });
  app.use('/api/w/:ws/*', requireWorkspace);
  app.use('/api/admin/*', requireAdmin);

  app.route('/api', healthRoutes);
  app.route('/api', meRoutes);
  app.route('/api', accountRoutes);
  app.route('/api/w/:ws', filesRoutes);
  app.route('/api/w/:ws', uploadsRoutes);
  app.route('/api/w/:ws', timelineRoutes);
  app.route('/api/w/:ws', versionsRoutes);
  app.route('/api/w/:ws', restoreRoutes);
  app.route('/api/w/:ws', checkpointsRoutes);
  app.route('/api/w/:ws', deletedRoutes);
  app.route('/api/w/:ws', linksRoutes);
  app.route('/api/public', publicRoutes);
  app.route('/api/workspaces', workspacesRoutes);
  app.route('/api/admin', adminRoutes);

  return app;
}

export { ApiError };

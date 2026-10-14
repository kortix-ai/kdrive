import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { auth, CLIENT_IP_HEADER } from './auth';
import { ApiError } from './lib/http';
import { audit } from './lib/audit';
import { csrfGuard } from './middleware/csrf';
import { errorResponse, onError } from './middleware/errors';
import { env } from './env';
import { handleMcp } from './mcp/http';
import { checkRateLimit, clientIp, isLoopback, limits, socketIp } from './middleware/rate-limit';
import { checkAuthLimits } from './middleware/auth-limits';
import { assertEmailVerified, requireAdmin, requireUser, sessionMiddleware } from './middleware/session';
import { requireWorkspace } from './middleware/workspace';
import { accountRoutes } from './routes/account';
import { adminRoutes } from './routes/admin';
import { agentTokensRoutes } from './routes/agent-tokens';
import { agentsOauthRoutes } from './routes/agents-oauth';
import { checkpointsRoutes } from './routes/checkpoints';
import { deletedRoutes } from './routes/deleted';
import { filesRoutes } from './routes/files';
import { healthRoutes } from './routes/health';
import { linksRoutes } from './routes/links';
import { meRoutes } from './routes/me';
import { oauthMetaRoutes } from './routes/oauth-meta';
import { proposalsRoutes } from './routes/proposals';
import { publicRoutes } from './routes/public';
import { restoreRoutes } from './routes/restore';
import { timelineRoutes } from './routes/timeline';
import { uploadsRoutes } from './routes/uploads';
import { versionsRoutes } from './routes/versions';
import { invitationsRoutes } from './routes/invitations';
import { workspacesRoutes } from './routes/workspaces';
import type { AppEnv } from './types';

const PUBLIC_PATHS = new Set(['/api/health', '/api/config']);
/** Block PUTs are bounded by their plan (a hash in `missing`, at most 1 MiB), so they get their own budget. */
const BLOCK_PUT = /^\/api\/w\/[^/]+\/uploads\/([^/]+)\/blocks\/[^/]+$/;

/** Dev sign-in answers only this machine: a loopback socket, a loopback client and (when sent) a trusted Origin. */
function devSignInAllowed(c: Parameters<typeof clientIp>[0]): boolean {
  const peer = socketIp(c);
  if (peer !== null && !isLoopback(peer)) return false;
  const ip = clientIp(c);
  if (ip !== 'local' && !isLoopback(ip)) return false;
  const origin = c.req.header('origin');
  return !origin || env.trustedOrigins.includes(origin.replace(/\/$/, ''));
}

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

  // AI agents: /mcp and the OAuth discovery documents live outside /api, so no
  // cookie session, CSRF guard or requireUser applies (bearer credentials only).
  app.all('/mcp', (c) => handleMcp(c.req.raw, c));
  app.route('/', oauthMetaRoutes);

  app.use('/api/*', csrfGuard);

  // better-auth owns /api/auth/* (its own CSRF / origin checks).
  app.use('/api/auth/dev/sign-in', async (c, next) => {
    if (!devSignInAllowed(c)) throw new ApiError(404, 'not_found', 'No such route.');
    checkRateLimit({ ...limits.devSignIn, key: (cc) => clientIp(cc) }, c);
    checkRateLimit({ ...limits.devSignInAll, key: () => 'all' }, c);
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
      // better-auth reads the client address from one header we always set
      // ourselves (a client-sent value is overwritten), using the same rule as
      // our own limiters.
      const raw = c.req.raw;
      const headers = new Headers(raw.headers);
      headers.set(CLIENT_IP_HEADER, clientIp(c));
      // Auth bodies are small JSON: buffer them (re-wrapping a streamed body can stall).
      const body = raw.method === 'GET' || raw.method === 'HEAD' ? undefined : await raw.arrayBuffer();
      checkAuthLimits(c, body);
      return await auth.handler(new Request(raw.url, { method: raw.method, headers, body, signal: raw.signal }));
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
      assertEmailVerified(c.req.method, p, u);
      const block = c.req.method === 'PUT' ? BLOCK_PUT.exec(p) : null;
      if (block) checkRateLimit({ ...limits.blockPut, key: () => `${u.id}|${block[1]}` }, c);
      else checkRateLimit({ ...limits.user, key: () => u.id }, c);
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
  app.route('/api/w/:ws', proposalsRoutes);
  app.route('/api/agents', agentTokensRoutes);
  app.route('/api/agents', agentsOauthRoutes);
  app.route('/api/public', publicRoutes);
  app.route('/api/workspaces', workspacesRoutes);
  app.route('/api/invitations', invitationsRoutes);
  app.route('/api/admin', adminRoutes);

  return app;
}

export { ApiError };

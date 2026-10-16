import type { MiddlewareHandler } from 'hono';
import { ApiError } from '../lib/http';
import { getWorkspaceAccess } from '../services/members';
import { ensureUserBootstrap, getWorkspaceForUser, toCtx } from '../services/workspaces';
import type { AppEnv, WorkspaceCtx } from '../types';

const WS_ID = /^[0-9a-z]{26}$/;

const READS = new Set(['GET', 'HEAD']);

/** Comments are the one thing a viewer writes (routes/comments.ts checks who may change what). */
const COMMENT_ROUTES = /^\/api\/w\/[^/]+\/comments(\/[^/]+)?$/;

/**
 * Resolves `:ws` to a workspace the session user owns or is a member of (404
 * otherwise, so other users' ids and raw `vol_…` ids are indistinguishable from
 * missing). A viewer may only read: every route that changes anything uses a
 * method other than GET/HEAD, so those answer 403 here, before any route runs
 * (comments excepted: viewers comment too).
 * Sets c.var.ws; opens the volume when it has none yet.
 */
export const requireWorkspace: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  if (!user) throw new ApiError(401, 'unauthorized', 'Sign in to continue.');
  const wsId = c.req.param('ws') ?? '';
  const ws = WS_ID.test(wsId) ? await getWorkspaceAccess(user.id, wsId) : null;
  if (!ws) throw new ApiError(404, 'not_found', 'Workspace not found.');
  if (ws.role === 'viewer' && !READS.has(c.req.method) && !COMMENT_ROUTES.test(c.req.path)) {
    throw new ApiError(403, 'read_only', 'You can view this drive but not change it. Ask its owner for edit access.');
  }
  c.set('ws', ws);
  await next();
};

/**
 * Resolves the workspace for routes that take an optional workspace id
 * (query `ws` or header `x-vx-workspace`): the given one if owned, else the default.
 */
export async function resolveWorkspace(userId: string, wsId?: string | null): Promise<WorkspaceCtx> {
  if (wsId) {
    const ws = WS_ID.test(wsId) ? await getWorkspaceForUser(userId, wsId) : null;
    if (!ws) throw new ApiError(404, 'not_found', 'Workspace not found.');
    return ws;
  }
  return toCtx(await ensureUserBootstrap({ id: userId }));
}

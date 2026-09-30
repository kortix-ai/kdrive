// A restore request (file / folder / drive) as one service call, shared by the
// web route and the agent tools: the same checks, ledger action, links and
// audit events whoever asks.
import type { z } from 'zod';
import type { RestoreRequest, RestoreResponse } from '@volumes/shared';
import { audit, type AuditInput } from '../lib/audit';
import { ApiError } from '../lib/http';
import { getStore } from '../storage';
import type { ActionCtx } from './ledger';
import { restoreDrive, restoreFileFrom, restorePaths, restoreSummary } from './restore';
import { statOrNull } from './tree';
import { pathAtCommit } from './versions';

/** An action context plus who to write in the audit log. */
export interface AuditedCtx extends ActionCtx {
  email: string;
  ip: string | null;
}

/** Writes an audit event for `ctx` (its user, email, ip and, for agents, the agent's name). */
export async function auditAs(ctx: AuditedCtx, e: Omit<AuditInput, 'userId' | 'actorEmail' | 'ip' | 'workspaceId'>): Promise<void> {
  await audit(null, {
    ...e,
    userId: ctx.userId,
    actorEmail: ctx.email,
    ip: ctx.ip,
    workspaceId: ctx.ws.id,
    meta: { ...(e.meta ?? {}), agent: ctx.actor?.kind === 'agent' ? ctx.actor.name : undefined },
  });
}

/** POST /restore's body: the restore is a new, undoable version. */
export async function runRestore(ctx: AuditedCtx, req: z.output<typeof RestoreRequest>): Promise<RestoreResponse> {
  const { ws } = ctx;
  if (req.scope === 'drive') {
    const r = await restoreDrive(ctx, req.at);
    await auditAs(ctx, {
      kind: 'restore.drive',
      target: '/',
      meta: { at: req.at, actionId: r.action.id, checkpointId: r.checkpoint?.id ?? null, checkpointSkipped: !!r.checkpointSkipped },
    });
    if (r.checkpoint) {
      await auditAs(ctx, { kind: 'checkpoint.create', target: r.checkpoint.id, meta: { name: r.checkpoint.name, auto: true } });
    }
    return r;
  }

  const commit = await getStore().getCommit(ws.volumeId, req.at);
  if (req.paths?.length && !(req.paths.length === 1 && !req.path)) {
    // Several items to one version: ONE action, one timeline entry, one undo.
    const paths = [...new Set([...(req.path ? [req.path] : []), ...req.paths])];
    const action = await restorePaths(ctx, {
      paths,
      at: commit.id,
      kind: req.scope === 'file' ? 'restore.file' : 'restore.folder',
      summary: `Restored ${paths.length.toLocaleString('en-US')} items to an earlier version`,
    });
    await auditAs(ctx, {
      kind: 'restore.folder',
      target: paths[0],
      meta: { at: commit.id, actionId: action.id, scope: req.scope, paths: paths.slice(0, 50), count: paths.length },
    });
    return { action };
  }
  const path = req.path ?? req.paths![0];
  const then = await statOrNull(ws, path, commit.id);
  if (!then) {
    // A file renamed since: restore the version it had under its earlier name.
    const earlier = req.scope === 'file' ? await pathAtCommit(ws, path, commit.id) : null;
    const old = earlier && earlier !== path ? await statOrNull(ws, earlier, commit.id) : null;
    if (!old || old.type === 'dir') throw new ApiError(404, 'path_not_found', 'That item does not exist at this version.', { path });
    const action = await restoreFileFrom(ctx, { from: earlier!, to: path, at: commit.id, summary: restoreSummary(path, 'file') });
    await auditAs(ctx, { kind: 'restore.file', target: path, meta: { at: commit.id, actionId: action.id, scope: req.scope, from: earlier } });
    return { action };
  }
  const type = then.type === 'dir' ? 'dir' : 'file';
  const kind = type === 'dir' ? 'restore.folder' : 'restore.file';
  const action = await restorePaths(ctx, { paths: [path], at: commit.id, kind, summary: restoreSummary(path, type) });
  await auditAs(ctx, { kind, target: path, meta: { at: commit.id, actionId: action.id, scope: req.scope } });
  return { action };
}

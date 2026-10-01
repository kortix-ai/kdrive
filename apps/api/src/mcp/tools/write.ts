// Tool 9: write_changes — one ordered batch; lands directly or becomes a proposal.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { basename, MCP_WRITE_BATCH_MAX, MCP_WRITE_FILE_MAX } from '@volumes/shared';
import type { z } from 'zod';
import { principalWorkspace, type AgentPrincipal } from '../../agents/principal';
import { scopeAllows } from '../../agents/scopes';
import { driveUrl, proposalUrl } from '../../agents/urls';
import { ApiError } from '../../lib/http';
import { agentBatchSummary, applyAgentBatch, type BatchOp, type OpResult } from '../../services/agent-batch';
import { createCheckpoint } from '../../services/checkpoints';
import { getAction } from '../../services/ledger';
import { createProposal } from '../../services/proposals';
import { auditAs } from '../../services/restore-request';
import { checkPath } from '../../services/upload-plan';
import { getStore } from '../../storage';
import type { WorkspaceCtx } from '../../types';
import { writeChangesDescription } from '../descriptions';
import { DIFF_CARD_URI } from '../diff-card';
import { afterCommit, ok, withTool, type Link, type ToolCtx } from '../result';
import { WriteChangesInput, WriteChangesOutput, type ChangeOp } from '../schemas';
import { badRequest, toPath } from './util';

type Args = {
  workspace_id?: string;
  last_seen_commit_id: string;
  message: string;
  changes: ChangeOp[];
  checkpoint: boolean;
  checkpoint_name?: string;
};
type Out = z.infer<z.ZodObject<typeof WriteChangesOutput>>;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** A concrete commit id. Names such as "head" or a checkpoint would move with the drive and turn the guard off. */
export const COMMIT_ID = /^vc_[0-9A-Za-z]{26}$/;

/** last_seen_commit_id must name the exact version the agent read. */
export function checkBase(id: string): string {
  if (!COMMIT_ID.test(id)) {
    throw badRequest('last_seen_commit_id must be the commit id (vc_…) you read: head_commit_id from open_workspace or commit_id from read_files. Names such as "head" are not accepted.', {
      last_seen_commit_id: id.slice(0, 128),
    });
  }
  return id;
}

/** A path argument checked like an upload's (root refused, every segment a valid name); errors carry the op index. */
function argPath(p: string, index: number, what: string): string {
  try {
    return checkPath(toPath(p), what);
  } catch (e) {
    if (e instanceof ApiError) throw new ApiError(e.status, e.code, e.message, { ...(e.details ?? {}), index });
    const message = e instanceof Error ? e.message : 'Invalid path.';
    throw new ApiError(400, 'invalid_path', message, { index, path: p });
  }
}

/** Validates the arguments and decodes them into batch ops (nothing is read or written yet). */
export function decodeChanges(changes: ChangeOp[]): BatchOp[] {
  let total = 0;
  return changes.map((c, index): BatchOp => {
    if (c.op === 'write') {
      const hasText = c.content !== undefined;
      const hasB64 = c.content_base64 !== undefined;
      if (hasText === hasB64) throw badRequest('A write needs exactly one of content or content_base64.', { index });
      let bytes: Uint8Array;
      if (hasB64) {
        const b = c.content_base64!;
        if (b.length % 4 !== 0 || !BASE64.test(b)) throw badRequest('content_base64 is not valid standard base64.', { index });
        if ((b.length / 4) * 3 > MCP_WRITE_FILE_MAX + 2) throw new ApiError(413, 'payload_too_large', 'A file can be at most 10 MiB.', { index, max: MCP_WRITE_FILE_MAX });
        bytes = new Uint8Array(Buffer.from(b, 'base64'));
      } else bytes = new TextEncoder().encode(c.content!);
      if (bytes.length > MCP_WRITE_FILE_MAX) throw new ApiError(413, 'payload_too_large', 'A file can be at most 10 MiB.', { index, max: MCP_WRITE_FILE_MAX });
      total += bytes.length;
      if (total > MCP_WRITE_BATCH_MAX) throw new ApiError(413, 'payload_too_large', 'One call can carry at most 24 MiB.', { index, max: MCP_WRITE_BATCH_MAX });
      return { op: 'write', path: argPath(c.path, index, 'file'), bytes };
    }
    if (c.op === 'mkdir') return { op: 'mkdir', path: argPath(c.path, index, 'folder') };
    if (c.op === 'delete') return { op: 'delete', path: argPath(c.path, index, 'item') };
    return { op: c.op, from: argPath(c.from, index, 'source'), to: argPath(c.to, index, 'destination') };
  });
}

const VERB: Record<OpResult['result'] | 'proposed', string> = {
  created: 'Wrote',
  replaced: 'Updated',
  unchanged: 'Unchanged',
  folder: 'Created folder',
  moved: 'Moved',
  copied: 'Copied',
  deleted: 'Deleted',
  proposed: 'Proposed',
};

/** `Wrote /a.md · Updated /b.csv · Moved /c → /d · Deleted /e` (first 4, then `· +N more`). */
export function writeSummary(results: Pick<OpResult, 'result' | 'path' | 'fromPath'>[], checkpoint: string | null): string {
  const parts = results.slice(0, 4).map((r) => (r.fromPath ? `${VERB[r.result]} ${r.fromPath} → ${r.path}` : `${VERB[r.result]} ${r.path}`));
  if (results.length > 4) parts.push(`+${results.length - 4} more`);
  let s = parts.join(' · ');
  if (checkpoint) s += ` · checkpoint ${JSON.stringify(checkpoint)}`;
  return s;
}

async function direct(p: AgentPrincipal, ws: WorkspaceCtx, args: Args, ops: BatchOp[], ctx: ToolCtx): Promise<{ data: Out; links: Link[] }> {
  const actx = { ws, userId: p.user.id, actor: { kind: 'agent' as const, name: p.name, credential: p.credential }, email: p.user.email, ip: ctx.ip };
  const { action, results } = await applyAgentBatch(actx, {
    ops,
    baseCommitId: args.last_seen_commit_id,
    kind: 'agent.batch',
    summary: agentBatchSummary(ops, args.message),
    meta: { message: args.message, ops: ops.length },
  });
  // The batch has landed: nothing below may turn this into a "not committed" result.
  const row = await afterCommit('reading the action', () => getAction(ws.id, action.id), null);
  const head =
    action.headCommitId ?? (await afterCommit('reading the head', async () => (await getStore().getVolume(ws.volumeId)).headCommitId, null));
  await auditAs(actx, { kind: 'agent.write', target: action.id, meta: { actionId: action.id, ops: ops.length, credential: p.credential } });
  let checkpoint: Out['checkpoint'] = null;
  let checkpointError: string | null = null;
  if (args.checkpoint && args.checkpoint_name) {
    try {
      const cp = await createCheckpoint(actx, { name: args.checkpoint_name, note: args.message, ...(head ? { at: head } : {}) });
      checkpoint = { id: cp.id, name: cp.name, commit_id: cp.commitId };
      await auditAs(actx, { kind: 'agent.checkpoint', target: cp.id, meta: { name: cp.name, commitId: cp.commitId, credential: p.credential } });
    } catch (e) {
      checkpointError = e instanceof ApiError ? e.message : 'The checkpoint could not be saved.';
      if (!(e instanceof ApiError)) console.warn('[mcp] checkpoint after write_changes failed', e instanceof Error ? e.message : e);
    }
  }
  const changes = results.map((r) => ({
    index: r.index,
    op: r.op,
    path: r.path,
    from_path: r.fromPath,
    result: r.result,
    size: r.size,
    url: r.result === 'deleted' ? null : driveUrl(ws.id, r.path, r.entryType),
  }));
  let summary = writeSummary(results, checkpoint?.name ?? null);
  if (checkpointError) summary += ` · checkpoint not saved: ${checkpointError}`;
  const data: Out = {
    outcome: action.status === 'committed' ? 'committed' : 'unchanged',
    workspace_id: ws.id,
    message: args.message,
    base_commit_id: args.last_seen_commit_id,
    head_commit_id: head,
    commit_ids: row?.commitIds ?? [],
    action_id: action.status === 'committed' ? action.id : null,
    proposal_id: null,
    proposal_url: null,
    expires_at: null,
    changes,
    checkpoint,
    ...(checkpointError ? { checkpoint_error: checkpointError } : {}),
    summary,
  };
  const links = changes.filter((c) => c.url).map((c) => ({ uri: c.url!, name: basename(c.path) || c.path, title: c.path }));
  return { data, links };
}

async function propose(p: AgentPrincipal, ws: WorkspaceCtx, args: Args, ops: BatchOp[], ctx: ToolCtx): Promise<{ data: Out; links: Link[] }> {
  const row = await createProposal({ ws, userId: p.user.id, email: p.user.email, ip: ctx.ip }, p, {
    ops,
    baseCommitId: args.last_seen_commit_id,
    message: args.message,
    checkpointName: args.checkpoint ? (args.checkpoint_name ?? null) : null,
  });
  const url = proposalUrl(ws.id, row.id);
  // Nothing exists in the drive until the user accepts: each change links to
  // its row on the review page, never to a drive path that is not there yet.
  const changes = ops.map((o, index) => ({
    index,
    op: o.op,
    path: o.op === 'move' || o.op === 'copy' ? o.to : o.path,
    from_path: o.op === 'move' || o.op === 'copy' ? o.from : null,
    result: 'proposed' as const,
    size: o.op === 'write' ? o.bytes.length : null,
    url: proposalUrl(ws.id, row.id, index),
  }));
  const n = ops.length;
  const summary = `Proposed ${n.toLocaleString('en-US')} ${n === 1 ? 'change' : 'changes'} for review · waiting for the user`;
  const data: Out = {
    outcome: 'proposed',
    workspace_id: ws.id,
    message: args.message,
    base_commit_id: args.last_seen_commit_id,
    head_commit_id: null,
    commit_ids: [],
    action_id: null,
    proposal_id: row.id,
    proposal_url: url,
    expires_at: row.expiresAt.toISOString(),
    changes,
    checkpoint: null,
    summary,
  };
  const links: Link[] = [{ uri: url, name: 'Proposal', title: 'Review the proposal in Volumes' }];
  return { data, links };
}

export function registerWriteTool(server: McpServer, p: AgentPrincipal, ctx: ToolCtx): void {
  const isDirect = p.mode === 'direct' && scopeAllows(p.scope, 'drive:write');
  server.registerTool(
    'write_changes',
    {
      title: 'Write changes',
      description: writeChangesDescription(isDirect ? 'direct' : 'review'),
      inputSchema: WriteChangesInput,
      outputSchema: WriteChangesOutput,
      annotations: { readOnlyHint: false, destructiveHint: isDirect, idempotentHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: DIFF_CARD_URI } },
    },
    withTool(
      'write_changes',
      p,
      async (args: Args) => {
        if (args.checkpoint && !args.checkpoint_name) throw badRequest('checkpoint_name is required when checkpoint is true.');
        checkBase(args.last_seen_commit_id);
        const ops = decodeChanges(args.changes);
        const ws = await principalWorkspace(p, args.workspace_id);
        // Review mode can never reach the batch engine: it only stages a proposal.
        const r = isDirect ? await direct(p, ws, args, ops, ctx) : await propose(p, ws, args, ops, ctx);
        return ok({ summary: r.data.summary, links: r.links, data: r.data });
      },
      ctx,
    ),
  );
}

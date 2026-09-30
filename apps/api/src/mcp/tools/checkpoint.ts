// Tool 11: create_checkpoint — a named version kept until the user removes it.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { principalWorkspace, type AgentPrincipal } from '../../agents/principal';
import { PUBLIC_ORIGIN } from '../../agents/urls';
import { createCheckpoint } from '../../services/checkpoints';
import { auditAs } from '../../services/restore-request';
import { tagBudget } from '../../services/tags';
import { CREATE_CHECKPOINT_DESCRIPTION } from '../descriptions';
import { ok, withTool, type ToolCtx } from '../result';
import { CreateCheckpointInput, CreateCheckpointOutput } from '../schemas';

type Args = { workspace_id?: string; name: string; note: string; at?: string };

export function checkpointsUrl(wsId: string): string {
  return `${PUBLIC_ORIGIN}/checkpoints?${new URLSearchParams({ ws: wsId }).toString()}`;
}

export function registerCheckpointTool(server: McpServer, p: AgentPrincipal, ctx: ToolCtx): void {
  server.registerTool(
    'create_checkpoint',
    {
      title: 'Create checkpoint',
      description: CREATE_CHECKPOINT_DESCRIPTION,
      inputSchema: CreateCheckpointInput,
      outputSchema: CreateCheckpointOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withTool(
      'create_checkpoint',
      p,
      async (args: Args) => {
        const ws = await principalWorkspace(p, args.workspace_id);
        const actx = { ws, userId: p.user.id, actor: { kind: 'agent' as const, name: p.name, credential: p.credential }, email: p.user.email, ip: ctx.ip };
        const cp = await createCheckpoint(actx, { name: args.name, note: args.note, at: args.at });
        await auditAs(actx, { kind: 'agent.checkpoint', target: cp.id, meta: { name: cp.name, commitId: cp.commitId, credential: p.credential } });
        const b = await tagBudget(ws);
        const url = checkpointsUrl(ws.id);
        const data = {
          checkpoint: { id: cp.id, name: cp.name, note: cp.note, commit_id: cp.commitId, created_at: cp.createdAt },
          budget: { used: b.used, max: b.max },
          url,
        };
        return ok({
          summary: `Checkpoint ${JSON.stringify(cp.name)} at ${cp.commitId}`,
          links: [{ uri: url, name: 'Checkpoints', title: 'Checkpoints in Volumes' }],
          data,
        });
      },
      ctx,
    ),
  );
}

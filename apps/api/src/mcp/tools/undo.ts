// Tool 13: undo — puts back what one change touched, as a new version.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { principalWorkspace, type AgentPrincipal } from '../../agents/principal';
import { driveUrl } from '../../agents/urls';
import { ApiError } from '../../lib/http';
import { lastAgentAction } from '../../services/ledger';
import { auditAs } from '../../services/restore-request';
import { undoAction } from '../../services/undo';
import { UNDO_DESCRIPTION } from '../descriptions';
import { afterCommit, ok, withTool, type ToolCtx } from '../result';
import { headCommit } from './util';
import { UndoInput, UndoOutput } from '../schemas';

type Args = { workspace_id?: string; action_id?: string };

export function registerUndoTool(server: McpServer, p: AgentPrincipal, ctx: ToolCtx): void {
  server.registerTool(
    'undo',
    {
      title: 'Undo',
      description: UNDO_DESCRIPTION,
      inputSchema: UndoInput,
      outputSchema: UndoOutput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    withTool(
      'undo',
      p,
      async (args: Args) => {
        const ws = await principalWorkspace(p, args.workspace_id);
        const actx = { ws, userId: p.user.id, actor: { kind: 'agent' as const, name: p.name, credential: p.credential }, email: p.user.email, ip: ctx.ip };
        let target = args.action_id;
        if (!target) {
          const last = await lastAgentAction(ws.id, p.credential);
          if (!last) throw new ApiError(404, 'not_found', 'This connection has no change to undo.');
          target = last.id;
        }
        const action = await undoAction(actx, target);
        await auditAs(actx, { kind: 'agent.undo', target, meta: { actionId: action.id, undone: target, credential: p.credential } });
        const committed = action.status === 'committed';
        const summary = committed ? action.summary : 'Nothing to put back: the files are already as they were.';
        const data = {
          outcome: committed ? ('committed' as const) : ('unchanged' as const),
          action_id: committed ? action.id : null,
          undone_action_id: target,
          summary,
          head_commit_id: (committed ? action.headCommitId : null) ?? (await afterCommit('reading the head', () => headCommit(ws), null)),
        };
        return ok({
          summary,
          links: [{ uri: driveUrl(ws.id, '/', 'dir'), name: ws.name, title: ws.name }],
          data,
        });
      },
      ctx,
    ),
  );
}

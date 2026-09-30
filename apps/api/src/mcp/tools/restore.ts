// Tool 12: restore — files, folders or the whole drive back to an earlier version.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { basename } from '@volumes/shared';
import { principalWorkspace, type AgentPrincipal } from '../../agents/principal';
import { driveUrl } from '../../agents/urls';
import { auditAs, runRestore } from '../../services/restore-request';
import { RESTORE_DESCRIPTION } from '../descriptions';
import { afterCommit, ok, withTool, type Link, type ToolCtx } from '../result';
import { RestoreInput, RestoreOutput } from '../schemas';
import { commitIdOf, headCommit, safeStat, toPaths } from './util';

type Args = { workspace_id?: string; at: string; paths?: string[] };

export function registerRestoreTool(server: McpServer, p: AgentPrincipal, ctx: ToolCtx): void {
  server.registerTool(
    'restore',
    {
      title: 'Restore',
      description: RESTORE_DESCRIPTION,
      inputSchema: RestoreInput,
      outputSchema: RestoreOutput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    withTool(
      'restore',
      p,
      async (args: Args) => {
        const ws = await principalWorkspace(p, args.workspace_id);
        const actx = { ws, userId: p.user.id, actor: { kind: 'agent' as const, name: p.name, credential: p.credential }, email: p.user.email, ip: ctx.ip };
        const paths = args.paths?.length ? toPaths(args.paths) : [];
        let r;
        if (!paths.length || (paths.length === 1 && paths[0] === '/')) {
          r = await runRestore(actx, { scope: 'drive', at: args.at });
        } else if (paths.length === 1) {
          const at = await commitIdOf(ws, args.at);
          const st = await safeStat(ws, paths[0], at);
          r = await runRestore(actx, { scope: st?.type === 'dir' ? 'folder' : 'file', path: paths[0], at });
        } else {
          r = await runRestore(actx, { scope: 'folder', paths, at: args.at });
        }
        const a = r.action;
        const committed = a.status === 'committed';
        await auditAs(actx, {
          kind: 'agent.restore',
          target: a.id,
          meta: { actionId: a.id, at: args.at, paths: paths.slice(0, 50), count: paths.length, credential: p.credential },
        });
        // The restore has run: nothing below may turn its result into an error.
        const summary = committed ? a.summary : 'Already at that version: nothing was restored.';
        const data = {
          outcome: committed ? ('committed' as const) : ('unchanged' as const),
          action_id: committed ? a.id : null,
          summary,
          head_commit_id: (committed ? a.headCommitId : null) ?? (await afterCommit('reading the head', () => headCommit(ws), null)),
          restored_to: a.restoredTo ?? null,
          checkpoint: r.checkpoint ? { id: r.checkpoint.id, name: r.checkpoint.name } : null,
        };
        const links: Link[] = [];
        if (!paths.length) links.push({ uri: driveUrl(ws.id, '/', 'dir'), name: ws.name, title: ws.name });
        for (const path of paths) {
          const st = await afterCommit('reading a restored path', () => safeStat(ws, path), null);
          if (st) links.push({ uri: driveUrl(ws.id, path, st.type === 'dir' ? 'dir' : 'file'), name: basename(path) || ws.name, title: path });
        }
        return ok({ summary, links, data });
      },
      ctx,
    ),
  );
}

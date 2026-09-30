// Tool 8: get_links — browser URLs for paths, the workspace and a proposal.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { basename } from '@volumes/shared';
import { and, eq } from 'drizzle-orm';
import { principalWorkspace, type AgentPrincipal } from '../../agents/principal';
import { driveUrl, proposalUrl } from '../../agents/urls';
import { db } from '../../db/client';
import { proposals } from '../../db/schema';
import { ApiError } from '../../lib/http';
import { GET_LINKS_DESCRIPTION } from '../descriptions';
import { ok, withTool, type Link, type ToolCtx } from '../result';
import { GetLinksInput, GetLinksOutput } from '../schemas';
import { headCommit, plural, safeStat, toPaths } from './util';

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

type Args = { workspace_id?: string; paths: string[]; proposal_id?: string };

/** A proposal this principal made in this workspace, or 404. */
export async function ownProposal(p: AgentPrincipal, wsId: string, id: string) {
  const [row] = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.workspaceId, wsId), eq(proposals.userId, p.user.id), eq(proposals.agentCredential, p.credential)))
    .limit(1);
  if (!row) throw new ApiError(404, 'not_found', 'No such proposal.');
  return row;
}

export function registerLinksTool(server: McpServer, p: AgentPrincipal, ctx: ToolCtx): void {
  server.registerTool(
    'get_links',
    {
      title: 'Get links',
      description: GET_LINKS_DESCRIPTION,
      inputSchema: GetLinksInput,
      outputSchema: GetLinksOutput,
      annotations: READ_ONLY,
    },
    withTool(
      'get_links',
      p,
      async (args: Args) => {
        const ws = await principalWorkspace(p, args.workspace_id);
        const head = await headCommit(ws);
        const paths = toPaths(args.paths ?? []);
        const links = [];
        for (const path of paths) {
          const st = path === '/' ? ({ type: 'dir' } as const) : await safeStat(ws, path, head);
          const type = st ? (st.type === 'dir' ? ('dir' as const) : ('file' as const)) : null;
          links.push({ path, type, exists: !!st, url: type ? driveUrl(ws.id, path, type) : null });
        }
        const proposal_url = args.proposal_id ? proposalUrl(ws.id, (await ownProposal(p, ws.id, args.proposal_id)).id) : null;
        const workspace_url = driveUrl(ws.id, '/', 'dir');
        const data = { workspace_url, links, proposal_url };
        const out: Link[] = [{ uri: workspace_url, name: ws.name, title: ws.name, description: 'Workspace' }];
        if (proposal_url) out.push({ uri: proposal_url, name: 'Proposal', title: 'Proposal in Volumes' });
        for (const l of links) if (l.url) out.push({ uri: l.url, name: basename(l.path) || ws.name, title: l.path });
        const count = links.filter((l) => l.url).length + 1 + (proposal_url ? 1 : 0);
        return ok({ summary: plural(count, 'link'), links: out, data });
      },
      ctx,
    ),
  );
}

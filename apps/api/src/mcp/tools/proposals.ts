// Tool 10: list_proposals — what the user decided about this connection's proposals.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, desc, eq, inArray, ne, type SQL } from 'drizzle-orm';
import { principalWorkspace, principalWorkspaces, type AgentPrincipal } from '../../agents/principal';
import { db } from '../../db/client';
import { proposals } from '../../db/schema';
import { expireDue, proposalFilesOf, talliesOf, toProposalSummary } from '../../services/proposals';
import { LIST_PROPOSALS_DESCRIPTION } from '../descriptions';
import { ok, withTool, type ToolCtx } from '../result';
import { ListProposalsInput, ListProposalsOutput } from '../schemas';
import { ownProposal } from './links';

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

type Args = { workspace_id?: string; proposal_id?: string; status: 'open' | 'closed' | 'all'; limit: number };

/** This credential's proposals in the given workspaces, newest first. */
export async function agentProposals(p: AgentPrincipal, args: Args) {
  await expireDue(p.user.id);
  let wsIds: string[];
  if (args.proposal_id) {
    const ws = await principalWorkspace(p, args.workspace_id);
    wsIds = [(await ownProposal(p, ws.id, args.proposal_id)).workspaceId];
  } else if (args.workspace_id) wsIds = [(await principalWorkspace(p, args.workspace_id)).id];
  else wsIds = (await principalWorkspaces(p)).map((w) => w.id);
  if (!wsIds.length) return [];
  const conds: SQL[] = [eq(proposals.userId, p.user.id), eq(proposals.agentCredential, p.credential), inArray(proposals.workspaceId, wsIds)];
  if (args.proposal_id) conds.push(eq(proposals.id, args.proposal_id));
  else if (args.status === 'open') conds.push(eq(proposals.status, 'open'));
  else if (args.status === 'closed') conds.push(ne(proposals.status, 'open'));
  const rows = await db
    .select()
    .from(proposals)
    .where(and(...conds))
    .orderBy(desc(proposals.id))
    .limit(args.limit);
  const tallies = await talliesOf(rows.map((r) => r.id));
  return Promise.all(
    rows.map(async (r) => {
      const s = toProposalSummary(r, tallies.get(r.id)!);
      const item = {
        id: s.id,
        status: s.status,
        message: s.message,
        created_at: s.createdAt,
        decided_at: s.decidedAt,
        base_commit_id: s.baseCommitId,
        url: s.url,
        counts: s.counts,
        accepted_action_ids: r.acceptedActionIds,
      };
      if (!args.proposal_id) return item;
      const files = await proposalFilesOf(r.id);
      return { ...item, files: files.map((f) => ({ index: f.seq, op: f.op, path: f.path, from_path: f.fromPath, status: f.status })) };
    }),
  );
}

export function registerProposalsTool(server: McpServer, p: AgentPrincipal, ctx: ToolCtx): void {
  server.registerTool(
    'list_proposals',
    {
      title: 'List proposals',
      description: LIST_PROPOSALS_DESCRIPTION,
      inputSchema: ListProposalsInput,
      outputSchema: ListProposalsOutput,
      annotations: READ_ONLY,
    },
    withTool(
      'list_proposals',
      p,
      async (args: Args) => {
        const list = await agentProposals(p, args);
        const n = (s: string) => list.filter((x) => x.status === s).length;
        const parts = [`${list.length} ${list.length === 1 ? 'proposal' : 'proposals'}`];
        for (const s of ['open', 'accepted', 'partial', 'discarded', 'expired']) if (n(s)) parts.push(`${n(s)} ${s}`);
        return ok({
          summary: parts.join(' · '),
          links: list.map((x) => ({ uri: x.url, name: 'Proposal', title: x.message || 'Proposal' })),
          data: { proposals: list },
        });
      },
      ctx,
    ),
  );
}

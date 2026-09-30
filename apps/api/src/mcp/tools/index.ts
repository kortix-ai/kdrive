// Registers the tools a principal's scope and mode allow (a tool outside the
// grant is never registered; withTool re-checks in every handler anyway).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentPrincipal } from '../../agents/principal';
import type { ToolCtx } from '../result';
import { toolsForScope, type McpToolName } from '../server';
import { registerCheckpointTool } from './checkpoint';
import { registerDiffTool } from './diff';
import { registerHistoryTools } from './history';
import { registerLinksTool } from './links';
import { registerProposalsTool } from './proposals';
import { registerReadTool } from './read';
import { registerRestoreTool } from './restore';
import { registerSearchTool } from './search';
import { registerUndoTool } from './undo';
import { registerWorkspaceTools } from './workspaces';
import { registerWriteTool } from './write';

export function registerTools(server: McpServer, p: AgentPrincipal, ctx: ToolCtx): void {
  const allowed = new Set<McpToolName>(toolsForScope(p.scope, p.mode));
  registerWorkspaceTools(server, p, ctx);
  registerReadTool(server, p, ctx);
  registerSearchTool(server, p, ctx);
  registerHistoryTools(server, p, ctx);
  registerDiffTool(server, p, ctx);
  registerLinksTool(server, p, ctx);
  if (allowed.has('write_changes')) registerWriteTool(server, p, ctx);
  if (allowed.has('list_proposals')) registerProposalsTool(server, p, ctx);
  if (allowed.has('create_checkpoint')) registerCheckpointTool(server, p, ctx);
  if (allowed.has('restore')) registerRestoreTool(server, p, ctx);
  if (allowed.has('undo')) registerUndoTool(server, p, ctx);
}

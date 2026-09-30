// Builds one stateless MCP server per request for a principal.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentPrincipal } from '../agents/principal';
import type { AgentMode, AgentScope } from '@volumes/shared';
import { MCP_SERVER_VERSION, serverInstructions } from './descriptions';
import { registerDiffCard } from './diff-card';
import type { ToolCtx } from './result';
import { registerTools } from './tools';

export const MCP_TOOL_NAMES = [
  'list_workspaces',
  'open_workspace',
  'read_files',
  'search_files',
  'get_history',
  'file_versions',
  'diff',
  'get_links',
  'write_changes',
  'list_proposals',
  'create_checkpoint',
  'restore',
  'undo',
] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

const READ_TOOLS: McpToolName[] = ['list_workspaces', 'open_workspace', 'read_files', 'search_files', 'get_history', 'file_versions', 'diff', 'get_links'];
const PROPOSE_TOOLS: McpToolName[] = ['write_changes', 'list_proposals'];
const DIRECT_TOOLS: McpToolName[] = ['create_checkpoint', 'restore', 'undo'];

/** The tools registered for a scope and mode: read → 8, propose / write+review → 10, write+direct → 13. */
export function toolsForScope(scope: AgentScope, mode: AgentMode = 'review'): McpToolName[] {
  if (scope === 'drive:read') return [...READ_TOOLS];
  if (scope === 'drive:write' && mode === 'direct') return [...READ_TOOLS, ...PROPOSE_TOOLS, ...DIRECT_TOOLS];
  return [...READ_TOOLS, ...PROPOSE_TOOLS];
}

export function buildMcpServer(p: AgentPrincipal, ctx: ToolCtx): McpServer {
  const server = new McpServer(
    { name: 'volumes', title: 'Volumes', version: MCP_SERVER_VERSION },
    { instructions: serverInstructions(p.scope, p.mode), capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, p, ctx);
  registerDiffCard(server);
  return server;
}

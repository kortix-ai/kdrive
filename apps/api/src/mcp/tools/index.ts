// Registers the tools a principal's scope and mode allow. (Builder B fills it.)
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentPrincipal } from '../../agents/principal';
import type { ToolCtx } from '../result';

export function registerTools(_server: McpServer, _p: AgentPrincipal, _ctx: ToolCtx): void {
  // Builder B registers the 13 tools (§9) here.
}

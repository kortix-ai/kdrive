// Builds one stateless MCP server per request for a principal.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AgentPrincipal } from '../agents/principal';
import type { AgentMode, AgentScope } from '@volumes/shared';
import { ERROR_HINTS, MCP_SERVER_VERSION, serverInstructions } from './descriptions';
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
    { name: 'volumes', title: 'KDRIVE', version: MCP_SERVER_VERSION },
    { instructions: serverInstructions(p.scope, p.mode), capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, p, ctx);
  registerDiffCard(server);
  jsonArgumentErrors(server);
  return server;
}

const MUTATING = new Set<string>(['write_changes', 'create_checkpoint', 'restore', 'undo']);

/**
 * The SDK answers bad arguments (schema validation) with a plain-text error
 * result. Rewrite those into our error shape, so every error an agent sees is
 * `{"error":{code,message,hint,details}}`.
 */
export function asJsonError(res: CallToolResult, tool: string): CallToolResult {
  if (!res?.isError || res.content?.length !== 1 || res.content[0].type !== 'text') return res;
  const text = res.content[0].text;
  if (text.startsWith('{"error"')) return res;
  const message = text.replace(/^MCP error -?\d+:\s*/, '').slice(0, 2000);
  const unknownTool = /^Tool .* (not found|disabled)$/.test(message);
  const details: Record<string, unknown> = MUTATING.has(tool) ? { outcome: 'not_committed' } : {};
  const error = unknownTool
    ? { code: 'not_found', message, hint: 'Call tools/list for the tools this connection can use.', details }
    : { code: 'bad_request', message, hint: ERROR_HINTS.bad_request, details };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error }) }] };
}

type Handler = (req: { params?: { name?: string } }, extra: unknown) => Promise<unknown>;

function jsonArgumentErrors(server: McpServer): void {
  const handlers = (server.server as unknown as { _requestHandlers?: Map<string, Handler> })._requestHandlers;
  const inner = handlers?.get('tools/call');
  if (!handlers || !inner) return;
  handlers.set('tools/call', async (req, extra) => asJsonError((await inner(req, extra)) as CallToolResult, String(req?.params?.name ?? '')));
}

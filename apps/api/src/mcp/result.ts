// Success results and the per-tool wrapper. (Builder B fills the bodies.)
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AgentPrincipal } from '../agents/principal';
import { notImplemented } from '../lib/http';
import type { McpToolName } from './server';

/** A browser link attached to a result as a `resource_link` block. */
export type Link = { uri: string; name: string; title?: string; mimeType?: string; description?: string };

/** Request context a tool handler gets besides its arguments. */
export interface ToolCtx {
  reqId: string;
  ip: string | null;
}

/** One summary line + resource links + the JSON text copy + structuredContent. */
export function ok<T extends Record<string, unknown>>(_r: { summary: string; links?: Link[]; data: T }): CallToolResult {
  throw notImplemented();
}

/**
 * Wraps a tool handler: re-checks the scope for `name`, applies per-tool
 * limits, times and logs the call, and turns any throw into a tool error.
 */
export function withTool<A>(
  _name: McpToolName,
  _p: AgentPrincipal,
  fn: (args: A) => Promise<CallToolResult>,
  _ctx?: ToolCtx,
): (args: A) => Promise<CallToolResult> {
  return async (args) => fn(args);
}

// Success results and the per-tool wrapper.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { rateKeyOf, type AgentPrincipal } from '../agents/principal';
import { env } from '../env';
import { ApiError } from '../lib/http';
import { checkRateLimitKey, limits } from '../middleware/rate-limit';
import { toolError, toolErrorBody } from './errors';
import { toolsForScope, type McpToolName } from './server';

/** A browser link attached to a result as a `resource_link` block. */
export type Link = { uri: string; name: string; title?: string; mimeType?: string; description?: string };

/** Request context a tool handler gets besides its arguments. */
export interface ToolCtx {
  reqId: string;
  ip: string | null;
}

export const MAX_LINKS = 50;
/** Largest JSON copy of a result (it is sent twice: as text and as structuredContent). */
export const MAX_RESULT_BYTES = 8 * 1024 * 1024;

/** One summary line + resource links + the JSON text copy + structuredContent. */
export function ok<T extends Record<string, unknown>>(r: { summary: string; links?: Link[]; data: T }): CallToolResult {
  const all = r.links ?? [];
  const links = all.slice(0, MAX_LINKS);
  const more = all.length - links.length;
  const content: CallToolResult['content'] = [{ type: 'text', text: more > 0 ? `${r.summary} (+${more} more)` : r.summary }];
  for (const l of links) {
    content.push({
      type: 'resource_link',
      uri: l.uri,
      name: l.name,
      ...(l.title !== undefined ? { title: l.title } : {}),
      ...(l.mimeType !== undefined ? { mimeType: l.mimeType } : {}),
      ...(l.description !== undefined ? { description: l.description } : {}),
    });
  }
  const json = JSON.stringify(r.data);
  if (json.length > MAX_RESULT_BYTES) {
    throw new ApiError(413, 'payload_too_large', 'This result is too large to return. Ask for fewer paths or a smaller max_bytes.', {
      max: MAX_RESULT_BYTES,
    });
  }
  content.push({ type: 'text', text: json });
  return { content, structuredContent: r.data };
}

/**
 * A step that runs after a change has landed (reading it back, a link, a
 * checkpoint): a failure is logged and yields `fallback`, so a committed
 * change is never reported as not committed.
 */
export async function afterCommit<T>(what: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[mcp] ${what} after a committed change failed`, e instanceof Error ? e.message : e);
    return fallback;
  }
}

/** Tools that change the drive (their errors carry details.outcome). */
const WRITE_TOOLS = new Set<McpToolName>(['write_changes', 'create_checkpoint', 'restore', 'undo']);

function logCall(ctx: ToolCtx | undefined, p: AgentPrincipal, name: string, outcome: string, ms: number): void {
  if (env.isTest) return;
  console.log(`[mcp] ${ctx?.reqId ?? '-'} ${p.credential} ${name} ${outcome} ${ms}ms`);
}

/**
 * Wraps a tool handler: re-checks the scope for `name`, applies per-tool
 * limits, times and logs the call, and turns any throw into a tool error.
 */
export function withTool<A>(
  name: McpToolName,
  p: AgentPrincipal,
  fn: (args: A) => Promise<CallToolResult>,
  ctx?: ToolCtx,
): (args: A) => Promise<CallToolResult> {
  const write = WRITE_TOOLS.has(name);
  return async (args) => {
    const t0 = Date.now();
    try {
      if (!toolsForScope(p.scope, p.mode).includes(name)) {
        throw new ApiError(403, 'insufficient_scope', 'This connection does not allow that tool.');
      }
      if (name === 'write_changes') checkRateLimitKey(limits.mcpWrite, `mcpw|${rateKeyOf(p)}`);
      const res = await fn(args);
      logCall(ctx, p, name, 'ok', Date.now() - t0);
      return res;
    } catch (e) {
      logCall(ctx, p, name, toolErrorBody(e, { write }).code, Date.now() - t0);
      return toolError(e, { write });
    }
  };
}

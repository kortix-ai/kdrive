// Error results: `isError: true` and one JSON text block
// `{"error":{code,message,hint,details}}`, never structuredContent. Codes,
// messages and details come from the same envelope the HTTP routes use.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ApiError } from '../lib/http';
import { toEnvelope } from '../middleware/errors';
import { isAmbiguousFailure } from '../services/ledger';
import { partialActionOf } from '../services/agent-batch';
import { ERROR_HINTS, PARTIAL_HINT, UNKNOWN_OUTCOME_HINT } from './descriptions';

const GENERIC_HINT = 'Tell the user what happened; do not repeat the same call unchanged.';
/** Codes where a write may have landed. */
const MAYBE_LANDED = new Set(['upstream_unavailable', 'internal']);

export interface ToolErrorBody {
  code: string;
  message: string;
  hint: string;
  details: Record<string, unknown>;
}

/** The error body for `e` (exported for tests and logging). */
export function toolErrorBody(e: unknown, opts: { write: boolean }): ToolErrorBody {
  const env = toEnvelope(e);
  const details: Record<string, unknown> = { ...(env.details ?? {}) };
  let hint = ERROR_HINTS[env.code] ?? GENERIC_HINT;
  let message = env.message;
  if (env.code === 'internal' && !(e instanceof ApiError)) message = 'Something went wrong.';
  if (env.code === 'rate_limited') {
    const retry = Number(details.retryAfterSeconds ?? details.retry_after_seconds ?? env.headers?.['Retry-After'] ?? 1);
    delete details.retryAfterSeconds;
    details.retry_after_seconds = Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : 1;
  }
  if (opts.write) {
    const partial = partialActionOf(e);
    if (partial) {
      details.outcome = 'unknown';
      details.partial = true;
      details.action_id = partial;
      hint = PARTIAL_HINT(partial);
    } else if (MAYBE_LANDED.has(env.code) || (!(e instanceof ApiError) && env.status >= 500 && isAmbiguousFailure(e))) {
      details.outcome = 'unknown';
      hint = UNKNOWN_OUTCOME_HINT;
    } else {
      details.outcome = 'not_committed';
    }
  }
  return { code: env.code, message, hint, details };
}

/** Converts any thrown error into a tool error result; `write` sets details.outcome. */
export function toolError(e: unknown, opts: { write: boolean }): CallToolResult {
  const body = toolErrorBody(e, opts);
  if (body.code === 'internal' || body.code === 'upstream_unavailable') {
    const what = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error('[mcp] tool failed', what.slice(0, 500));
  }
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: body }) }] };
}

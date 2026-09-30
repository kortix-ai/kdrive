// Error results: `isError: true` and one JSON text block. (Builder B fills the body.)
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { notImplemented } from '../lib/http';

/** Converts any thrown error into a tool error result; `write` sets details.outcome. */
export function toolError(_e: unknown, _opts: { write: boolean }): CallToolResult {
  throw notImplemented();
}

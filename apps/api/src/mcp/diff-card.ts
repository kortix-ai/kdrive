// The change card resource for hosts that render tool UIs. (Builder B, stretch.)
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const DIFF_CARD_URI = 'ui://volumes/diff-card/v1';
export const DIFF_CARD_HTML = '<!doctype html><meta charset="utf-8"><title>Volumes change card</title>';

/** Registers the card resource on a server. */
export function registerDiffCard(_server: McpServer): void {
  // Builder B registers the resource here.
}

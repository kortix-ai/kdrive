// Tool 4: search_files — name search over the tree.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { principalWorkspace, type AgentPrincipal } from '../../agents/principal';
import { driveUrl } from '../../agents/urls';
import { searchFiles } from '../../services/search';
import { SEARCH_FILES_DESCRIPTION } from '../descriptions';
import { ok, withTool, type ToolCtx } from '../result';
import { SearchFilesInput, SearchFilesOutput } from '../schemas';
import { entryKind, plural, commitIdOf } from './util';

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

type Args = { workspace_id?: string; query: string; at?: string; limit: number };

export function registerSearchTool(server: McpServer, p: AgentPrincipal, ctx: ToolCtx): void {
  server.registerTool(
    'search_files',
    {
      title: 'Search files',
      description: SEARCH_FILES_DESCRIPTION,
      inputSchema: SearchFilesInput,
      outputSchema: SearchFilesOutput,
      annotations: READ_ONLY,
    },
    withTool(
      'search_files',
      p,
      async (args: Args) => {
        const ws = await principalWorkspace(p, args.workspace_id);
        const r = await searchFiles(ws, args.query, args.at ? await commitIdOf(ws, args.at) : undefined, args.limit);
        const results = r.results.map((e) => {
          const type = entryKind(e.type);
          return { path: e.path, name: e.name, type, size: e.size, mtime: e.mtime, url: driveUrl(ws.id, e.path, type === 'dir' ? 'dir' : 'file') };
        });
        const data = { commit_id: r.commitId, results, truncated: r.truncated };
        return ok({
          summary: `${plural(results.length, 'match', 'matches')} for ${JSON.stringify(args.query)}${r.truncated ? ' · more exist, narrow the query' : ''}`,
          links: results.map((x) => ({ uri: x.url, name: x.name, title: x.path })),
          data,
        });
      },
      ctx,
    ),
  );
}

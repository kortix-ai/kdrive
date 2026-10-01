// Tools 5-6: get_history, file_versions.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRef, TimelineEntry } from '@volumes/shared';
import { basename } from '@volumes/shared';
import { principalWorkspace, type AgentPrincipal } from '../../agents/principal';
import { compareUrl, driveUrl } from '../../agents/urls';
import { buildTimeline } from '../../services/timeline';
import { fileVersions } from '../../services/versions';
import { FILE_VERSIONS_DESCRIPTION, GET_HISTORY_DESCRIPTION } from '../descriptions';
import { ok, withTool, type ToolCtx } from '../result';
import { FileVersionsInput, FileVersionsOutput, GetHistoryInput, GetHistoryOutput } from '../schemas';
import { headCommit, plural, toPath } from './util';

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

type By = { type: 'user' | 'agent' | 'system'; name: string | null };

/** Who made a change: an agent, the user, or the system (init / fork / outside the app). */
export function byOf(agent: AgentRef | null | undefined, user: { name: string | null; email: string } | null): By {
  if (agent) return { type: 'agent', name: agent.name };
  if (user) return { type: 'user', name: user.name || user.email };
  return { type: 'system', name: null };
}

export function historyEntry(e: TimelineEntry) {
  return {
    commit_id: e.commitId,
    action_id: e.actionId,
    created_at: e.createdAt,
    kind: e.kind,
    summary: e.summary,
    item_count: e.itemCount,
    bytes_delta: e.bytesDelta,
    is_head: e.isHead,
    undoable: e.undoable,
    by: byOf(e.agent, e.actor),
    checkpoints: e.checkpoints.map((c) => c.name),
    paths: e.paths.map((x) => ({ op: x.op, path: x.path, from_path: x.fromPath })),
  };
}

type HistoryArgs = { workspace_id?: string; limit: number; cursor?: string };
type VersionsArgs = { workspace_id?: string; path: string };

export function registerHistoryTools(server: McpServer, p: AgentPrincipal, ctx: ToolCtx): void {
  server.registerTool(
    'get_history',
    {
      title: 'Get history',
      description: GET_HISTORY_DESCRIPTION,
      inputSchema: GetHistoryInput,
      outputSchema: GetHistoryOutput,
      annotations: READ_ONLY,
    },
    withTool(
      'get_history',
      p,
      async (args: HistoryArgs) => {
        const ws = await principalWorkspace(p, args.workspace_id);
        const t = await buildTimeline(ws, { limit: args.limit, before: args.cursor });
        const entries = t.entries.map(historyEntry);
        const data = { head_commit_id: t.headCommitId, entries, next_cursor: t.nextCursor };
        const newest = entries[0];
        return ok({
          summary: `${plural(entries.length, 'change')}${newest ? ` · newest: ${newest.summary}` : ''}`,
          data,
        });
      },
      ctx,
    ),
  );

  server.registerTool(
    'file_versions',
    {
      title: 'File versions',
      description: FILE_VERSIONS_DESCRIPTION,
      inputSchema: FileVersionsInput,
      outputSchema: FileVersionsOutput,
      annotations: READ_ONLY,
    },
    withTool(
      'file_versions',
      p,
      async (args: VersionsArgs) => {
        const ws = await principalWorkspace(p, args.workspace_id);
        const path = toPath(args.path);
        const [r, head] = await Promise.all([fileVersions(ws, path), headCommit(ws)]);
        const owner = { name: p.user.name, email: p.user.email };
        const versions = r.versions.map((v) => ({
          commit_id: v.commitId,
          created_at: v.createdAt,
          size: v.size,
          op: v.op,
          action_id: v.actionId,
          summary: v.summary,
          is_current: v.isCurrent,
          checkpoints: v.checkpointNames,
          by: byOf(v.agent, v.actionId ? owner : null),
          compare_url: compareUrl(ws.id, path, v.commitId, head),
        }));
        const data = { path, source: r.source, versions };
        return ok({
          summary: `${plural(versions.length, 'version')} of ${path}`,
          links: [{ uri: driveUrl(ws.id, path, 'file'), name: basename(path) || path, title: path }],
          data,
        });
      },
      ctx,
    ),
  );
}

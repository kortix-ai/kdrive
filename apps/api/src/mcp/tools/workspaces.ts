// Tools 1-2: list_workspaces, open_workspace.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { dirname } from '@volumes/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { principalWorkspace, principalWorkspaces, type AgentPrincipal } from '../../agents/principal';
import { driveUrl } from '../../agents/urls';
import { db } from '../../db/client';
import { proposals } from '../../db/schema';
import { ApiError } from '../../lib/http';
import { getStore } from '../../storage';
import { listTree } from '../../services/tree';
import { ensureUserBootstrap, toWorkspaceSummaries } from '../../services/workspaces';
import type { WorkspaceCtx } from '../../types';
import { LIST_WORKSPACES_DESCRIPTION, OPEN_WORKSPACE_DESCRIPTION } from '../descriptions';
import { ok, withTool, type ToolCtx } from '../result';
import { ListWorkspacesInput, ListWorkspacesOutput, OpenWorkspaceInput, OpenWorkspaceOutput } from '../schemas';
import { accessOf, plural, safeStat, toPath } from './util';

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

type OpenArgs = { workspace_id?: string; root?: string; max_entries: number };

/** Open proposals this credential made in a workspace. */
export async function openProposalsOf(p: AgentPrincipal, wsId: string): Promise<number> {
  if (p.scope === 'drive:read') return 0;
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(proposals)
    .where(
      and(
        eq(proposals.workspaceId, wsId),
        eq(proposals.userId, p.user.id),
        eq(proposals.agentCredential, p.credential),
        eq(proposals.status, 'open'),
        sql`${proposals.expiresAt} > now()`,
      ),
    );
  return r?.n ?? 0;
}

const depth = (p: string) => (p === '/' ? 0 : p.split('/').length - 1);

/** Breadth-first order: shallower first, then by folder, folders before files, natural name order. */
export function manifestOrder<T extends { path: string; type: string; name?: string }>(entries: T[]): T[] {
  return entries.sort((a, b) => {
    const d = depth(a.path) - depth(b.path);
    if (d) return d;
    const pa = dirname(a.path);
    const pb = dirname(b.path);
    if (pa !== pb) return collator.compare(pa, pb) || (pa < pb ? -1 : 1);
    const t = (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1);
    if (t) return t;
    return collator.compare(a.path, b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  });
}

export async function openWorkspace(p: AgentPrincipal, ws: WorkspaceCtx, args: OpenArgs): Promise<z.infer<z.ZodObject<typeof OpenWorkspaceOutput>>> {
  const store = getStore();
  const root = toPath(args.root ?? '/');
  const head = (await store.getVolume(ws.volumeId)).headCommitId;
  const commit = await store.getCommit(ws.volumeId, head);
  if (root !== '/') {
    const st = await safeStat(ws, root, head);
    if (!st) throw new ApiError(404, 'path_not_found', 'That folder does not exist.', { path: root });
    if (st.type !== 'dir') throw new ApiError(409, 'not_a_directory', 'That is a file, not a folder.', { path: root });
  }
  const { entries } = await listTree(ws, root, head);
  const within = entries.filter((e) => e.path !== root);
  let files = 0;
  let folders = 0;
  let bytes = 0;
  for (const e of within) {
    if (e.type === 'dir') folders++;
    else if (e.type === 'file') {
      files++;
      bytes += e.size;
    }
  }
  const listed = manifestOrder(within.filter((e) => e.type === 'file' || e.type === 'dir').map((e) => ({ ...e })));
  const manifest = listed.slice(0, args.max_entries).map((e) => ({ path: e.path, type: e.type === 'dir' ? ('dir' as const) : ('file' as const), size: e.size }));
  return {
    workspace: { id: ws.id, name: ws.name, url: driveUrl(ws.id, '/', 'dir') },
    head_commit_id: head,
    head_created_at: commit.createdAt,
    root,
    file_count: files,
    folder_count: folders,
    total_bytes: bytes,
    manifest,
    manifest_truncated: listed.length > manifest.length,
    total_entries: listed.length,
    open_proposals: await openProposalsOf(p, ws.id),
    access: accessOf(p),
  };
}

export function registerWorkspaceTools(server: McpServer, p: AgentPrincipal, ctx: ToolCtx): void {
  server.registerTool(
    'list_workspaces',
    {
      title: 'List workspaces',
      description: LIST_WORKSPACES_DESCRIPTION,
      inputSchema: ListWorkspacesInput,
      outputSchema: ListWorkspacesOutput,
      annotations: READ_ONLY,
    },
    withTool(
      'list_workspaces',
      p,
      async () => {
        let rows = await principalWorkspaces(p);
        if (!rows.length && !p.workspaceId) {
          await ensureUserBootstrap({ id: p.user.id });
          rows = await principalWorkspaces(p);
        }
        const summaries = await toWorkspaceSummaries(rows);
        const workspaces = summaries.map((w) => ({
          id: w.id,
          name: w.name,
          is_default: w.isDefault,
          usage_bytes: w.usageBytes,
          url: driveUrl(w.id, '/', 'dir'),
        }));
        const def = p.workspaceId ?? summaries.find((w) => w.isDefault)?.id ?? summaries[0]?.id ?? '';
        const defName = summaries.find((w) => w.id === def)?.name ?? '';
        const data = { workspaces, default_workspace_id: def, access: accessOf(p) };
        return ok({
          summary: `${plural(workspaces.length, 'workspace')} · default: ${defName}`,
          links: workspaces.map((w) => ({ uri: w.url, name: w.name, title: w.name, description: 'Workspace' })),
          data,
        });
      },
      ctx,
    ),
  );

  server.registerTool(
    'open_workspace',
    {
      title: 'Open workspace',
      description: OPEN_WORKSPACE_DESCRIPTION,
      inputSchema: OpenWorkspaceInput,
      outputSchema: OpenWorkspaceOutput,
      annotations: READ_ONLY,
    },
    withTool(
      'open_workspace',
      p,
      async (args: OpenArgs) => {
        const ws = await principalWorkspace(p, args.workspace_id);
        const data = await openWorkspace(p, ws, args);
        return ok({
          summary: `Opened ${ws.name} · ${plural(data.file_count, 'file')} · ${plural(data.folder_count, 'folder')} · head ${data.head_commit_id}`,
          links: [{ uri: data.workspace.url, name: ws.name, title: ws.name, description: 'Workspace' }],
          data,
        });
      },
      ctx,
    ),
  );
}

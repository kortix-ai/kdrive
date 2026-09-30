// Input and output shapes of every MCP tool (zod 4 raw shapes, as the SDK's
// registerTool takes them). Frozen contract: builders may add optional output
// fields only. Tool arguments are snake_case.
import { z } from 'zod';
import { AgentModeSchema, AgentScopeSchema, IdSchema, RefSchema } from '@volumes/shared';

const WorkspaceId = IdSchema.optional().describe('Workspace to use. Default: the connected workspace, else the default one.');
const DrivePath = z.string().min(1).max(8192);
const EntryKind = z.enum(['file', 'dir', 'other']);

export const AccessShape = z.object({
  scope: AgentScopeSchema,
  /** null for drive:read */
  mode: AgentModeSchema.nullable(),
  restricted_to: z.string().nullable(),
});

export const ByShape = z.object({ type: z.enum(['user', 'agent', 'system']), name: z.string().nullable() });

// ── 1. list_workspaces ──────────────────────────────────────────────────────

export const ListWorkspacesInput = {};
export const ListWorkspacesOutput = {
  workspaces: z.array(
    z.object({ id: z.string(), name: z.string(), is_default: z.boolean(), usage_bytes: z.number(), url: z.string() }),
  ),
  default_workspace_id: z.string(),
  access: AccessShape,
};

// ── 2. open_workspace ───────────────────────────────────────────────────────

export const OpenWorkspaceInput = {
  workspace_id: WorkspaceId,
  root: z.string().max(8192).optional().describe('Folder to list instead of the whole drive (default /).'),
  max_entries: z.number().int().min(1).max(500).default(500).describe('Manifest size (at most 500).'),
};
export const OpenWorkspaceOutput = {
  workspace: z.object({ id: z.string(), name: z.string(), url: z.string() }),
  head_commit_id: z.string(),
  head_created_at: z.string(),
  root: z.string(),
  file_count: z.number(),
  folder_count: z.number(),
  total_bytes: z.number(),
  manifest: z.array(z.object({ path: z.string(), type: z.enum(['file', 'dir']), size: z.number() })),
  manifest_truncated: z.boolean(),
  total_entries: z.number(),
  open_proposals: z.number(),
  access: AccessShape,
};

// ── 3. read_files ───────────────────────────────────────────────────────────

export const ReadFilesInput = {
  workspace_id: WorkspaceId,
  paths: z.array(DrivePath).min(1).max(50).describe('Files or folders to read (at most 50).'),
  at: RefSchema.optional().describe('Version to read: a commit id (vc_…) or checkpoint tag. Default: now.'),
  offset: z.number().int().min(0).default(0).describe('Byte offset; only with exactly one path.'),
  max_bytes: z.number().int().min(1).max(1_048_576).default(65_536).describe('Total text budget for this call.'),
  encoding: z.enum(['auto', 'base64']).default('auto').describe('auto: text for text files; base64: raw bytes.'),
};
export const ReadFilesOutput = {
  commit_id: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      exists: z.boolean(),
      type: EntryKind.nullable(),
      size: z.number().nullable(),
      mtime: z.number().nullable(),
      version: z.string().nullable(),
      mime: z.string().nullable(),
      url: z.string().nullable(),
      download_url: z.string().nullable(),
      entries: z.array(z.object({ name: z.string(), path: z.string(), type: EntryKind, size: z.number() })).optional(),
      entries_truncated: z.boolean().optional(),
      content: z.string().optional(),
      encoding: z.enum(['utf8', 'base64']).optional(),
      binary: z.boolean().optional(),
      offset: z.number().optional(),
      shown_bytes: z.number().optional(),
      truncated: z.boolean().optional(),
      next_offset: z.number().nullable().optional(),
    }),
  ),
  budget_exhausted: z.boolean(),
};

// ── 4. search_files ─────────────────────────────────────────────────────────

export const SearchFilesInput = {
  workspace_id: WorkspaceId,
  query: z.string().min(1).max(200).describe('Part of a file or folder name (case-insensitive).'),
  at: RefSchema.optional().describe('Version to search: a commit id or checkpoint tag. Default: now.'),
  limit: z.number().int().min(1).max(200).default(50),
};
export const SearchFilesOutput = {
  commit_id: z.string(),
  results: z.array(
    z.object({ path: z.string(), name: z.string(), type: EntryKind, size: z.number(), mtime: z.number(), url: z.string() }),
  ),
  truncated: z.boolean(),
};

// ── 5. get_history ──────────────────────────────────────────────────────────

export const GetHistoryInput = {
  workspace_id: WorkspaceId,
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().max(128).optional().describe('next_cursor from the previous page.'),
};
export const GetHistoryOutput = {
  head_commit_id: z.string(),
  entries: z.array(
    z.object({
      commit_id: z.string(),
      action_id: z.string().nullable(),
      created_at: z.string(),
      kind: z.string(),
      summary: z.string(),
      item_count: z.number(),
      bytes_delta: z.number(),
      is_head: z.boolean(),
      undoable: z.boolean(),
      by: ByShape,
      checkpoints: z.array(z.string()),
      paths: z.array(z.object({ op: z.string(), path: z.string(), from_path: z.string().nullable() })),
    }),
  ),
  next_cursor: z.string().nullable(),
};

// ── 6. file_versions ────────────────────────────────────────────────────────

export const FileVersionsInput = { workspace_id: WorkspaceId, path: DrivePath.describe('The file.') };
export const FileVersionsOutput = {
  path: z.string(),
  source: z.enum(['ledger', 'chain']),
  versions: z.array(
    z.object({
      commit_id: z.string(),
      created_at: z.string(),
      size: z.number(),
      op: z.string(),
      action_id: z.string().nullable(),
      summary: z.string().nullable(),
      is_current: z.boolean(),
      checkpoints: z.array(z.string()),
      by: ByShape,
      compare_url: z.string(),
    }),
  ),
};

// ── 7. diff ─────────────────────────────────────────────────────────────────

const CommitPoint = z.object({ commit_id: z.string(), created_at: z.string() });

export const DiffInput = {
  workspace_id: WorkspaceId,
  from: z.string().min(1).max(128).describe('commit id, checkpoint tag, "now" or "latest_checkpoint"'),
  to: z.string().min(1).max(128).default('now').describe('commit id, checkpoint tag, "now" or "latest_checkpoint"'),
  paths: z.array(DrivePath).max(50).optional().describe('Limit the diff to these files or folders.'),
  include_text: z.boolean().default(true).describe('Include unified text diffs for small text files.'),
  context_lines: z.number().int().min(0).max(20).default(3),
};
export const DiffOutput = {
  from: CommitPoint,
  to: CommitPoint,
  changes: z.array(
    z.object({
      op: z.enum(['added', 'removed', 'changed', 'moved']),
      path: z.string(),
      from_path: z.string().nullable(),
      type: z.enum(['file', 'dir']),
      size_from: z.number().nullable(),
      size_to: z.number().nullable(),
      diff: z.string().nullable(),
      diff_omitted_reason: z.enum(['binary', 'too_large', 'budget', 'not_requested']).nullable(),
      compare_url: z.string().nullable(),
    }),
  ),
  counts: z.object({ added: z.number(), removed: z.number(), changed: z.number(), moved: z.number() }),
  truncated: z.boolean(),
  source: z.enum(['ledger', 'tree']),
  drive_compare_url: z.string(),
};

// ── 8. get_links ────────────────────────────────────────────────────────────

export const GetLinksInput = {
  workspace_id: WorkspaceId,
  paths: z.array(DrivePath).max(50).default([]).describe('Files or folders to link to.'),
  proposal_id: z.string().max(64).optional().describe('A proposal to link to.'),
};
export const GetLinksOutput = {
  workspace_url: z.string(),
  links: z.array(z.object({ path: z.string(), type: z.enum(['file', 'dir']).nullable(), exists: z.boolean(), url: z.string().nullable() })),
  proposal_url: z.string().nullable(),
};

// ── 9. write_changes ────────────────────────────────────────────────────────

const WritePath = z.string().min(1).max(8192);
export const ChangeOp = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('write'),
    path: WritePath,
    content: z.string().max(10_485_760).optional().describe('UTF-8 text. Exactly one of content / content_base64.'),
    content_base64: z.string().max(13_981_016).optional().describe('Standard base64 of the bytes (binary files).'),
  }),
  z.object({ op: z.literal('mkdir'), path: WritePath }),
  z.object({ op: z.literal('move'), from: WritePath, to: WritePath }),
  z.object({ op: z.literal('copy'), from: WritePath, to: WritePath }),
  z.object({ op: z.literal('delete'), path: WritePath }),
]);
export type ChangeOp = z.infer<typeof ChangeOp>;

export const WriteChangesInput = {
  workspace_id: WorkspaceId,
  last_seen_commit_id: z
    .string()
    .min(1)
    .max(128)
    .describe('The commit id (vc_…) you read: head_commit_id from open_workspace, or commit_id from read_files.'),
  message: z.string().max(500).default('').describe('One line saying what and why; shown to the user.'),
  changes: z.array(ChangeOp).min(1).max(200).describe('Ordered ops: write, mkdir, move, copy, delete.'),
  checkpoint: z.boolean().default(false).describe('Save a named checkpoint after the change.'),
  checkpoint_name: z.string().trim().min(1).max(80).optional().describe('Required when checkpoint is true.'),
};
export const WriteChangesOutput = {
  outcome: z.enum(['committed', 'unchanged', 'proposed']),
  workspace_id: z.string(),
  message: z.string(),
  base_commit_id: z.string(),
  head_commit_id: z.string().nullable(),
  commit_ids: z.array(z.string()),
  action_id: z.string().nullable(),
  proposal_id: z.string().nullable(),
  proposal_url: z.string().nullable(),
  expires_at: z.string().nullable(),
  changes: z.array(
    z.object({
      index: z.number(),
      op: z.enum(['write', 'mkdir', 'move', 'copy', 'delete']),
      path: z.string(),
      from_path: z.string().nullable(),
      result: z.enum(['created', 'replaced', 'unchanged', 'moved', 'copied', 'deleted', 'folder', 'proposed']),
      size: z.number().nullable(),
      url: z.string().nullable(),
    }),
  ),
  checkpoint: z.object({ id: z.string(), name: z.string(), commit_id: z.string() }).nullable(),
  /** Why the checkpoint asked for was not saved (the change itself landed). */
  checkpoint_error: z.string().nullable().optional(),
  summary: z.string(),
};

// ── 10. list_proposals ──────────────────────────────────────────────────────

const ProposalCountsShape = z.object({
  added: z.number(),
  modified: z.number(),
  removed: z.number(),
  moved: z.number(),
  copied: z.number(),
  folders: z.number(),
});

export const ListProposalsInput = {
  workspace_id: WorkspaceId,
  proposal_id: z.string().max(64).optional().describe('One proposal, with its per-file status.'),
  status: z.enum(['open', 'closed', 'all']).default('all'),
  limit: z.number().int().min(1).max(50).default(20),
};
export const ListProposalsOutput = {
  proposals: z.array(
    z.object({
      id: z.string(),
      status: z.enum(['open', 'accepted', 'partial', 'discarded', 'expired']),
      message: z.string(),
      created_at: z.string(),
      decided_at: z.string().nullable(),
      base_commit_id: z.string(),
      url: z.string(),
      counts: ProposalCountsShape,
      accepted_action_ids: z.array(z.string()),
      files: z
        .array(
          z.object({
            index: z.number(),
            op: z.string(),
            path: z.string(),
            from_path: z.string().nullable(),
            status: z.enum(['pending', 'accepted', 'discarded']),
          }),
        )
        .optional(),
    }),
  ),
};

// ── 11. create_checkpoint ───────────────────────────────────────────────────

export const CreateCheckpointInput = {
  workspace_id: WorkspaceId,
  name: z.string().trim().min(1).max(80).describe('Short name, e.g. "Draft ready".'),
  note: z.string().max(500).default(''),
  at: RefSchema.optional().describe('Version to checkpoint (default: now).'),
};
export const CreateCheckpointOutput = {
  checkpoint: z.object({ id: z.string(), name: z.string(), note: z.string(), commit_id: z.string(), created_at: z.string() }),
  budget: z.object({ used: z.number(), max: z.number() }),
  url: z.string(),
};

// ── 12. restore ─────────────────────────────────────────────────────────────

export const RestoreInput = {
  workspace_id: WorkspaceId,
  at: RefSchema.describe('Commit id (vc_…) or checkpoint tag to go back to.'),
  paths: z.array(DrivePath).max(1000).optional().describe('Omit to restore the whole drive.'),
};
export const RestoreOutput = {
  /** unchanged: the paths were already at that version (no action, nothing to undo). */
  outcome: z.enum(['committed', 'unchanged']),
  action_id: z.string().nullable(),
  summary: z.string(),
  head_commit_id: z.string().nullable(),
  restored_to: z.string().nullable(),
  checkpoint: z.object({ id: z.string(), name: z.string() }).nullable(),
};

// ── 13. undo ────────────────────────────────────────────────────────────────

export const UndoInput = {
  workspace_id: WorkspaceId,
  action_id: IdSchema.optional().describe("Change to undo. Default: this connection's most recent change."),
};
export const UndoOutput = {
  /** unchanged: undoing put nothing back (no action). */
  outcome: z.enum(['committed', 'unchanged']),
  action_id: z.string().nullable(),
  undone_action_id: z.string(),
  summary: z.string(),
  head_commit_id: z.string().nullable(),
};

import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import type { AgentPrincipal } from '../agents/principal';
import { DATA_LINE, UNTRUSTED_LINE } from './descriptions';
import * as S from './schemas';
import { buildMcpServer, MCP_TOOL_NAMES, toolsForScope } from './server';

const principal = (scope: AgentPrincipal['scope'], mode: AgentPrincipal['mode'] = 'review'): AgentPrincipal => ({
  kind: 'oauth',
  credential: 'oauth:client',
  grantId: 'g',
  name: 'Server agent',
  user: { id: 'u', email: 'u@test.local', name: null, image: null },
  scope,
  mode,
  workspaceId: null,
});

type Registered = Record<string, { description: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }; _meta?: Record<string, unknown> }>;
const registered = (p: AgentPrincipal): Registered => (buildMcpServer(p, { reqId: 't', ip: null }) as unknown as { _registeredTools: Registered })._registeredTools;

describe('tool surface', () => {
  test('toolsForScope: read 8, propose 10, write+review 10, write+direct 13', () => {
    expect(toolsForScope('drive:read')).toHaveLength(8);
    expect(toolsForScope('drive:propose')).toHaveLength(10);
    expect(toolsForScope('drive:propose', 'direct')).toHaveLength(10);
    expect(toolsForScope('drive:write', 'review')).toHaveLength(10);
    expect(toolsForScope('drive:write', 'direct')).toEqual([...MCP_TOOL_NAMES]);
  });

  test('the server registers exactly the allowed tools', () => {
    for (const [scope, mode] of [
      ['drive:read', 'review'],
      ['drive:propose', 'review'],
      ['drive:write', 'review'],
      ['drive:write', 'direct'],
    ] as const) {
      expect(Object.keys(registered(principal(scope, mode))).sort()).toEqual([...toolsForScope(scope, mode)].sort());
    }
  });

  test('descriptions carry the data line; content tools the untrusted line; write mode is chosen', () => {
    const tools = registered(principal('drive:write', 'direct'));
    const content = ['list_workspaces', 'open_workspace', 'read_files', 'search_files', 'get_history', 'file_versions', 'diff'];
    for (const [name, t] of Object.entries(tools)) {
      expect(t.description).toContain(DATA_LINE);
      if (content.includes(name)) expect(t.description).toContain(UNTRUSTED_LINE);
    }
    expect(tools.write_changes.description).toContain('Changes land immediately');
    expect(tools.write_changes.annotations?.destructiveHint).toBe(true);
    expect(tools.read_files.annotations?.readOnlyHint).toBe(true);
    expect(tools.diff._meta).toEqual({ ui: { resourceUri: 'ui://volumes/diff-card/v1' } });
    const review = registered(principal('drive:propose'));
    expect(review.write_changes.description).toContain('review mode');
    expect(review.write_changes.annotations?.destructiveHint).toBe(false);
  });
});

const url = 'http://localhost:4100/drive?ws=w';
const counts = { added: 1, modified: 0, removed: 0, moved: 0, copied: 0, folders: 0 };
const access = { scope: 'drive:write', mode: 'direct', restricted_to: null };
const by = { type: 'agent', name: 'A' };

const SAMPLES: Record<string, [Record<string, z.ZodType>, unknown]> = {
  list_workspaces: [S.ListWorkspacesOutput, { workspaces: [{ id: 'w', name: 'My Drive', is_default: true, usage_bytes: 0, url }], default_workspace_id: 'w', access }],
  open_workspace: [
    S.OpenWorkspaceOutput,
    {
      workspace: { id: 'w', name: 'My Drive', url },
      head_commit_id: 'vc_1',
      head_created_at: '2026-01-01T00:00:00.000Z',
      root: '/',
      file_count: 1,
      folder_count: 0,
      total_bytes: 3,
      manifest: [{ path: '/a', type: 'file', size: 3 }],
      manifest_truncated: false,
      total_entries: 1,
      open_proposals: 0,
      access,
    },
  ],
  read_files: [S.ReadFilesOutput, { commit_id: 'vc_1', files: [{ path: '/a', exists: true, type: 'file', size: 3, mtime: 1, version: 'v', mime: 'text/plain', url, download_url: url, content: 'abc', encoding: 'utf8', offset: 0, shown_bytes: 3, truncated: false, next_offset: null }], budget_exhausted: false }],
  search_files: [S.SearchFilesOutput, { commit_id: 'vc_1', results: [{ path: '/a', name: 'a', type: 'file', size: 1, mtime: 1, url }], truncated: false }],
  get_history: [S.GetHistoryOutput, { head_commit_id: 'vc_1', entries: [{ commit_id: 'vc_1', action_id: null, created_at: 'x', kind: 'upload', summary: 's', item_count: 1, bytes_delta: 0, is_head: true, undoable: true, by, checkpoints: [], paths: [{ op: 'added', path: '/a', from_path: null }] }], next_cursor: null }],
  file_versions: [S.FileVersionsOutput, { path: '/a', source: 'ledger', versions: [{ commit_id: 'vc_1', created_at: 'x', size: 1, op: 'added', action_id: 'a', summary: 's', is_current: true, checkpoints: [], by, compare_url: url }] }],
  diff: [S.DiffOutput, { from: { commit_id: 'vc_1', created_at: 'x' }, to: { commit_id: 'vc_2', created_at: 'y' }, changes: [{ op: 'added', path: '/a', from_path: null, type: 'file', size_from: null, size_to: 1, diff: '+a', diff_omitted_reason: null, compare_url: url }], counts: { added: 1, removed: 0, changed: 0, moved: 0 }, truncated: false, source: 'ledger', drive_compare_url: url }],
  get_links: [S.GetLinksOutput, { workspace_url: url, links: [{ path: '/a', type: 'file', exists: true, url }], proposal_url: null }],
  write_changes: [S.WriteChangesOutput, { outcome: 'committed', workspace_id: 'w', message: '', base_commit_id: 'vc_1', head_commit_id: 'vc_2', commit_ids: ['vc_2'], action_id: 'a', proposal_id: null, proposal_url: null, expires_at: null, changes: [{ index: 0, op: 'write', path: '/a', from_path: null, result: 'created', size: 1, url }], checkpoint: null, summary: 'Wrote /a' }],
  list_proposals: [S.ListProposalsOutput, { proposals: [{ id: 'p', status: 'open', message: '', created_at: 'x', decided_at: null, base_commit_id: 'vc_1', url, counts, accepted_action_ids: [], files: [{ index: 0, op: 'write', path: '/a', from_path: null, status: 'pending' }] }] }],
  create_checkpoint: [S.CreateCheckpointOutput, { checkpoint: { id: 'c', name: 'n', note: '', commit_id: 'vc_1', created_at: 'x' }, budget: { used: 1, max: 100 }, url }],
  restore: [S.RestoreOutput, { outcome: 'committed', action_id: 'a', summary: 's', head_commit_id: 'vc_3', restored_to: null, checkpoint: null }],
  undo: [S.UndoOutput, { outcome: 'committed', action_id: 'b', undone_action_id: 'a', summary: 'Undid: s', head_commit_id: 'vc_4' }],
};

describe('output schemas', () => {
  test('each validates a sample result', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    for (const [name, [shape, sample]] of Object.entries(SAMPLES)) {
      const r = z.object(shape).safeParse(sample);
      if (!r.success) throw new Error(`${name}: ${r.error.message}`);
    }
  });
});

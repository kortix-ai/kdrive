// One typed function per API route (architecture §6.3). FROZEN names:
// builders call these and never hand-roll fetches to our API.
import {
  AdminUserResponse,
  AdminUsersResponse,
  AuditListResponse,
  CheckpointListResponse,
  CheckpointResponse,
  CommitResponse,
  CompareDriveResponse,
  CompareFileResponse,
  ConfigResponse,
  DeletedResponse,
  LinkListResponse,
  LinkResponse,
  ListResponse,
  MeResponse,
  MutationResponse,
  PublicListResponse,
  PublicShareMeta,
  RestoreResponse,
  SearchResponse,
  StatResponse,
  TimelineResponse,
  UndoResponse,
  UploadCommitResponse,
  UploadPlanResponse,
  UsageResponse,
  VersionsResponse,
  WorkspaceListResponse,
  WorkspaceResponse,
  type CreateCheckpointRequest,
  type CreateLinkRequest,
  type CreateWorkspaceRequest,
  type DuplicateWorkspaceRequest,
  type RestoreRequest,
  type UpdateCheckpointRequest,
  type UpdateLinkRequest,
  type UpdateWorkspaceRequest,
  type UploadPlanRequest,
} from '@volumes/shared';
import { apiFetch, qs } from './client';

const w = (ws: string) => `/api/w/${encodeURIComponent(ws)}`;
type Item = { from: string; to: string };

export const api = {
  config: () => apiFetch('/api/config', {}, ConfigResponse),

  me: {
    get: () => apiFetch('/api/me', {}, MeResponse),
    usage: () => apiFetch('/api/me/usage', {}, UsageResponse),
    audit: (q: { before?: number | null; limit?: number } = {}) =>
      apiFetch(`/api/me/audit${qs({ before: q.before, limit: q.limit })}`, {}, AuditListResponse),
    deleteAccount: (req: { confirm: string }) => apiFetch<void>('/api/me', { method: 'DELETE', json: req }),
  },

  auth: {
    /** Dev-only email sign-in (VOLUMES_DEV_LOGIN=1). */
    devSignIn: (email: string, name?: string) =>
      apiFetch<{ user: { id: string; email: string } }>('/api/auth/dev/sign-in', { method: 'POST', json: { email, name } }),
  },

  files: {
    list: (ws: string, q: { path: string; at?: string | null }) =>
      apiFetch(`${w(ws)}/files${qs({ path: q.path, at: q.at })}`, {}, ListResponse),
    stat: (ws: string, q: { path: string; at?: string | null }) =>
      apiFetch(`${w(ws)}/files/stat${qs({ path: q.path, at: q.at })}`, {}, StatResponse),
    createFolder: (ws: string, path: string) => apiFetch(`${w(ws)}/folders`, { method: 'POST', json: { path } }, MutationResponse),
    move: (ws: string, items: Item[], overwrite?: boolean) =>
      apiFetch(`${w(ws)}/files/move`, { method: 'POST', json: { items, overwrite } }, MutationResponse),
    copy: (ws: string, items: Item[], overwrite?: boolean) =>
      apiFetch(`${w(ws)}/files/copy`, { method: 'POST', json: { items, overwrite } }, MutationResponse),
    remove: (ws: string, paths: string[]) => apiFetch(`${w(ws)}/files/delete`, { method: 'POST', json: { paths } }, MutationResponse),
    search: (ws: string, q: { q: string; at?: string | null; limit?: number }) =>
      apiFetch(`${w(ws)}/search${qs({ q: q.q, at: q.at, limit: q.limit })}`, {}, SearchResponse),
  },

  uploads: {
    plan: (ws: string, req: UploadPlanRequest) => apiFetch(`${w(ws)}/uploads`, { method: 'POST', json: req }, UploadPlanResponse),
    putBlock: (ws: string, uploadId: string, sha: string, bytes: BodyInit, signal?: AbortSignal) =>
      apiFetch<void>(`${w(ws)}/uploads/${encodeURIComponent(uploadId)}/blocks/${sha}`, {
        method: 'PUT',
        body: bytes,
        headers: { 'content-type': 'application/octet-stream' },
        signal,
      }),
    commit: (ws: string, uploadId: string) =>
      apiFetch(`${w(ws)}/uploads/${encodeURIComponent(uploadId)}/commit`, { method: 'POST', json: {} }, UploadCommitResponse),
    abort: (ws: string, uploadId: string) => apiFetch<void>(`${w(ws)}/uploads/${encodeURIComponent(uploadId)}`, { method: 'DELETE' }),
  },

  versioning: {
    timeline: (ws: string, q: { limit?: number; before?: string | null } = {}) =>
      apiFetch(`${w(ws)}/timeline${qs({ limit: q.limit, before: q.before })}`, {}, TimelineResponse),
    commit: (ws: string, ref: string) => apiFetch(`${w(ws)}/commits/${encodeURIComponent(ref)}`, {}, CommitResponse),
    versions: (ws: string, path: string) => apiFetch(`${w(ws)}/versions${qs({ path })}`, {}, VersionsResponse),
    compareFile: (ws: string, q: { path: string; a: string; b: string }) =>
      apiFetch(`${w(ws)}/compare/file${qs(q)}`, {}, CompareFileResponse),
    compareDrive: (ws: string, q: { a: string; b: string }) => apiFetch(`${w(ws)}/compare/drive${qs(q)}`, {}, CompareDriveResponse),
    restore: (ws: string, req: RestoreRequest) => apiFetch(`${w(ws)}/restore`, { method: 'POST', json: req }, RestoreResponse),
    undo: (ws: string, actionId: string) =>
      apiFetch(`${w(ws)}/actions/${encodeURIComponent(actionId)}/undo`, { method: 'POST', json: {} }, UndoResponse),
    deleted: (ws: string, q: { limit?: number } = {}) => apiFetch(`${w(ws)}/deleted${qs({ limit: q.limit })}`, {}, DeletedResponse),
  },

  checkpoints: {
    list: (ws: string) => apiFetch(`${w(ws)}/checkpoints`, {}, CheckpointListResponse),
    create: (ws: string, req: CreateCheckpointRequest) => apiFetch(`${w(ws)}/checkpoints`, { method: 'POST', json: req }, CheckpointResponse),
    update: (ws: string, id: string, req: UpdateCheckpointRequest) =>
      apiFetch(`${w(ws)}/checkpoints/${encodeURIComponent(id)}`, { method: 'PATCH', json: req }, CheckpointResponse),
    remove: (ws: string, id: string) => apiFetch<void>(`${w(ws)}/checkpoints/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },

  links: {
    list: (ws: string, q: { path?: string | null } = {}) => apiFetch(`${w(ws)}/links${qs({ path: q.path })}`, {}, LinkListResponse),
    create: (ws: string, req: CreateLinkRequest) => apiFetch(`${w(ws)}/links`, { method: 'POST', json: req }, LinkResponse),
    update: (ws: string, id: string, req: UpdateLinkRequest) =>
      apiFetch(`${w(ws)}/links/${encodeURIComponent(id)}`, { method: 'PATCH', json: req }, LinkResponse),
    revoke: (ws: string, id: string) => apiFetch<void>(`${w(ws)}/links/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },

  public: {
    meta: (token: string) => apiFetch(`/api/public/s/${encodeURIComponent(token)}`, {}, PublicShareMeta),
    list: (token: string, q: { path?: string } = {}) =>
      apiFetch(`/api/public/s/${encodeURIComponent(token)}/files${qs({ path: q.path })}`, {}, PublicListResponse),
  },

  workspaces: {
    list: () => apiFetch('/api/workspaces', {}, WorkspaceListResponse),
    create: (req: CreateWorkspaceRequest) => apiFetch('/api/workspaces', { method: 'POST', json: req }, WorkspaceResponse),
    update: (id: string, req: UpdateWorkspaceRequest) =>
      apiFetch(`/api/workspaces/${encodeURIComponent(id)}`, { method: 'PATCH', json: req }, WorkspaceResponse),
    remove: (id: string) => apiFetch<void>(`/api/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    duplicate: (id: string, req: DuplicateWorkspaceRequest) =>
      apiFetch(`/api/workspaces/${encodeURIComponent(id)}/duplicate`, { method: 'POST', json: req }, WorkspaceResponse),
  },

  admin: {
    users: (q: { q?: string } = {}) => apiFetch(`/api/admin/users${qs({ q: q.q })}`, {}, AdminUsersResponse),
    setQuota: (userId: string, quotaBytes: number) =>
      apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/quota`, { method: 'PUT', json: { quotaBytes } }, AdminUserResponse),
    audit: (q: { userId?: string; kind?: string; before?: number | null; limit?: number } = {}) =>
      apiFetch(`/api/admin/audit${qs({ userId: q.userId, kind: q.kind, before: q.before, limit: q.limit })}`, {}, AuditListResponse),
  },
};

export type Api = typeof api;

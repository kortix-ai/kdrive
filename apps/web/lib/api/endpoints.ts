// One typed function per API route (architecture §6.3). FROZEN names:
// builders call these and never hand-roll fetches to our API.
import {
  DrivePeopleResponse,
  InvitationListResponse,
  InviteResponse,
  type InviteRequest,
  type LinkKind,
  type MemberRole,
  AcceptProposalResponse,
  AdminAuditListResponse,
  AdminBillingResponse,
  type SetBillingPricesRequest,
  AdminDomainsResponse,
  AdminDrivesResponse,
  AdminEntryResponse,
  AdminLogsResponse,
  AdminSessionResponse,
  AdminSettingsResponse,
  AdminListResponse,
  AdminOverviewResponse,
  AdminStorageRequestResponse,
  AdminStorageRequestsResponse,
  AdminUserDetailResponse,
  AdminUserResponse,
  AdminUsersResponse,
  type AdminUserSort,
  AuditListResponse,
  BillingResponse,
  CheckpointListResponse,
  CheckpointResponse,
  CommitResponse,
  CompareDriveResponse,
  CompareFileResponse,
  ConfigResponse,
  ConnectedAppListResponse,
  ConnectedAppResponse,
  CreateAgentTokenResponse,
  AgentTokenListResponse,
  DiscardProposalResponse,
  OAuthConsentInfo,
  OAuthConsentResult,
  ProposalCountResponse,
  ProposalDetailResponse,
  ProposalListResponse,
  DeletedResponse,
  DriveStarsResponse,
  RecentListResponse,
  StarredListResponse,
  LinkListResponse,
  LinkResponse,
  ListResponse,
  MeResponse,
  MutationResponse,
  PublicListResponse,
  PublicShareMeta,
  PublicUploadMeta,
  RedirectResponse,
  RestoreResponse,
  SearchResponse,
  StatResponse,
  StorageOverviewResponse,
  StoragePeopleResponse,
  StorageRequestResponse,
  TimelineResponse,
  UndoResponse,
  UploadCommitResponse,
  UploadPlanResponse,
  UsageResponse,
  VersionsResponse,
  WorkspaceListResponse,
  WorkspaceResponse,
  type AcceptProposalRequest,
  type CreateAgentTokenRequest,
  type CreateCheckpointRequest,
  type DiscardProposalRequest,
  type OAuthConsentDecision,
  type UpdateConnectedAppRequest,
  type CreateLinkRequest,
  type CreateStorageRequest,
  type PaidPlanId,
  type CreateWorkspaceRequest,
  type DuplicateWorkspaceRequest,
  type RestoreRequest,
  type UpdateCheckpointRequest,
  type UpdateLinkRequest,
  type UpdateWorkspaceRequest,
  type UploadPlanRequest,
  CommentCountsResponse,
  CommentListResponse,
  CommentResponse,
  LabelItemsResponse,
  LabelListResponse,
  LabelResponse,
  type AssignLabelRequest,
  type CreateCommentRequest,
  type CreateLabelRequest,
  type UpdateCommentRequest,
  type UpdateLabelRequest,
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
    /** The latest request for more storage (open, or the last one an admin answered). */
    storageRequest: () => apiFetch('/api/me/storage-requests', {}, StorageRequestResponse),
    requestStorage: (req: CreateStorageRequest) =>
      apiFetch('/api/me/storage-requests', { method: 'POST', json: req }, StorageRequestResponse),
  },

  /** Paid plans through Stripe (when the server has it configured). */
  billing: {
    get: () => apiFetch('/api/billing', {}, BillingResponse),
    /** A Stripe Checkout URL to send the browser to. */
    checkout: (plan: PaidPlanId) => apiFetch('/api/billing/checkout', { method: 'POST', json: { plan } }, RedirectResponse),
    /** A Stripe billing portal URL (change plan or card, cancel, invoices). */
    portal: () => apiFetch('/api/billing/portal', { method: 'POST', json: {} }, RedirectResponse),
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

  /** Comments on files (every member of the drive, viewers too). */
  comments: {
    list: (ws: string, path: string) => apiFetch(`${w(ws)}/comments${qs({ path })}`, {}, CommentListResponse),
    counts: (ws: string) => apiFetch(`${w(ws)}/comments/counts`, {}, CommentCountsResponse),
    create: (ws: string, req: CreateCommentRequest) => apiFetch(`${w(ws)}/comments`, { method: 'POST', json: req }, CommentResponse),
    update: (ws: string, id: string, req: UpdateCommentRequest) =>
      apiFetch(`${w(ws)}/comments/${encodeURIComponent(id)}`, { method: 'PATCH', json: req }, CommentResponse),
    remove: (ws: string, id: string) => apiFetch<void>(`${w(ws)}/comments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },

  /** The drive's tags ("labels" in the API). */
  labels: {
    list: (ws: string) => apiFetch(`${w(ws)}/labels`, {}, LabelListResponse),
    items: (ws: string, id: string) => apiFetch(`${w(ws)}/labels/${encodeURIComponent(id)}/items`, {}, LabelItemsResponse),
    create: (ws: string, req: CreateLabelRequest) => apiFetch(`${w(ws)}/labels`, { method: 'POST', json: req }, LabelResponse),
    update: (ws: string, id: string, req: UpdateLabelRequest) =>
      apiFetch(`${w(ws)}/labels/${encodeURIComponent(id)}`, { method: 'PATCH', json: req }, LabelResponse),
    remove: (ws: string, id: string) => apiFetch<void>(`${w(ws)}/labels/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    assign: (ws: string, req: AssignLabelRequest) => apiFetch(`${w(ws)}/labels/assign`, { method: 'POST', json: req }, LabelListResponse),
  },

  public: {
    meta: (token: string) => apiFetch(`/api/public/s/${encodeURIComponent(token)}`, {}, PublicShareMeta),
    list: (token: string, q: { path?: string } = {}) =>
      apiFetch(`/api/public/s/${encodeURIComponent(token)}/files${qs({ path: q.path })}`, {}, PublicListResponse),
    /** A right password sets this link's unlock cookie (204). `upload`: an upload link (`/u/<token>`). */
    unlock: (token: string, password: string, kind: LinkKind = 'view') =>
      apiFetch<void>(`/api/public/${kind === 'upload' ? 'u' : 's'}/${encodeURIComponent(token)}/unlock`, { method: 'POST', json: { password } }),
    /** An upload link's page (counts an open). Files go up with `sendFile` (lib/upload/link-send.ts). */
    uploadMeta: (token: string) => apiFetch(`/api/public/u/${encodeURIComponent(token)}`, {}, PublicUploadMeta),
  },

  workspaces: {
    list: () => apiFetch('/api/workspaces', {}, WorkspaceListResponse),
    create: (req: CreateWorkspaceRequest) => apiFetch('/api/workspaces', { method: 'POST', json: req }, WorkspaceResponse),
    update: (id: string, req: UpdateWorkspaceRequest) =>
      apiFetch(`/api/workspaces/${encodeURIComponent(id)}`, { method: 'PATCH', json: req }, WorkspaceResponse),
    remove: (id: string) => apiFetch<void>(`/api/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    duplicate: (id: string, req: DuplicateWorkspaceRequest) =>
      apiFetch(`/api/workspaces/${encodeURIComponent(id)}/duplicate`, { method: 'POST', json: req }, WorkspaceResponse),
    /** Everyone with access to the drive, and (for its owner) the open invitations. */
    people: (id: string) => apiFetch(`/api/workspaces/${encodeURIComponent(id)}/people`, {}, DrivePeopleResponse),
    invite: (id: string, req: InviteRequest) =>
      apiFetch(`/api/workspaces/${encodeURIComponent(id)}/invites`, { method: 'POST', json: req }, InviteResponse),
    revokeInvite: (id: string, inviteId: string) =>
      apiFetch<void>(`/api/workspaces/${encodeURIComponent(id)}/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' }),
    setRole: (id: string, userId: string, role: MemberRole) =>
      apiFetch(`/api/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: 'PATCH', json: { role } }, DrivePeopleResponse),
    /** Removes a member (owner), or leaves the drive when `userId` is yourself. */
    removeMember: (id: string, userId: string) =>
      apiFetch<void>(`/api/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  },

  /** Invitations to other people's drives, addressed to you. */
  invitations: {
    list: () => apiFetch('/api/invitations', {}, InvitationListResponse),
    accept: (id: string) => apiFetch(`/api/invitations/${encodeURIComponent(id)}/accept`, { method: 'POST', json: {} }, WorkspaceResponse),
    decline: (id: string) => apiFetch<void>(`/api/invitations/${encodeURIComponent(id)}/decline`, { method: 'POST', json: {} }),
  },

  /** Starred items (per person, across drives) and the starred paths of one drive. */
  stars: {
    list: () => apiFetch('/api/stars', {}, StarredListResponse),
    drive: (ws: string) => apiFetch(`${w(ws)}/stars`, {}, DriveStarsResponse),
    set: (ws: string, paths: string[], starred: boolean) =>
      apiFetch('/api/stars', { method: 'POST', json: { workspaceId: ws, paths, starred } }, DriveStarsResponse),
  },

  /** Files the user recently opened or changed, across drives. */
  recent: {
    list: (q: { limit?: number } = {}) => apiFetch(`/api/recent${qs({ limit: q.limit })}`, {}, RecentListResponse),
    opened: (ws: string, path: string) => apiFetch<void>('/api/recent/opened', { method: 'POST', json: { workspaceId: ws, path } }),
  },

  /** Settings → Storage: the own drives' breakdown, and who wrote what in one drive (any member may read it). */
  storage: {
    overview: () => apiFetch('/api/me/storage', {}, StorageOverviewResponse),
    people: (ws: string) => apiFetch(`${w(ws)}/storage/people`, {}, StoragePeopleResponse),
  },

  /** AI agents: tokens, connected apps (OAuth grants) and the consent page. */
  agents: {
    tokens: () => apiFetch('/api/agents/tokens', {}, AgentTokenListResponse),
    createToken: (req: CreateAgentTokenRequest) =>
      apiFetch('/api/agents/tokens', { method: 'POST', json: req }, CreateAgentTokenResponse),
    revokeToken: (id: string) => apiFetch<void>(`/api/agents/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    apps: () => apiFetch('/api/agents/apps', {}, ConnectedAppListResponse),
    updateApp: (id: string, req: UpdateConnectedAppRequest) =>
      apiFetch(`/api/agents/apps/${encodeURIComponent(id)}`, { method: 'PATCH', json: req }, ConnectedAppResponse),
    revokeApp: (id: string) => apiFetch<void>(`/api/agents/apps/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    /** `oauthQuery` is the consent page's whole query string (signed by the OAuth provider). */
    consentInfo: (oauthQuery: string) =>
      apiFetch(`/api/agents/oauth/consent-info${qs({ oauth_query: oauthQuery })}`, {}, OAuthConsentInfo),
    consent: (req: OAuthConsentDecision) =>
      apiFetch('/api/agents/oauth/consent', { method: 'POST', json: req }, OAuthConsentResult),
  },

  /** Changes AI agents proposed for review. */
  proposals: {
    list: (ws: string, q: { status?: 'open' | 'closed' | 'all'; limit?: number; before?: string | null } = {}) =>
      apiFetch(`${w(ws)}/proposals${qs({ status: q.status, limit: q.limit, before: q.before })}`, {}, ProposalListResponse),
    count: (ws: string) => apiFetch(`${w(ws)}/proposals/count`, {}, ProposalCountResponse),
    get: (ws: string, id: string) => apiFetch(`${w(ws)}/proposals/${encodeURIComponent(id)}`, {}, ProposalDetailResponse),
    accept: (ws: string, id: string, req: AcceptProposalRequest = {}) =>
      apiFetch(`${w(ws)}/proposals/${encodeURIComponent(id)}/accept`, { method: 'POST', json: req }, AcceptProposalResponse),
    discard: (ws: string, id: string, req: DiscardProposalRequest = {}) =>
      apiFetch(`${w(ws)}/proposals/${encodeURIComponent(id)}/discard`, { method: 'POST', json: req }, DiscardProposalResponse),
  },

  admin: {
    session: () => apiFetch('/api/admin/session', {}, AdminSessionResponse),
    overview: () => apiFetch('/api/admin/overview', {}, AdminOverviewResponse),
    drives: (q: { q?: string; sort?: 'created' | 'name'; dir?: 'asc' | 'desc'; page?: number; limit?: number } = {}) =>
      apiFetch(`/api/admin/drives${qs({ q: q.q, sort: q.sort, dir: q.dir, page: q.page, limit: q.limit })}`, {}, AdminDrivesResponse),
    logs: (q: { level?: 'all' | 'warn' | 'error'; after?: number; limit?: number } = {}) =>
      apiFetch(`/api/admin/logs${qs({ level: q.level, after: q.after, limit: q.limit })}`, {}, AdminLogsResponse),
    settings: () => apiFetch('/api/admin/settings', {}, AdminSettingsResponse),
    users: (q: { q?: string; sort?: AdminUserSort; dir?: 'asc' | 'desc'; page?: number; limit?: number } = {}) =>
      apiFetch(`/api/admin/users${qs({ q: q.q, sort: q.sort, dir: q.dir, page: q.page, limit: q.limit })}`, {}, AdminUsersResponse),
    user: (userId: string) => apiFetch(`/api/admin/users/${encodeURIComponent(userId)}`, {}, AdminUserDetailResponse),
    setQuota: (userId: string, quotaBytes: number) =>
      apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/quota`, { method: 'PUT', json: { quotaBytes } }, AdminUserResponse),
    domains: () => apiFetch('/api/admin/domains', {}, AdminDomainsResponse),
    audit: (q: AdminAuditParams & { before?: number | null; limit?: number } = {}) =>
      apiFetch(`/api/admin/audit${qs({ ...auditParams(q), before: q.before, limit: q.limit })}`, {}, AdminAuditListResponse),
    /** Same-origin URL of the CSV export for these filters (a download link, not a fetch). */
    auditCsvUrl: (q: AdminAuditParams = {}) => `/api/admin/audit.csv${qs(auditParams(q))}`,
    admins: () => apiFetch('/api/admin/admins', {}, AdminListResponse),
    addAdmin: (email: string) => apiFetch('/api/admin/admins', { method: 'POST', json: { email } }, AdminEntryResponse),
    removeAdmin: (email: string) => apiFetch<void>(`/api/admin/admins/${encodeURIComponent(email)}`, { method: 'DELETE' }),
    storageRequests: (q: { status?: 'open' | 'all' } = {}) =>
      apiFetch(`/api/admin/storage-requests${qs({ status: q.status })}`, {}, AdminStorageRequestsResponse),
    grantStorageRequest: (id: string) =>
      apiFetch(`/api/admin/storage-requests/${encodeURIComponent(id)}/grant`, { method: 'POST', json: {} }, AdminStorageRequestResponse),
    dismissStorageRequest: (id: string) =>
      apiFetch(`/api/admin/storage-requests/${encodeURIComponent(id)}/dismiss`, { method: 'POST', json: {} }, AdminStorageRequestResponse),
    /** Admin → Billing: the Stripe configuration (never a secret). */
    billing: () => apiFetch('/api/admin/billing', {}, AdminBillingResponse),
    setBillingKey: (secretKey: string) => apiFetch('/api/admin/billing/key', { method: 'PUT', json: { secretKey } }, AdminBillingResponse),
    setBillingPrices: (req: SetBillingPricesRequest) => apiFetch('/api/admin/billing/prices', { method: 'PUT', json: req }, AdminBillingResponse),
    setBillingWebhookSecret: (webhookSecret: string) =>
      apiFetch('/api/admin/billing/webhook-secret', { method: 'PUT', json: { webhookSecret } }, AdminBillingResponse),
    retryBillingWebhook: () => apiFetch('/api/admin/billing/webhook', { method: 'POST', json: {} }, AdminBillingResponse),
    disconnectBilling: () => apiFetch('/api/admin/billing', { method: 'DELETE' }, AdminBillingResponse),
  },
};

export type Api = typeof api;

/** Admin audit filters (see AdminAuditFilter in @volumes/shared). */
export interface AdminAuditParams {
  q?: string;
  userId?: string;
  kind?: string[];
  workspaceId?: string;
  from?: string;
  to?: string;
}

function auditParams(q: AdminAuditParams) {
  return { q: q.q, userId: q.userId, kind: q.kind, workspaceId: q.workspaceId, from: q.from, to: q.to };
}

import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { ActionKind, ActionStatus, PaidPlanId, PathOp, StorageRequestStatus } from '@volumes/shared';
import { bauthOAuthClient, bauthUser } from '../auth/schema';

export * from '../auth/schema';

const tz = { withTimezone: true } as const;

/** A workspace is "My Drive": one Platinum volume owned by one user. */
export const workspaces = pgTable(
  'workspaces',
  {
    id: text('id').primaryKey(), // ulid
    userId: text('user_id')
      .notNull()
      .references(() => bauthUser.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    volumeName: text('volume_name').notNull().unique(), // vx-<id>
    volumeId: text('volume_id'), // vol_… once opened
    isDefault: boolean('is_default').notNull().default(false),
    forkedFromWorkspaceId: text('forked_from_workspace_id').references((): AnyPgColumn => workspaces.id, {
      onDelete: 'set null',
    }),
    forkedAtCommit: text('forked_at_commit'),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', tz),
  },
  (t) => [
    index('workspaces_user_idx').on(t.userId).where(sql`deleted_at IS NULL`),
    uniqueIndex('workspaces_one_default_idx').on(t.userId).where(sql`is_default AND deleted_at IS NULL`),
  ],
);

/**
 * People other than the owner who can open a drive. The owner is `workspaces.user_id`
 * and never has a row here. An editor changes files; a viewer only reads.
 */
export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => bauthUser.id, { onDelete: 'cascade' }),
    role: text('role').$type<'editor' | 'viewer'>().notNull(),
    addedBy: text('added_by').references(() => bauthUser.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index('workspace_members_user_idx').on(t.userId)],
);

/**
 * An open invitation to a drive, by address. Nobody joins until the person signed in
 * with that (verified) address accepts, so inviting never reveals whether an account exists.
 */
export const workspaceInvites = pgTable(
  'workspace_invites',
  {
    id: text('id').primaryKey(), // ulid
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(), // lower-cased
    role: text('role').$type<'editor' | 'viewer'>().notNull(),
    invitedBy: text('invited_by').references(() => bauthUser.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', tz).notNull(),
  },
  (t) => [uniqueIndex('workspace_invites_ws_email_idx').on(t.workspaceId, t.email), index('workspace_invites_email_idx').on(t.email)],
);

export const userSettings = pgTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => bauthUser.id, { onDelete: 'cascade' }),
  quotaBytes: bigint('quota_bytes', { mode: 'number' }).notNull(),
  lastSignInAt: timestamp('last_sign_in_at', tz),
  createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', tz).defaultNow().notNull(),
});

/**
 * A person asking for a paid plan's storage while billing is not set up (or instead of paying).
 * At most one open request per user: asking again updates it. An admin grants (the quota
 * becomes the plan's size) or dismisses it.
 */
export const storageRequests = pgTable(
  'storage_requests',
  {
    id: text('id').primaryKey(), // ulid
    userId: text('user_id')
      .notNull()
      .references(() => bauthUser.id, { onDelete: 'cascade' }),
    plan: text('plan').$type<PaidPlanId>().notNull(),
    note: text('note'),
    status: text('status').$type<StorageRequestStatus>().notNull().default('open'),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', tz),
    resolvedBy: text('resolved_by').references(() => bauthUser.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('storage_requests_one_open_idx').on(t.userId).where(sql`status = 'open'`),
    index('storage_requests_user_idx').on(t.userId, t.createdAt.desc()),
  ],
);

/**
 * A user's Stripe customer and their (one) subscription, as the last webhook left it.
 * `plan` and `status` are null until a subscription exists.
 */
export const billingAccounts = pgTable('billing_accounts', {
  userId: text('user_id')
    .primaryKey()
    .references(() => bauthUser.id, { onDelete: 'cascade' }),
  stripeCustomerId: text('stripe_customer_id').notNull().unique(),
  subscriptionId: text('subscription_id'),
  plan: text('plan').$type<PaidPlanId>(),
  status: text('status'),
  currentPeriodEnd: timestamp('current_period_end', tz),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', tz).defaultNow().notNull(),
});

/** Stripe webhook events already handled (Stripe delivers at least once). */
export const billingEvents = pgTable('billing_events', {
  id: text('id').primaryKey(), // evt_…
  type: text('type').notNull(),
  createdAt: timestamp('created_at', tz).defaultNow().notNull(),
});

/** One row per user action = one timeline entry. */
export const actions = pgTable(
  'actions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => bauthUser.id, { onDelete: 'set null' }),
    kind: text('kind').$type<ActionKind>().notNull(),
    summary: text('summary').notNull(),
    status: text('status').$type<ActionStatus>().notNull().default('pending'),
    baseCommitId: text('base_commit_id'), // head before the action (the undo target)
    commitIds: text('commit_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`), // every head commit the action produced, in order
    headCommitId: text('head_commit_id'), // last head commit = the version pointer
    bytesDelta: bigint('bytes_delta', { mode: 'number' }).notNull().default(0),
    itemCount: integer('item_count').notNull().default(0),
    undoOfActionId: text('undo_of_action_id'),
    error: text('error'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
    finalizedAt: timestamp('finalized_at', tz),
    // Attribution: who made the action. 'agent' rows carry the agent's display
    // name and credential ('pat:<tokenId>' | 'oauth:<clientId>').
    actorKind: text('actor_kind').$type<'user' | 'agent'>().notNull().default('user'),
    agentName: text('agent_name'),
    agentCredential: text('agent_credential'),
    proposalId: text('proposal_id'), // set on the action that accepted a proposal (no FK: avoids a cycle)
  },
  (t) => [
    index('actions_ws_agent_idx').on(t.workspaceId, t.agentCredential).where(sql`actor_kind = 'agent'`),
    index('actions_ws_created_idx').on(t.workspaceId, t.createdAt.desc()),
    index('actions_ws_head_idx').on(t.workspaceId, t.headCommitId),
    index('actions_commit_ids_gin').using('gin', t.commitIds),
    index('actions_pending_idx').on(t.workspaceId).where(sql`status = 'pending'`),
  ],
);

export const actionPaths = pgTable(
  'action_paths',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actionId: text('action_id')
      .notNull()
      .references(() => actions.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull(), // denormalised for per-path queries
    op: text('op').$type<PathOp>().notNull(),
    path: text('path').notNull(), // the destination / affected path
    fromPath: text('from_path'), // moved / copied source
    entryType: text('entry_type').$type<'file' | 'dir'>().notNull(),
    size: bigint('size', { mode: 'number' }), // new size (the old size for deleted)
    prevSize: bigint('prev_size', { mode: 'number' }),
    contentHash: text('content_hash'), // sha256(blockHashes.join('')) hex
    blockHashes: text('block_hashes').array(), // exact 1 MiB block list when known
    mtime: bigint('mtime', { mode: 'number' }),
  },
  (t) => [
    index('action_paths_ws_path_idx').on(t.workspaceId, t.path),
    // "Which of these blocks has this user already stored?" (upload plans never reveal other users' blocks)
    index('action_paths_blocks_gin').using('gin', t.blockHashes),
    index('action_paths_action_idx').on(t.actionId),
    index('action_paths_ws_deleted_idx').on(t.workspaceId).where(sql`op = 'deleted'`),
  ],
);

export const checkpoints = pgTable(
  'checkpoints',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    note: text('note').notNull().default(''),
    tag: text('tag').notNull(), // cp-<id>
    commitId: text('commit_id').notNull(),
    auto: boolean('auto').notNull().default(false), // "Before restore …"
    createdBy: text('created_by').references(() => bauthUser.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('checkpoints_ws_tag_idx').on(t.workspaceId, t.tag),
    index('checkpoints_ws_commit_idx').on(t.workspaceId, t.commitId),
  ],
);

export const shareLinks = pgTable(
  'share_links',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(), // 24 random bytes, base64url
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => bauthUser.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    targetType: text('target_type').$type<'file' | 'dir'>().notNull(),
    mode: text('mode').$type<'live' | 'pinned'>().notNull(),
    commitId: text('commit_id'), // pinned only
    tag: text('tag'), // pinned only: ln-<id>
    expiresAt: timestamp('expires_at', tz),
    revokedAt: timestamp('revoked_at', tz),
    // A live link follows its item through moves; when the item is deleted (or
    // removed by a restore) the link is detached, so nothing created later at
    // that path is ever served. Undoing that action re-attaches it.
    detachedAt: timestamp('detached_at', tz),
    detachedByActionId: text('detached_by_action_id'),
    openCount: integer('open_count').notNull().default(0),
    lastOpenedAt: timestamp('last_opened_at', tz),
    // Access controls. The password is only ever stored as an argon2id hash; an
    // unlock cookie is bound to that hash, so changing or removing it signs every
    // visitor out. Allowed emails are lower-cased; empty = anyone with the link.
    passwordHash: text('password_hash'),
    allowDownload: boolean('allow_download').notNull().default(true),
    allowedEmails: text('allowed_emails').array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
    // 'upload': a live folder link people send files into. They never list or
    // read the folder; each file lands as one action charged to the drive owner.
    kind: text('kind').$type<'view' | 'upload'>().notNull().default('view'),
    maxFileBytes: bigint('max_file_bytes', { mode: 'number' }), // upload only; null = the server cap
    maxFiles: integer('max_files'), // upload only; null = no limit
    uploadCount: integer('upload_count').notNull().default(0),
    uploadBytes: bigint('upload_bytes', { mode: 'number' }).notNull().default(0),
    // The per-day cap: bytes and files received on `upload_day` (UTC).
    uploadDay: text('upload_day'),
    uploadDayBytes: bigint('upload_day_bytes', { mode: 'number' }).notNull().default(0),
    uploadDayFiles: integer('upload_day_files').notNull().default(0),
  },
  (t) => [index('share_links_ws_idx').on(t.workspaceId)],
);

/**
 * A comment on a file, by any member of the drive. A reply names its thread's first
 * comment (`parent_id`; one level only). Like a live link, a comment follows its file
 * through moves (services/follow.ts); deleting the file detaches it, and undoing that
 * delete or restoring the file brings it back.
 */
export const fileComments = pgTable(
  'file_comments',
  {
    id: text('id').primaryKey(), // ulid
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    parentId: text('parent_id').references((): AnyPgColumn => fileComments.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => bauthUser.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    commitId: text('commit_id'), // the drive's head when written: the file version it speaks about
    editedAt: timestamp('edited_at', tz),
    resolvedAt: timestamp('resolved_at', tz), // thread roots only
    resolvedBy: text('resolved_by').references(() => bauthUser.id, { onDelete: 'set null' }),
    detachedAt: timestamp('detached_at', tz),
    detachedByActionId: text('detached_by_action_id'),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  },
  (t) => [
    index('file_comments_ws_path_idx').on(t.workspaceId, t.path).where(sql`detached_at IS NULL`),
    index('file_comments_parent_idx').on(t.parentId),
    index('file_comments_detached_by_idx').on(t.workspaceId, t.detachedByActionId),
  ],
);

/** A tag (in the UI) of one drive: a name, unique per drive ignoring case, and a palette colour. */
export const fileLabels = pgTable(
  'file_labels',
  {
    id: text('id').primaryKey(), // ulid
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
    createdBy: text('created_by').references(() => bauthUser.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('file_labels_ws_name_idx').on(t.workspaceId, sql`lower(${t.name})`)],
);

/** A tag on a file or folder. Follows the item like a comment does. */
export const fileLabelAssignments = pgTable(
  'file_label_assignments',
  {
    id: text('id').primaryKey(), // ulid
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => fileLabels.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    createdBy: text('created_by').references(() => bauthUser.id, { onDelete: 'set null' }),
    detachedAt: timestamp('detached_at', tz),
    detachedByActionId: text('detached_by_action_id'),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('file_label_assignments_live_idx').on(t.labelId, t.path).where(sql`detached_at IS NULL`),
    index('file_label_assignments_ws_path_idx').on(t.workspaceId, t.path),
    index('file_label_assignments_detached_by_idx').on(t.workspaceId, t.detachedByActionId),
  ],
);

export type UploadRowPlan = {
  files: { path: string; size: number }[];
  dirs: string[];
  overwrite: boolean;
  renamed: { from: string; to: string }[];
  /** Head when the plan was made: a commit onto a moved head re-checks conflicts and re-plans. */
  baseCommitId?: string;
  /** Head right before the first commit attempt (recognises a commit whose response was lost). */
  commitHead?: string;
  /**
   * Blocks this user had not proven they hold when the plan was made (sorted,
   * unique). Each must arrive through this upload's block PUTs before it commits.
   */
  required?: string[];
};

export const uploads = pgTable(
  'uploads',
  {
    id: text('id').primaryKey(), // our upload id, given to the browser
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => bauthUser.id, { onDelete: 'cascade' }),
    actionId: text('action_id').references(() => actions.id, { onDelete: 'set null' }),
    ptUploadId: text('pt_upload_id'), // vu_… (never sent to the browser)
    status: text('status').$type<'planned' | 'uploading' | 'committed' | 'failed' | 'aborted' | 'expired'>().notNull(),
    plan: jsonb('plan').$type<UploadRowPlan>().notNull(),
    totalBytes: bigint('total_bytes', { mode: 'number' }).notNull(),
    // Quota reserved by this plan until it commits or ends (growth of logicalBytes, like assertQuota counts).
    addedBytes: bigint('added_bytes', { mode: 'number' }).notNull().default(0),
    missingCount: integer('missing_count').notNull().default(0),
    expiresAt: timestamp('expires_at', tz),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', tz).defaultNow().notNull(),
  },
  (t) => [index('uploads_ws_status_idx').on(t.workspaceId, t.status)],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('user_id').references(() => bauthUser.id, { onDelete: 'set null' }),
    actorEmail: text('actor_email'), // kept after account deletion
    workspaceId: text('workspace_id'), // no FK: keep events after a workspace is deleted
    kind: text('kind').notNull(),
    target: text('target'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  },
  (t) => [
    index('audit_user_created_idx').on(t.userId, t.createdAt.desc()),
    index('audit_kind_created_idx').on(t.kind, t.createdAt.desc()),
    // The admin log reads every user's events by date range and by drive.
    index('audit_created_idx').on(t.createdAt.desc()),
    index('audit_workspace_idx').on(t.workspaceId, t.id.desc()),
  ],
);

/**
 * Who administers this server, by address (lower-cased). An admin still needs that
 * address verified on their account (services/admins.ts). Seeded by the migration
 * with the first admin; admins add and remove each other in the admin panel, and the
 * last one cannot be removed.
 */
export const admins = pgTable('admins', {
  email: text('email').primaryKey(),
  /** The admin who added this one (an address, kept after their account is gone); null when seeded. */
  addedBy: text('added_by'),
  createdAt: timestamp('created_at', tz).defaultNow().notNull(),
});

/**
 * Capacity promised to a mutation that is running now (a copy, a restore, a new
 * or duplicated workspace, a folder) and not yet visible in storage usage. Rows
 * are written and counted under a Postgres advisory lock (per user, or one for
 * the whole org), so checks made by any API process at the same time see each
 * other. A row is deleted when its mutation ends; `expires_at` (renewed while
 * the holder runs) frees it if the process died. See services/reservations.ts.
 */
export const quotaReservations = pgTable(
  'quota_reservations',
  {
    id: text('id').primaryKey(),
    // 'user': bytes / workspaces of `user_id`; 'org': volumes of the shared org.
    scope: text('scope').$type<'user' | 'org'>().notNull(),
    userId: text('user_id').references(() => bauthUser.id, { onDelete: 'cascade' }),
    // The workspace the mutation creates (no FK: the row may not exist yet).
    workspaceId: text('workspace_id'),
    kind: text('kind').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
    workspaces: integer('workspaces').notNull().default(0),
    volumes: integer('volumes').notNull().default(0),
    expiresAt: timestamp('expires_at', tz).notNull(),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  },
  (t) => [index('quota_reservations_user_idx').on(t.userId, t.expiresAt), index('quota_reservations_scope_idx').on(t.scope, t.expiresAt)],
);

export type AgentScope = 'drive:read' | 'drive:propose' | 'drive:write';
export type AgentMode = 'review' | 'direct';

/** Personal access tokens for AI agents (vx_pat_…). Only the SHA-256 of the secret is stored. */
export const agentTokens = pgTable(
  'agent_tokens',
  {
    id: text('id').primaryKey(), // ulid
    userId: text('user_id')
      .notNull()
      .references(() => bauthUser.id, { onDelete: 'cascade' }),
    name: text('name').notNull(), // 1..60, shown as the agent name
    tokenHash: text('token_hash').notNull().unique(), // sha256 hex of the full plaintext
    tokenPrefix: text('token_prefix').notNull(), // first 12 chars, e.g. "vx_pat_Q3fZ" (display only)
    scope: text('scope').$type<AgentScope>().notNull(),
    mode: text('mode').$type<AgentMode>().notNull().default('review'),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }), // null = all workspaces
    expiresAt: timestamp('expires_at', tz).notNull(),
    lastUsedAt: timestamp('last_used_at', tz),
    lastUsedIp: text('last_used_ip'),
    revokedAt: timestamp('revoked_at', tz),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  },
  (t) => [index('agent_tokens_user_idx').on(t.userId, t.createdAt.desc())],
);

/** Our side of an OAuth grant: what the user chose on the consent page. One row per (user, client). */
export const agentGrants = pgTable(
  'agent_grants',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => bauthUser.id, { onDelete: 'cascade' }),
    clientId: text('client_id')
      .notNull()
      .references(() => bauthOAuthClient.clientId, { onDelete: 'cascade' }),
    clientName: text('client_name').notNull(), // snapshot of client_name at consent (<= 80, sanitised)
    scope: text('scope').$type<AgentScope>().notNull(), // highest scope accepted
    mode: text('mode').$type<AgentMode>().notNull().default('review'),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    lastUsedAt: timestamp('last_used_at', tz),
    revokedAt: timestamp('revoked_at', tz),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', tz).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('agent_grants_user_client_idx').on(t.userId, t.clientId)],
);

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength),
  fromDriver: (v) => new Uint8Array(v),
});

export type ProposalStatus = 'open' | 'accepted' | 'partial' | 'discarded' | 'expired';
export type ProposalOpKind = 'write' | 'mkdir' | 'move' | 'copy' | 'delete';
export type ProposalFileStatus = 'pending' | 'accepted' | 'discarded';

/** A staged batch of changes from an agent in review mode, waiting for the user to accept or discard it. */
export const proposals = pgTable(
  'proposals',
  {
    id: text('id').primaryKey(), // ulid
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => bauthUser.id, { onDelete: 'cascade' }),
    agentName: text('agent_name').notNull(),
    agentCredential: text('agent_credential').notNull(), // 'pat:<id>' | 'oauth:<clientId>'
    message: text('message').notNull().default(''), // the agent's one-line description (<= 500)
    status: text('status').$type<ProposalStatus>().notNull().default('open'),
    baseCommitId: text('base_commit_id').notNull(), // last_seen_commit_id of the write_changes call
    checkpointName: text('checkpoint_name'), // set when the agent asked for a checkpoint
    opCount: integer('op_count').notNull(),
    bytesTotal: bigint('bytes_total', { mode: 'number' }).notNull().default(0), // staged content bytes
    acceptedActionIds: text('accepted_action_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    decidedAt: timestamp('decided_at', tz),
    error: text('error'),
    expiresAt: timestamp('expires_at', tz).notNull(), // created + 30 days
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', tz).defaultNow().notNull(),
  },
  (t) => [
    index('proposals_ws_status_idx').on(t.workspaceId, t.status, t.createdAt.desc()),
    index('proposals_user_open_idx').on(t.userId).where(sql`status = 'open'`),
  ],
);

/** One row per op of the batch, in order. `path` is the destination (write/mkdir/move/copy) or the deleted path. */
export const proposalFiles = pgTable(
  'proposal_files',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    proposalId: text('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(), // 0-based op order
    op: text('op').$type<ProposalOpKind>().notNull(),
    path: text('path').notNull(),
    fromPath: text('from_path'), // move / copy source
    entryType: text('entry_type').$type<'file' | 'dir'>().notNull(),
    size: bigint('size', { mode: 'number' }), // write: new size
    blockHashes: text('block_hashes').array(), // write: 1 MiB block sha256 list (hashed by the server)
    contentHash: text('content_hash'), // write: contentHashOf(blockHashes)
    mime: text('mime'),
    baseVersion: text('base_version'), // FileStat.version of `path` at base (null = absent)
    baseSize: bigint('base_size', { mode: 'number' }),
    status: text('status').$type<ProposalFileStatus>().notNull().default('pending'),
    actionId: text('action_id'), // the accept action that landed it
  },
  (t) => [
    uniqueIndex('proposal_files_seq_idx').on(t.proposalId, t.seq),
    index('proposal_files_proposal_idx').on(t.proposalId),
  ],
);

/** Staged bytes, content-addressed per user (a block shared by two proposals is stored once). */
export const proposalBlocks = pgTable(
  'proposal_blocks',
  {
    userId: text('user_id')
      .notNull()
      .references(() => bauthUser.id, { onDelete: 'cascade' }),
    sha256: text('sha256').notNull(),
    size: integer('size').notNull(),
    bytes: bytea('bytes').notNull(),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.sha256] })],
);

/**
 * A person's starred items (private to them). A star names a path, so it follows its item
 * through renames and moves and is detached when the item is deleted, exactly like a live
 * share link (services/stars.ts, called from the link hooks in services/links.ts). Losing
 * access to the drive hides its stars; they come back if access does.
 */
export const stars = pgTable(
  'stars',
  {
    id: text('id').primaryKey(), // ulid
    userId: text('user_id')
      .notNull()
      .references(() => bauthUser.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    targetType: text('target_type').$type<'file' | 'dir'>().notNull(),
    detachedAt: timestamp('detached_at', tz),
    detachedByActionId: text('detached_by_action_id'),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('stars_user_ws_path_idx').on(t.userId, t.workspaceId, t.path).where(sql`detached_at IS NULL`),
    index('stars_ws_path_idx').on(t.workspaceId, t.path),
    index('stars_user_created_idx').on(t.userId, t.createdAt.desc()),
  ],
);

/**
 * Files a person opened (previewed or downloaded): one row per user and item, the newest
 * open wins, at most RECENT_OPENS_CAP rows per user. Changes they made come from the ledger.
 */
export const recentOpens = pgTable(
  'recent_opens',
  {
    userId: text('user_id')
      .notNull()
      .references(() => bauthUser.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    openedAt: timestamp('opened_at', tz).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.workspaceId, t.path] }),
    index('recent_opens_user_opened_idx').on(t.userId, t.openedAt.desc()),
    index('recent_opens_ws_path_idx').on(t.workspaceId, t.path),
  ],
);

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type UserSettingsRow = typeof userSettings.$inferSelect;
export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect;
export type WorkspaceInviteRow = typeof workspaceInvites.$inferSelect;
export type ActionRow = typeof actions.$inferSelect;
export type ActionPathRow = typeof actionPaths.$inferSelect;
export type CheckpointRow = typeof checkpoints.$inferSelect;
export type ShareLinkRow = typeof shareLinks.$inferSelect;
export type UploadRow = typeof uploads.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;
export type AgentTokenRow = typeof agentTokens.$inferSelect;
export type AgentGrantRow = typeof agentGrants.$inferSelect;
export type ProposalRow = typeof proposals.$inferSelect;
export type ProposalFileRow = typeof proposalFiles.$inferSelect;
export type StorageRequestRow = typeof storageRequests.$inferSelect;
export type BillingAccountRow = typeof billingAccounts.$inferSelect;
export type AdminRow = typeof admins.$inferSelect;
export type StarRow = typeof stars.$inferSelect;
export type RecentOpenRow = typeof recentOpens.$inferSelect;
export type FileCommentRow = typeof fileComments.$inferSelect;
export type FileLabelRow = typeof fileLabels.$inferSelect;
export type FileLabelAssignmentRow = typeof fileLabelAssignments.$inferSelect;

import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { ActionKind, ActionStatus, PathOp } from '@volumes/shared';
import { bauthUser } from '../auth/schema';

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

export const userSettings = pgTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => bauthUser.id, { onDelete: 'cascade' }),
  quotaBytes: bigint('quota_bytes', { mode: 'number' }).notNull(),
  lastSignInAt: timestamp('last_sign_in_at', tz),
  createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', tz).defaultNow().notNull(),
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
  },
  (t) => [
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
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  },
  (t) => [index('share_links_ws_idx').on(t.workspaceId)],
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
  ],
);

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type UserSettingsRow = typeof userSettings.$inferSelect;
export type ActionRow = typeof actions.$inferSelect;
export type ActionPathRow = typeof actionPaths.$inferSelect;
export type CheckpointRow = typeof checkpoints.$inferSelect;
export type ShareLinkRow = typeof shareLinks.$inferSelect;
export type UploadRow = typeof uploads.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;

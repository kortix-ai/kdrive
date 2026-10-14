import { z } from 'zod';
import { MAX_QUOTA_BYTES } from '../constants';
import { formatBytes } from '../format';
import { SubscriptionSchema } from './billing';
import { IsoDateSchema } from './common';
import { AuditEventSchema } from './me';
import { MemberRoleSchema } from './workspaces';

export const AdminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  createdAt: IsoDateSchema,
  lastSignInAt: IsoDateSchema.nullable(),
  quotaBytes: z.number(),
  usedBytes: z.number(),
  workspaceCount: z.number(),
  /** Drives other people shared with them. */
  sharedWithCount: z.number().default(0),
  emailVerified: z.boolean().default(true),
  isAdmin: z.boolean(),
  /** Their Stripe subscription, when they have (or had) one. */
  subscription: SubscriptionSchema.nullable().default(null),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const ADMIN_USER_SORTS = ['used', 'quota', 'created', 'lastSignIn', 'email', 'drives'] as const;
export const AdminUserSortSchema = z.enum(ADMIN_USER_SORTS);
export type AdminUserSort = z.infer<typeof AdminUserSortSchema>;

export const AdminUsersQuery = z.object({
  q: z.string().trim().max(200).optional(),
  sort: AdminUserSortSchema.default('used'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
export type AdminUsersQuery = z.input<typeof AdminUsersQuery>;

export const AdminUsersResponse = z.object({
  users: z.array(AdminUserSchema),
  /** Users matching the search (all pages). */
  total: z.number().default(0),
  page: z.number().default(1),
  limit: z.number().default(50),
  /** Storage's size cap for ONE workspace (volume): a quota above it only helps across several workspaces. */
  workspaceCapBytes: z.number().optional(),
});
export type AdminUsersResponse = z.infer<typeof AdminUsersResponse>;

export const SetQuotaRequest = z.object({
  quotaBytes: z.number().int().positive().max(MAX_QUOTA_BYTES, `Quota can be at most ${MAX_QUOTA_BYTES} bytes (${formatBytes(MAX_QUOTA_BYTES)}).`),
});
export type SetQuotaRequest = z.input<typeof SetQuotaRequest>;

export const AdminUserResponse = z.object({
  user: AdminUserSchema,
  /** Set when the new quota is larger than one workspace can hold. */
  warning: z.string().optional(),
});
export type AdminUserResponse = z.infer<typeof AdminUserResponse>;

/** One value or a repeated query key (`?kind=a&kind=b`), as a list. */
const many = <T extends z.ZodType>(item: T) =>
  z
    .union([item, z.array(item).max(100)])
    .optional()
    .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]) as z.output<T>[]);

/** Filters shared by the audit list and its CSV export. */
export const AdminAuditFilter = z.object({
  /** Matches the actor's email, the account's email or the target (case-insensitive substring). */
  q: z.string().trim().max(200).optional(),
  userId: z.string().max(64).optional(),
  kind: many(z.string().max(64)),
  workspaceId: z.string().max(64).optional(),
  /** ISO instants; `from` inclusive, `to` exclusive. */
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export type AdminAuditFilter = z.output<typeof AdminAuditFilter>;

export const AdminAuditQuery = AdminAuditFilter.extend({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type AdminAuditQuery = z.input<typeof AdminAuditQuery>;

/** An audit event as admins see it: who (account id), from where (IP) and in which drive. */
export const AdminAuditEventSchema = AuditEventSchema.extend({
  userId: z.string().nullable(),
  ip: z.string().nullable(),
  workspaceName: z.string().nullable(),
});
export type AdminAuditEvent = z.infer<typeof AdminAuditEventSchema>;

export const AdminAuditListResponse = z.object({
  events: z.array(AdminAuditEventSchema),
  nextCursor: z.string().nullable(),
});
export type AdminAuditListResponse = z.infer<typeof AdminAuditListResponse>;

// ── overview ─────────────────────────────────────────────────────────────────

export const AdminOverviewResponse = z.object({
  users: z.number(),
  /** Live drives (deleted ones excluded). */
  drives: z.number(),
  /** Live drives with at least one member besides the owner. */
  sharedDrives: z.number(),
  /** Σ current logical size of every live drive. */
  usedBytes: z.number(),
  /** Σ every user's quota. */
  quotaBytes: z.number(),
  openRequests: z.number(),
  signups7d: z.number(),
  signups30d: z.number(),
  topUsers: z.array(AdminUserSchema),
  /** When the usage numbers were read from storage (they are cached briefly). */
  usageAt: IsoDateSchema,
});
export type AdminOverviewResponse = z.infer<typeof AdminOverviewResponse>;

// ── user detail ──────────────────────────────────────────────────────────────

export const AdminOwnedDriveSchema = z.object({
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
  usedBytes: z.number(),
  /** People the drive is shared with (the owner not counted). */
  memberCount: z.number(),
  createdAt: IsoDateSchema,
});
export type AdminOwnedDrive = z.infer<typeof AdminOwnedDriveSchema>;

export const AdminSharedDriveSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: MemberRoleSchema,
  owner: z.object({ id: z.string(), email: z.string(), name: z.string().nullable() }),
  usedBytes: z.number(),
  joinedAt: IsoDateSchema,
});
export type AdminSharedDrive = z.infer<typeof AdminSharedDriveSchema>;

export const AdminUserDetailResponse = z.object({
  user: AdminUserSchema,
  drives: z.array(AdminOwnedDriveSchema),
  sharedWith: z.array(AdminSharedDriveSchema),
  /** Their address is on the admin list (rights need it verified too: see user.isAdmin). */
  isListedAdmin: z.boolean(),
  workspaceCapBytes: z.number().optional(),
});
export type AdminUserDetailResponse = z.infer<typeof AdminUserDetailResponse>;

// ── usage by email domain ────────────────────────────────────────────────────

export const AdminDomainUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  usedBytes: z.number(),
  quotaBytes: z.number(),
  workspaceCount: z.number(),
});

export const AdminDomainSchema = z.object({
  domain: z.string(),
  users: z.number(),
  drives: z.number(),
  usedBytes: z.number(),
  quotaBytes: z.number(),
  /** Every user at the domain, most used first. */
  members: z.array(AdminDomainUserSchema),
});
export type AdminDomain = z.infer<typeof AdminDomainSchema>;

export const AdminDomainsResponse = z.object({ domains: z.array(AdminDomainSchema) });
export type AdminDomainsResponse = z.infer<typeof AdminDomainsResponse>;

// ── admins ───────────────────────────────────────────────────────────────────

export const AdminEntrySchema = z.object({
  email: z.string(),
  addedBy: z.string().nullable(),
  createdAt: IsoDateSchema,
  /** The account with this address, once someone signed up with it. */
  user: z.object({ id: z.string(), name: z.string().nullable(), emailVerified: z.boolean() }).nullable(),
});
export type AdminEntry = z.infer<typeof AdminEntrySchema>;

export const AdminListResponse = z.object({ admins: z.array(AdminEntrySchema) });
export type AdminListResponse = z.infer<typeof AdminListResponse>;

export const AddAdminRequest = z.object({ email: z.string().trim().toLowerCase().email().max(320) });
export type AddAdminRequest = z.input<typeof AddAdminRequest>;

export const AdminEntryResponse = z.object({ admin: AdminEntrySchema });
export type AdminEntryResponse = z.infer<typeof AdminEntryResponse>;

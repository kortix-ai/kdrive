import { z } from 'zod';
import { MAX_QUOTA_BYTES } from '../constants';
import { IsoDateSchema } from './common';

export const AdminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  createdAt: IsoDateSchema,
  lastSignInAt: IsoDateSchema.nullable(),
  quotaBytes: z.number(),
  usedBytes: z.number(),
  workspaceCount: z.number(),
  isAdmin: z.boolean(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const AdminUsersQuery = z.object({ q: z.string().trim().max(200).optional() });
export type AdminUsersQuery = z.input<typeof AdminUsersQuery>;

export const AdminUsersResponse = z.object({
  users: z.array(AdminUserSchema),
  /** Storage's size cap for ONE workspace (volume): a quota above it only helps across several workspaces. */
  workspaceCapBytes: z.number().optional(),
});
export type AdminUsersResponse = z.infer<typeof AdminUsersResponse>;

export const SetQuotaRequest = z.object({
  quotaBytes: z.number().int().positive().max(MAX_QUOTA_BYTES, `Quota can be at most ${MAX_QUOTA_BYTES} bytes (50 GiB).`),
});
export type SetQuotaRequest = z.input<typeof SetQuotaRequest>;

export const AdminUserResponse = z.object({
  user: AdminUserSchema,
  /** Set when the new quota is larger than one workspace can hold. */
  warning: z.string().optional(),
});
export type AdminUserResponse = z.infer<typeof AdminUserResponse>;

export const AdminAuditQuery = z.object({
  userId: z.string().max(64).optional(),
  kind: z.string().max(64).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type AdminAuditQuery = z.input<typeof AdminAuditQuery>;

import { z } from 'zod';
import { RETENTION_COPY } from '../constants';
import { IsoDateSchema } from './common';
import { WorkspaceSummarySchema } from './workspaces';

export const ProviderSchema = z.enum(['google', 'github']);
export type Provider = z.infer<typeof ProviderSchema>;

export const StorageModeSchema = z.enum(['platinum', 'emulated']);
export type StorageMode = z.infer<typeof StorageModeSchema>;

export const ConfigResponse = z.object({
  providers: z.array(ProviderSchema),
  devLogin: z.boolean(),
  storageMode: StorageModeSchema,
  retentionCopy: z.string().default(RETENTION_COPY),
  /** AI agent access: whether /mcp is on, and the MCP server URL to give an agent. */
  mcp: z.object({ enabled: z.boolean(), url: z.string() }),
});
export type ConfigResponse = z.infer<typeof ConfigResponse>;

export const MeterLevelSchema = z.enum(['ok', 'amber', 'red']);

export const UsageResponse = z.object({
  quotaBytes: z.number(),
  usedBytes: z.number(),
  level: MeterLevelSchema,
  byWorkspace: z.array(z.object({ workspaceId: z.string(), name: z.string(), bytes: z.number() })),
});
export type UsageResponse = z.infer<typeof UsageResponse>;

export const MeUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
});
export type MeUser = z.infer<typeof MeUserSchema>;

export const MeResponse = z.object({
  user: MeUserSchema,
  isAdmin: z.boolean(),
  defaultWorkspaceId: z.string(),
  workspaces: z.array(WorkspaceSummarySchema),
  usage: UsageResponse,
});
export type MeResponse = z.infer<typeof MeResponse>;

export const DeleteAccountRequest = z.object({ confirm: z.string().min(1).max(320) });
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequest>;

export const AUDIT_KINDS = [
  'auth.sign_in',
  'auth.sign_out',
  'account.delete',
  'workspace.create',
  'workspace.duplicate',
  'workspace.delete',
  'restore.file',
  'restore.folder',
  'restore.drive',
  'undo',
  'checkpoint.create',
  'checkpoint.update',
  'checkpoint.delete',
  'link.create',
  'link.update',
  'link.revoke',
  'quota.change',
  'agent.token.create',
  'agent.token.revoke',
  'agent.grant.create',
  'agent.grant.update',
  'agent.grant.revoke',
  'agent.write',
  'agent.restore',
  'agent.undo',
  'agent.checkpoint',
  'proposal.create',
  'proposal.accept',
  'proposal.discard',
] as const;
export const AuditKindSchema = z.enum(AUDIT_KINDS);
export type AuditKind = z.infer<typeof AuditKindSchema>;

export const AuditEventSchema = z.object({
  id: z.number(),
  kind: z.string(),
  target: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()),
  workspaceId: z.string().nullable(),
  actorEmail: z.string().nullable(),
  createdAt: IsoDateSchema,
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const AuditListQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditListQuery = z.infer<typeof AuditListQuery>;

export const AuditListResponse = z.object({
  events: z.array(AuditEventSchema),
  nextCursor: z.string().nullable(),
});
export type AuditListResponse = z.infer<typeof AuditListResponse>;

export const HealthResponse = z.object({ ok: z.literal(true), storageMode: StorageModeSchema });
export type HealthResponse = z.infer<typeof HealthResponse>;

export const DevSignInRequest = z.object({ email: z.string().email(), name: z.string().max(120).optional() });
export type DevSignInRequest = z.infer<typeof DevSignInRequest>;

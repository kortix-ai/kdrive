import { z } from 'zod';
import { IdSchema, IsoDateSchema } from './common';

/** Access levels, each implying the ones before it: read ⊂ propose ⊂ write. */
export const AgentScopeSchema = z.enum(['drive:read', 'drive:propose', 'drive:write']);
export type AgentScope = z.infer<typeof AgentScopeSchema>;

/** What happens to an agent's writes: `review` stages them as proposals, `direct` lands them in the drive. */
export const AgentModeSchema = z.enum(['review', 'direct']);
export type AgentMode = z.infer<typeof AgentModeSchema>;

// ── Agent tokens (personal access tokens) ────────────────────────────────

export const AgentTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** First 12 characters of the secret, e.g. "vx_pat_Q3fZ" (display only). */
  prefix: z.string(),
  scope: AgentScopeSchema,
  mode: AgentModeSchema,
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
  expiresAt: IsoDateSchema,
  lastUsedAt: IsoDateSchema.nullable(),
  revokedAt: IsoDateSchema.nullable(),
  createdAt: IsoDateSchema,
  expired: z.boolean(),
});
export type AgentToken = z.infer<typeof AgentTokenSchema>;

export const AgentTokenListResponse = z.object({ tokens: z.array(AgentTokenSchema) });
export type AgentTokenListResponse = z.infer<typeof AgentTokenListResponse>;

export const AGENT_TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;

export const CreateAgentTokenRequest = z
  .object({
    name: z.string().trim().min(1).max(60),
    scope: AgentScopeSchema,
    mode: AgentModeSchema.default('review'),
    workspaceId: IdSchema.nullable().default(null),
    expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).default(365),
  })
  .refine((v) => v.scope !== 'drive:propose' || v.mode === 'review', {
    message: 'Suggest-only access always needs your review.',
    path: ['mode'],
  });
export type CreateAgentTokenRequest = z.input<typeof CreateAgentTokenRequest>;

export const CreateAgentTokenResponse = z.object({
  token: AgentTokenSchema,
  /** The plaintext token. Returned once, never again. */
  secret: z.string(),
});
export type CreateAgentTokenResponse = z.infer<typeof CreateAgentTokenResponse>;

// ── Connected apps (OAuth grants) ───────────────────────────────────────

export const ConnectedAppSchema = z.object({
  /** agent_grants.id */
  id: z.string(),
  clientId: z.string(),
  name: z.string(),
  redirectHost: z.string().nullable(),
  scope: AgentScopeSchema,
  mode: AgentModeSchema,
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
  createdAt: IsoDateSchema,
  lastUsedAt: IsoDateSchema.nullable(),
});
export type ConnectedApp = z.infer<typeof ConnectedAppSchema>;

export const ConnectedAppListResponse = z.object({ apps: z.array(ConnectedAppSchema) });
export type ConnectedAppListResponse = z.infer<typeof ConnectedAppListResponse>;

export const UpdateConnectedAppRequest = z.object({
  mode: AgentModeSchema.optional(),
  workspaceId: IdSchema.nullable().optional(),
  /** Only a downgrade is accepted. */
  scope: AgentScopeSchema.optional(),
});
export type UpdateConnectedAppRequest = z.input<typeof UpdateConnectedAppRequest>;

export const ConnectedAppResponse = z.object({ app: ConnectedAppSchema });
export type ConnectedAppResponse = z.infer<typeof ConnectedAppResponse>;

// ── OAuth consent ───────────────────────────────────────────────────────

export const OAuthConsentInfoQuery = z.object({ oauth_query: z.string().min(1).max(8192) });
export type OAuthConsentInfoQuery = z.input<typeof OAuthConsentInfoQuery>;

export const OAuthConsentInfo = z.object({
  client: z.object({
    clientId: z.string(),
    name: z.string(),
    uri: z.string().nullable(),
    redirectHost: z.string().nullable(),
  }),
  requested: z.object({
    scope: AgentScopeSchema,
    /** Standard identity scopes requested alongside: openid, profile, email, offline_access. */
    identity: z.array(z.string()),
  }),
  workspaces: z.array(z.object({ id: z.string(), name: z.string(), isDefault: z.boolean() })),
  existing: ConnectedAppSchema.nullable(),
});
export type OAuthConsentInfo = z.infer<typeof OAuthConsentInfo>;

export const OAuthConsentDecision = z.object({
  oauth_query: z.string().min(1).max(8192),
  accept: z.boolean(),
  /** At most the requested level. */
  scope: AgentScopeSchema.optional(),
  mode: AgentModeSchema.optional(),
  workspaceId: IdSchema.nullable().optional(),
});
export type OAuthConsentDecision = z.input<typeof OAuthConsentDecision>;

export const OAuthConsentResult = z.object({ redirectUri: z.string() });
export type OAuthConsentResult = z.infer<typeof OAuthConsentResult>;
